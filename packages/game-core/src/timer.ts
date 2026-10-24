import type { Action, ApplyResult } from './actions';
import type { GameEvent } from './events';
import { applyAction, cloneState, forfeitRoadBuilding } from './reducer';
import { finishGame, totalPoints } from './scoring';
import type { Ctx } from './state';
import { legalRobberTiles, legalStealVictims } from './validate';
import { RESOURCES, type GameState, type Hand, type Resource, type Rng } from './types';

/**
 * The timed mode's clock, driven from outside: the caller (the server) asks now and then with the current time. The core never
 * reads a clock itself, so a test hands in whatever time it likes. An untimed or finished game comes back unchanged.
 *
 * - The game time is up: the game ends at once; everyone on the highest score (hidden victory point cards counted) wins.
 * - The turn time is up: whatever is pending is settled with random legal choices (roll, discard, robber, steal; free roads are
 *   given up) and the turn ends. What the player built and traded before that stays.
 * The setup phase has no turn limit (the game time still runs).
 */
export function tickTimers(prev: GameState, rng: Rng, now: number): ApplyResult {
  const { timer } = prev;
  const unchanged: ApplyResult = { ok: true, state: prev, events: [] };
  if (!timer || prev.phase === 'finished' || prev.gameStartedAt === null) return unchanged;

  if (now - prev.gameStartedAt >= timer.gameSeconds * 1000) {
    const ctx: Ctx = { s: cloneState(prev), rng, now, events: [], boardChanged: false };
    const scores = ctx.s.players.map((p) => ({ id: p.id, points: totalPoints(ctx.s, p.id) }));
    const best = Math.max(...scores.map((x) => x.points));
    finishGame(ctx, scores.filter((x) => x.points === best).map((x) => x.id), best, 'time');
    return { ok: true, state: ctx.s, events: ctx.events };
  }

  if (prev.phase === 'setup' || prev.turnStartedAt === null || now - prev.turnStartedAt < timer.turnSeconds * 1000) return unchanged;
  return endTurnForTimeout(prev, rng, now);
}

function endTurnForTimeout(prev: GameState, rng: Rng, now: number): ApplyResult {
  const player = prev.current;
  const events: GameEvent[] = [{ type: 'turnTimedOut', player }];
  let s = prev;
  const step = (pid: string, action: Action): boolean => {
    const r = applyAction(s, pid, action, rng, now);
    if (!r.ok) return false;
    s = r.state;
    events.push(...r.events);
    return true;
  };
  const pickOf = <T>(a: T[]): T => a[Math.floor(rng() * a.length)];

  // every step moves the phase on, so the cap only guards against a rule bug
  for (let guard = 0; guard < 100 && s.phase !== 'main' && s.phase !== 'finished'; guard++) {
    let ok = false;
    if (s.phase === 'roll') ok = step(player, { type: 'roll' });
    else if (s.phase === 'discard') {
      const [pid] = Object.keys(s.pendingDiscards);
      ok = step(pid, { type: 'discard', resources: randomCards(s.players.find((p) => p.id === pid)!.hand, s.pendingDiscards[pid], rng) });
    } else if (s.phase === 'robber') ok = step(player, { type: 'moveRobber', tile: pickOf(legalRobberTiles(s, player)) });
    else if (s.phase === 'steal') ok = step(player, { type: 'steal', victim: pickOf(legalStealVictims(s, player)) });
    else if (s.phase === 'roadBuilding') {
      const r = forfeitRoadBuilding(s, now);
      if (r.ok) {
        s = r.state;
        events.push(...r.events);
        ok = true;
      }
    }
    if (!ok) return { ok: false, error: { type: 'wrongPhase', phase: s.phase } };
  }
  if (s.phase === 'main' && !step(player, { type: 'endTurn' })) return { ok: false, error: { type: 'wrongPhase', phase: s.phase } };
  return { ok: true, state: s, events };
}

/** `n` cards chosen at random from a hand. */
function randomCards(hand: Hand, n: number, rng: Rng): Partial<Hand> {
  const pool: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < hand[r]; i++) pool.push(r);
  const out: Partial<Hand> = {};
  for (let i = 0; i < n && pool.length > 0; i++) {
    const [r] = pool.splice(Math.floor(rng() * pool.length), 1);
    out[r] = (out[r] ?? 0) + 1;
  }
  return out;
}
