import { expect } from 'vitest';
import { legalMovesFor, topologyOf, viewFor, type GameState, type Rng } from '@ada/game-core';
import { chooseWeighted, moves } from '../../game-core/sim/bot';
import { mulberry32 } from '../../game-core/sim/rng';
import { TestClient, startServer } from './harness';

/** Shared helpers for tests that play whole games over real sockets. */

export async function setup(n: number, mode: 'standard' | 'short', rng?: Rng) {
  const { server, url } = await startServer(rng ? { rng } : {});
  const players: TestClient[] = [];
  for (let i = 0; i < n; i++) players.push(await TestClient.login(url));
  const { code } = await players[0].emit('room:create', { name: 'P0' });
  for (let i = 1; i < n; i++) expect(await players[i].emit('room:join', { code, name: `P${i}` })).toMatchObject({ ok: true });
  expect(await players[0].emit('lobby:setMode', { mode })).toMatchObject({ ok: true });
  return { server, url, players, code };
}

export type Setup = Awaited<ReturnType<typeof setup>>;
export const stateOf = (server: Setup['server'], code: string): GameState => server.store.get(code)!.game!;

/** What `inspect` gets for every message a client received because of one step. */
export interface Inspection {
  pid: string;
  event: string;
  payload: any;
  /** the server's state before and after the action that caused the message */
  before: GameState;
  after: GameState;
  /** the whole development deck as it was when the game started, in order */
  initialDeck: string[];
}

export interface PlayResult {
  steps: number;
  final: GameState;
}

/**
 * Plays a started game to its end through the sockets. The bots read the
 * server's state only to pick a legal move; every move travels as a
 * `game:action` message. After each step every client must hold exactly the
 * view the core computes for it, and `inspect` sees every message received.
 */
export async function playOut(
  server: Setup['server'],
  code: string,
  players: TestClient[],
  seed: number,
  opts: { maxSteps?: number; inspect?: (i: Inspection) => void } = {},
): Promise<PlayResult> {
  const rng = mulberry32(seed);
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const initialDeck = [...stateOf(server, code).devDeck] as string[];
  let actions = 0;
  let lastTurn = -1;
  let steps = 0;
  const checked = new Map(players.map((p) => [p, 0]));
  for (; steps < (opts.maxSteps ?? 6000); steps++) {
    const before = structuredClone(stateOf(server, code));
    if (before.phase === 'finished') break;
    if (before.turn !== lastTurn) {
      lastTurn = before.turn;
      actions = 0;
    }
    const m = chooseWeighted(moves(before, rng, actions), rng);
    actions++;
    const marks = players.map((p) => p.mark());
    const ack = await byId.get(m.pid)!.emit('game:action', m.action);
    expect(ack, JSON.stringify(m.action)).toEqual({ ok: true });
    const after = stateOf(server, code);

    for (const [i, p] of players.entries()) {
      const upd = await p.until('game:update', () => true, marks[i]);
      // what arrived is exactly this player's own view of the real state
      expect(JSON.stringify(upd.view)).toBe(JSON.stringify(viewFor(after, p.playerId)));
      // and its own options, computed by the core for it alone
      expect(upd.legal).toEqual(legalMovesFor(after, p.playerId));
      for (const l of p.log.slice(checked.get(p)!)) {
        opts.inspect?.({ pid: p.playerId, event: l.event, payload: l.args[0], before, after, initialDeck });
      }
      checked.set(p, p.log.length);
    }
  }
  return { steps, final: stateOf(server, code) };
}

/* ---------------- looking for the development deck in a message ---------------- */

/** Every stretch of `len` consecutive cards of the deck, written the way they would appear inside a JSON array. */
export function deckWindows(deck: string[], len = 6): string[] {
  const out: string[] = [];
  for (let i = 0; i + len <= deck.length; i++) out.push(deck.slice(i, i + len).map((k) => JSON.stringify(k)).join(','));
  return out;
}

/** The first stretch of the real deck order found in `raw`, or null. */
export function findDeckStretch(raw: string, deck: string[], len = 6): string | null {
  return deckWindows(deck, len).find((w) => raw.includes(w)) ?? null;
}

/**
 * The check this suite used before: the first four cards of the *current*
 * deck, and the whole deck, as JSON arrays. A deck of fewer than four cards
 * serialises to things like "[]" or ["knight"], which appear in innocent
 * messages; kept here only to reproduce and explain that false alarm.
 */
