import { describe, expect, it } from 'vitest';
import { viewFor, type Team } from '@ada/game-core';
import { PROTOCOL_VERSION } from '@ada/protocol';
import * as lobby from '../src/rooms/lobby';
import type { Room } from '../src/rooms/room';
import { assertNoLeak, playOut, setup, stateOf } from './gameplay';

const errKey = (r: { ok: boolean } & Record<string, any>) => (r.ok ? null : r.error.key);

const lobbyRoom = (...extra: string[]): Room => {
  const r = lobby.newRoom('ABCD', 'host', 'Host');
  for (const id of extra) lobby.addPlayer(r, id, id.toUpperCase());
  return r;
};

describe('team mode lobby (rules)', () => {
  it('is off by default; only the host switches it, and switching clears every pick', () => {
    const r = lobbyRoom('a', 'b', 'c');
    expect(r.teamMode).toBe(false);
    expect(errKey(lobby.setTeam(r, 'a', 'A'))).toBe('badTeams');
    expect(errKey(lobby.setTeamMode(r, 'a', true))).toBe('notHost');
    expect(lobby.setTeamMode(r, 'host', true).ok).toBe(true);
    expect(lobby.setTeam(r, 'a', 'A').ok).toBe(true);
    expect(lobby.lobbyViewFor(r, 'a').players.find((p) => p.id === 'a')!.team).toBe('A');
    expect(lobby.setTeamMode(r, 'host', false).ok).toBe(true);
    expect(r.seats.every((s) => s.team === null)).toBe(true);
    expect(lobby.lobbyViewFor(r, 'a').players.every((p) => p.team === null)).toBe(true);
    expect(lobby.lobbyViewFor(r, 'a').teamMode).toBe(false);
  });

  it('lets everyone pick their own side, two at most per team, and step out', () => {
    const r = lobbyRoom('a', 'b', 'c');
    lobby.setTeamMode(r, 'host', true);
    expect(lobby.setTeam(r, 'host', 'A').ok).toBe(true);
    expect(lobby.setTeam(r, 'a', 'A').ok).toBe(true);
    expect(lobby.setTeam(r, 'b', 'A')).toMatchObject({ ok: false, error: { key: 'teamFull', team: 'A' } });
    expect(lobby.setTeam(r, 'b', 'B').ok).toBe(true);
    expect(lobby.setTeam(r, 'a', 'A').ok).toBe(true); // picking the team you are already on is fine even when it is full
    expect(lobby.setTeam(r, 'a', null).ok).toBe(true);
    expect(lobby.setTeam(r, 'b', 'A').ok).toBe(true); // the freed place can be taken
    expect(errKey(lobby.setTeam(r, 'nobody', 'A'))).toBe('notInRoom');
    expect(errKey(lobby.setTeam(r, 'a', 'C' as Team))).toBe('badTeams');
    r.phase = 'playing';
    expect(errKey(lobby.setTeam(r, 'a', 'B'))).toBe('notInLobby');
  });

  it('starts only with exactly 4 players and two on each team', () => {
    const rng = () => 0.3;
    const r = lobbyRoom('a', 'b');
    lobby.setTeamMode(r, 'host', true);
    for (const [id, t] of [['host', 'A'], ['a', 'A'], ['b', 'B']] as const) lobby.setTeam(r, id, t);
    expect(lobby.planStart(r, 'host', rng)).toMatchObject({ ok: false, error: { key: 'badTeams', reason: 'playerCount', need: 4, have: 3 } });
    lobby.addPlayer(r, 'c', 'C');
    expect(lobby.planStart(r, 'host', rng)).toMatchObject({ ok: false, error: { key: 'badTeams', reason: 'assignment', A: 2, B: 1 } });
    lobby.setTeam(r, 'c', 'B');
    const plan = lobby.planStart(r, 'host', rng);
    expect(plan).toMatchObject({ ok: true, teams: { host: 'A', a: 'A', b: 'B', c: 'B' } });
    lobby.addPlayer(r, 'd', 'D'); // a fifth player
    expect(lobby.planStart(r, 'host', rng)).toMatchObject({ ok: false, error: { key: 'badTeams', reason: 'playerCount', have: 5 } });
  });

  it('a game without the mode plans no teams', () => {
    const r = lobbyRoom('a');
    expect(lobby.planStart(r, 'host', () => 0.3)).toMatchObject({ ok: true });
    expect((lobby.planStart(r, 'host', () => 0.3) as any).teams).toBeUndefined();
  });
});

