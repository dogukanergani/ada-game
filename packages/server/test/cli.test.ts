import { describe, expect, it } from 'vitest';
import type { GameView } from '@ada/game-core';
import { mulberry32 } from '../../game-core/sim/rng';
import { autoStep } from '../cli/autoplay';
import { parseCommand, parseHand } from '../cli/commands';
import { renderLegal, renderLobby, renderMap, renderState } from '../cli/render';
import { TestClient, startServer } from './harness';

const emitOf = (line: string) => {
  const c = parseCommand(line);
  if (!c || c.kind !== 'emit') throw new Error(`not an emit command: ${line}`);
  return c;
};

describe('cli: command parsing', () => {
  it('turns lobby commands into events', () => {
    expect(emitOf('create Ada Lovelace')).toMatchObject({ event: 'room:create', payload: { name: 'Ada Lovelace' } });
    expect(emitOf('join abcd Bob')).toMatchObject({ event: 'room:join', payload: { code: 'abcd', name: 'Bob' } });
    expect(emitOf('role sage').payload).toEqual({ role: 'sage' });
    expect(emitOf('role none').payload).toEqual({ role: null });
    expect(emitOf('mode short').payload).toEqual({ mode: 'short' });
    expect(emitOf('start').event).toBe('lobby:start');
    expect(emitOf('leave').event).toBe('room:leave');
  });

  it('turns game commands into actions', () => {
    const a = (line: string) => emitOf(line).payload;
    expect(a('roll')).toEqual({ type: 'roll' });
    expect(a('end')).toEqual({ type: 'endTurn' });
    expect(a('road 12')).toEqual({ type: 'placeRoad', edge: 12 });
    expect(a('settle 3')).toEqual({ type: 'placeSettlement', vertex: 3 });
    expect(a('city 3')).toEqual({ type: 'upgradeCity', vertex: 3 });
    expect(a('bank wool ore')).toEqual({ type: 'bankTrade', give: 'wool', get: 'ore' });
    expect(a('discard lumber=1,ore:2')).toEqual({ type: 'discard', resources: { lumber: 1, ore: 2 } });
    expect(a('offer give=wool:1 want=ore:2')).toEqual({ type: 'offerTrade', give: { wool: 1 }, want: { ore: 2 } });
    expect(a('demolish city 7')).toEqual({ type: 'roleAction', name: 'demolish', params: { kind: 'city', id: 7 } });
    expect(parseCommand('capture city 7')).toMatchObject({ kind: 'error' }); // the old name is gone
    expect(a('raw {"type":"roll"}')).toEqual({ type: 'roll' });
    expect(emitOf('steal bob').victimRef).toBe('bob');
    expect(emitOf('emit lobby:setMode {"mode":"short"}')).toMatchObject({ event: 'lobby:setMode', payload: { mode: 'short' } });
  });

  it('keeps local commands local and reports bad input', () => {
    for (const [line, name] of [['state', 'state'], ['map', 'map'], ['legal', 'legal'], ['help', 'help'], ['quit', 'quit']] as const) {
      expect(parseCommand(line)).toMatchObject({ kind: 'local', name });
    }
    expect(parseCommand('autoplay on')).toMatchObject({ kind: 'local', name: 'autoplay', arg: 'on' });
    expect(parseCommand('   ')).toBeNull();
    for (const bad of ['road', 'road x', 'bank gold ore', 'bank wool', 'mode huge', 'join ABCD', 'raw {oops', 'frobnicate', 'discard gold=1']) {
      expect(parseCommand(bad), bad).toMatchObject({ kind: 'error' });
    }
    expect(parseHand('wool:2,ore')).toEqual({ wool: 2, ore: 1 });
    expect(parseHand('mud:1')).toBeNull();
  });
});

describe('cli: autoplay over real sockets', () => {
  /** Plays a whole game with every seat driven by the CLI's autoplay step. */
  async function playByAutoplay(n: number) {
    const { url } = await startServer();
    const players: TestClient[] = [];
    for (let i = 0; i < n; i++) players.push(await TestClient.login(url));
    const { code } = await players[0].emit('room:create', { name: 'P0' });
    for (let i = 1; i < n; i++) await players[i].emit('room:join', { code, name: `P${i}` });
    await players[0].emit('lobby:setMode', { mode: 'short' });
    expect(await players[0].emit('lobby:start')).toEqual({ ok: true });

    const rng = mulberry32(n);
    const views = new Map<string, GameView>();
    for (const p of players) views.set(p.playerId, (await p.until('game:snapshot')).view);
    const refreshed = () => {
      for (const p of players) {
        const latest = [...p.log].reverse().find((l) => l.event === 'game:update' || l.event === 'game:snapshot');
        if (latest) views.set(p.playerId, (latest.args[0] as { view: GameView }).view);
      }
    };
    let acted = 0;
    for (let guard = 0; guard < 8000; guard++) {
      refreshed();
      if ([...views.values()][0].phase === 'finished') break;
      let progressed = false;
      for (const p of players) {
        const marks = players.map((q) => q.mark());
        const r = await autoStep(p, views.get(p.playerId)!, rng);
        expect(r.kind, JSON.stringify(r)).not.toBe('refused');
        if (r.kind === 'acted') {
          progressed = true;
          acted++;
          // wait for everyone to receive the update before the next decision
          for (const [i, q] of players.entries()) await q.until('game:update', () => true, marks[i]);
          refreshed();
        }
      }
      expect(progressed, 'the game got stuck').toBe(true);
    }
    refreshed();
    return { views, acted, players };
  }

  for (const n of [2, 3, 5]) {
    it(`${n} autoplaying clients finish a game without a single refused move`, async () => {
      const { views, acted } = await playByAutoplay(n);
      const final = [...views.values()][0];
      expect(final.phase).toBe('finished');
      expect(final.winner).not.toBeNull();
      expect(acted).toBeGreaterThan(50);
    }, 120_000);
  }

  it('renders views, maps and legal moves without throwing', async () => {
    const { views, players } = await playByAutoplay(2);
    const v = views.get(players[0].playerId)!;
    expect(renderState(v)).toContain('phase=finished');
    expect(renderMap(v)).toContain('tiles');
    expect(renderMap(v)).toContain('buildings');
    const lobby = (await players[0].until('lobby:update', (l: any) => l.phase === 'finished')) as any;
    expect(renderLobby(lobby)).toContain(lobby.code);
    expect(renderLegal({ phase: 'main', canRoll: false, canEndTurn: true, canBuyDevCard: false, settlements: [1], cities: [], citySites: [], settlementSites: [1], roads: [2], roadOpenings: { 2: 1 }, robberTiles: [], stealVictims: [], bankTrades: [], devPlays: [], roleActions: [], acceptableOffers: [], mustDiscard: 0 })).toContain('settle: 1');
  }, 120_000);
});