export function naiveDeckHit(raw: string, deck: string[]): string | null {
  const top = JSON.stringify(deck.slice(0, 4));
  if (raw.includes(top)) return top;
  const all = JSON.stringify(deck);
  return raw.includes(all) ? all : null;
}

/** The strict leak check, run on one message. Throws (via expect) on a leak. */
export function assertNoLeak({ pid, event, payload, before, after, initialDeck }: Inspection) {
  const raw = JSON.stringify(payload ?? null);
  // a finished game opens every hand and hidden point card to everyone, by design
  const revealed = payload?.view?.phase === 'finished';
  expect(raw, `${event} mentions the deck`).not.toMatch(/"devDeck"/);

  // the deck's order never appears, not even a stretch of 6 cards of it
  expect(findDeckStretch(raw, initialDeck), 'a stretch of the deck order leaked').toBeNull();

  for (const s of [before, after]) {
    if (s.phase === 'finished' || revealed) continue;
    // no card an opponent holds appears, unless this player holds the identical card
    const own = (s.players.find((p) => p.id === pid)?.devCards ?? []).map((c) => JSON.stringify(c));
    for (const other of s.players.filter((p) => p.id !== pid)) {
      for (const card of other.devCards) {
        const c = JSON.stringify(card);
        if (!own.includes(c)) expect(raw.includes(c), `opponent card ${c} leaked`).toBe(false);
      }
    }
  }
  if (event !== 'game:update' && event !== 'game:snapshot') {
    expect(raw, `${event} carries game data`).not.toMatch(/"(hand|devCards|hiddenPoints|devDeckCount)"/);
    return;
  }
  // the game clock is public (server time elapsed): exactly two fields, a number and a flag, and nothing else rides along
  // (the timed mode adds the time left on its clocks, also public: two numbers, or null when the game is untimed or over)
  expect(Object.keys(payload).sort()).toEqual(['clock', 'events', 'legal', 'timerClock', 'view']);
  if (payload.timerClock !== null) {
    expect(Object.keys(payload.timerClock).sort()).toEqual(['gameRemainingMs', 'turnRemainingMs']);
    expect(Number.isFinite(payload.timerClock.gameRemainingMs) && payload.timerClock.gameRemainingMs >= 0).toBe(true);
    expect(payload.timerClock.turnRemainingMs === null || payload.timerClock.turnRemainingMs >= 0).toBe(true);
  }
  expect(Object.keys(payload.clock).sort()).toEqual(['elapsedMs', 'running']);
  expect(Number.isFinite(payload.clock.elapsedMs) && payload.clock.elapsedMs >= 0 && typeof payload.clock.running === 'boolean').toBe(true);
  const view = payload.view;
  expect(view.me).toBe(pid);
  if (view.phase !== 'finished') {
    for (const p of view.players) {
      if (p.id === pid) continue;
      expect(p.hand, 'opponent hand').toBeNull();
      expect(p.devCards, 'opponent dev cards').toBeNull();
      expect(p.hiddenPoints, 'opponent hidden points').toBeNull();
      expect(typeof p.handCount).toBe('number');
      expect(typeof p.devCardCount).toBe('number');
    }
  }
  for (const e of payload.events) {
    if (e.type === 'stolen' && e.thief !== pid && e.victim !== pid) expect(e.resource, 'stolen card shown to a bystander').toBeNull();
    if (e.type === 'devCardBought' && e.player !== pid) expect(e.kind, 'bought card shown to others').toBeNull();
    if (e.type === 'diceRolled') {
      // the tile lists are public board facts: this client could work them out from what it already sees, and nothing else rides along
      expect(Object.keys(e).sort(), 'diceRolled carries extra fields').toEqual(['dice', 'hitTiles', 'player', 'robbedTile', 'total', 'type']);
      const topo = topologyOf(view.map);
      const hit: number[] = [];
      let robbed: number | null = null;
      view.tiles.forEach((t: any, i: number) => {
        if (t.kind === 'desert' || t.number !== e.total) return;
        if (i === view.robber) robbed = i;
        else if (topo.tiles[i].corners.some((v) => view.buildings[v])) hit.push(i);
      });
      expect(e.hitTiles, 'hitTiles are not derivable from the public view').toEqual(hit);
      expect(e.robbedTile).toBe(robbed);
    }
  }
}