describe('team mode over real sockets', () => {
  async function teamLobby() {
    const s = await setup(4, 'short');
    const { players } = s;
    expect(await players[0].emit('lobby:setMode', { mode: 'custom', targetScore: 5 })).toMatchObject({ ok: true });
    return s;
  }

  it('the lobby view carries the mode and the picks; a malformed payload is refused', async () => {
    const { players } = await teamLobby();
    expect(errKey(await players[1].emit('lobby:setTeamMode', { on: true }))).toBe('notHost');
    expect(errKey(await players[0].emit('lobby:setTeamMode', { on: 'yes' }))).toBe('badPayload');
    expect(errKey(await players[0].emit('lobby:setTeamMode', {}))).toBe('badPayload');
    expect(await players[0].emit('lobby:setTeamMode', { on: true })).toMatchObject({ ok: true });
    expect(errKey(await players[1].emit('lobby:setTeam', { team: 'C' }))).toBe('badPayload');
    expect(errKey(await players[1].emit('lobby:setTeam', {}))).toBe('badPayload');
    const mark = players[0].mark();
    expect(await players[1].emit('lobby:setTeam', { team: 'B' })).toMatchObject({ ok: true });
    const l = (await players[0].until('lobby:update', (x: any) => x.players.some((p: any) => p.team === 'B'), mark)) as any;
    expect(l.teamMode).toBe(true);
    expect(l.players.map((p: any) => p.team)).toEqual([null, 'B', null, null]);
  });

  it('the host cannot start until the teams are right', async () => {
    const { players } = await teamLobby();
    await players[0].emit('lobby:setTeamMode', { on: true });
    expect((await players[0].emit('lobby:start')).error).toMatchObject({ key: 'badTeams', reason: 'assignment' });
    const pick: Team[] = ['A', 'A', 'A', 'B'];
    for (const [i, t] of pick.entries()) {
      const r = await players[i].emit('lobby:setTeam', { team: t });
      if (i === 2) expect(errKey(r)).toBe('teamFull');
    }
    expect((await players[0].emit('lobby:start')).error).toMatchObject({ key: 'badTeams', reason: 'assignment' });
  });

  it('plays a 4-player team game from the lobby to a team win, with gifts off turn, and nothing secret leaks', async () => {
    const { server, players, code } = await teamLobby();
    await players[0].emit('lobby:setTeamMode', { on: true });
    const sides: Team[] = ['A', 'B', 'A', 'B'];
    for (const [i, t] of sides.entries()) expect(await players[i].emit('lobby:setTeam', { team: t })).toMatchObject({ ok: true });
    expect(await players[0].emit('lobby:start')).toEqual({ ok: true });
    for (const p of players) await p.until('game:snapshot');

    const start = stateOf(server, code);
    expect(start.teamMode).toBe(true);
    expect(start.teamTarget).toBe(10);
    for (const [i, p] of players.entries()) expect(start.players.find((q) => q.id === p.playerId)!.team).toBe(sides[i]);

    let gifts = 0;
    let offTurnGifts = 0;
    const r = await playOut(server, code, players, 2024, {
      maxSteps: 6000,
      inspect: (i) => {
        assertNoLeak(i);
        for (const e of i.payload?.events ?? []) {
          if (e.type !== 'teamGifted') continue;
          // public, like an accepted trade: every client gets the whole event (the cards are not masked for outsiders)
          expect(Object.keys(e).sort()).toEqual(['cards', 'from', 'to', 'type']);
          expect(Object.values(e.cards).reduce((a: number, b: any) => a + b, 0)).toBeGreaterThan(0);
          const from = i.after.players.find((p) => p.id === e.from)!;
          const to = i.after.players.find((p) => p.id === e.to)!;
          expect(from.team).toBe(to.team);
          expect(from.id).not.toBe(to.id);
          if (i.pid === e.from) {
            gifts++;
            if (i.before.current !== e.from) offTurnGifts++;
          }
        }
        // a teammate's hidden points stay hidden, and the team total a view shows only adds the viewer's own cards
        if (i.event === 'game:update' || i.event === 'game:snapshot') {
          const v = i.payload.view;
          if (v.phase !== 'finished') {
            expect(v.teamMode).toBe(true);
            const mine = v.players.find((p: any) => p.id === i.pid);
            const mate = v.players.find((p: any) => p.team === mine.team && p.id !== i.pid);
            expect(mate.hiddenPoints).toBeNull();
            expect(mate.hand).toBeNull();
            expect(v.teamPoints[mine.team]).toBe(v.players.filter((p: any) => p.team === mine.team).reduce((a: number, p: any) => a + p.points, 0) + mine.hiddenPoints);
          }
        }
      },
    });
    expect(r.final.phase, `unfinished after ${r.steps} steps`).toBe('finished');
    expect(gifts).toBeGreaterThan(0);
    expect(offTurnGifts).toBeGreaterThan(0);

    // a whole team wins and everyone is told
    const winners = r.final.winners;
    expect(winners).toHaveLength(2);
    expect(r.final.players.filter((p) => winners.includes(p.id)).map((p) => p.team)).toEqual([r.final.players.find((p) => p.id === winners[0])!.team, r.final.players.find((p) => p.id === winners[0])!.team]);
    for (const p of players) {
      const upd = (await p.until('game:update', (u: any) => u.view.phase === 'finished')) as any;
      expect(upd.view.winners).toEqual(winners);
      expect(upd.view.teamPoints).toEqual(viewFor(r.final, p.playerId).teamPoints);
    }
  }, 180_000);

  it('a gift arrives off turn through the socket, and a malformed one is refused before the core', async () => {
    const { server, players, code } = await teamLobby();
    await players[0].emit('lobby:setTeamMode', { on: true });
    for (const [i, t] of (['A', 'B', 'A', 'B'] as Team[]).entries()) await players[i].emit('lobby:setTeam', { team: t });
    await players[0].emit('lobby:start');
    for (const p of players) await p.until('game:snapshot');
    // put cards in a hand (test only) and make the state one where gifts are allowed
    const game = stateOf(server, code);
    game.phase = 'main';
    game.setup = null;
    game.turn = 1;
    const [a, b] = game.players.filter((p) => p.team === 'A');
    game.current = a.id;
    a.hand.lumber = 0;
    b.hand.lumber += 3;
    game.bank.lumber -= 3;
    const sender = players.find((p) => p.playerId === b.id)!;
    expect(errKey(await sender.emit('game:action', { type: 'teamGift', to: a.id }))).toBe('badPayload');
    expect(errKey(await sender.emit('game:action', { type: 'teamGift', to: a.id, cards: { gold: 1 } }))).toBe('badPayload');
    const opp = game.players.find((p) => p.team === 'B' && p.id !== b.id)!;
    expect((await sender.emit('game:action', { type: 'teamGift', to: opp.id, cards: { lumber: 1 } })).error).toMatchObject({ key: 'game', error: { type: 'invalidTarget' } });
    expect(await sender.emit('game:action', { type: 'teamGift', to: a.id, cards: { lumber: 2 } })).toEqual({ ok: true });
    expect(stateOf(server, code).players.find((p) => p.id === a.id)!.hand.lumber).toBe(2);
    expect(PROTOCOL_VERSION).toBe(4);
  });
});
