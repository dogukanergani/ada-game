import { ROLE_LIST, applyAction, createGame, legalRoleActions, type GameMode, type GameState } from '../src';
import { chooseWeighted, type Move } from './bot';
import { mulberry32 } from './rng';

export type MoveFn = (s: GameState, rng: () => number, actionsThisTurn: number) => Move[];
export interface Tally { played: number; won: number; expected: number; }
export type RoleTally = Record<string, Tally>;

export const ROLE_IDS = ROLE_LIST.map((r) => r.id);
export const MAX_STEPS = 6000;
export const newTally = (): RoleTally => Object.fromEntries(ROLE_IDS.map((r) => [r, { played: 0, won: 0, expected: 0 }]));

/** What happened in one game besides who won. */
export interface GameFacts {
  captures: Record<string, number>;
  /** per player, in main-phase turns: turns played, turns where a capture was legal, and cards held at the start of those turns */
  mainTurns: Record<string, { turns: number; captureLegal: number; cityOrSettlementTargetLegal: number; ore: number }>;
}

export interface CaptureStats {
  games: number;
  /** games with a soldier at the table */
  soldierGames: number;
  captures: number;
  soldierCaptures: number;
  soldierMainTurns: number;
  soldierTurnsCaptureLegal: number;
  soldierTurnsBigTargetLegal: number;
  soldierOreAtTurnStart: number;
  /** soldier outcomes in games where the soldier captured at least once, and in games where it did not */
  captured: { played: number; won: number };
  notCaptured: { played: number; won: number };
}

export interface Measurement {
  captureStats: Record<number, CaptureStats>;
  allCaptureStats: CaptureStats;
  overall: RoleTally;
  byCount: Record<number, RoleTally>;
  byMode: Record<string, RoleTally>;
  unfinished: number;
}

/** Plays one game to the end; returns the final state (phase 'finished' unless the step cap was hit). */
export function playOne(seed: number, chosen: string[], mode: GameMode, moves: MoveFn, facts?: GameFacts): GameState {
  const rng = mulberry32(seed);
  const created = createGame({ players: chosen.map((role, i) => ({ id: `p${i}`, name: `P${i}`, role })), mode }, rng);
  if (!created.ok) throw new Error(`createGame failed: ${JSON.stringify(created.error)}`);
  let s = created.state;
  let actions = 0;
  let lastTurn = s.turn;
  let probedTurn = -1;
  for (let step = 0; step < MAX_STEPS && s.phase !== 'finished'; step++) {
    if (facts && s.phase === 'main' && probedTurn !== s.turn && s.players.find((x) => x.id === s.current)!.role === 'soldier') {
      // looked at once per turn, the first time the soldier is in the main phase
      probedTurn = s.turn;
      const me = s.current;
      const caps = legalRoleActions(s, me);
      const f = (facts.mainTurns[me] ??= { turns: 0, captureLegal: 0, cityOrSettlementTargetLegal: 0, ore: 0 });
      f.turns++;
      if (caps.length) f.captureLegal++;
      if (caps.some((a) => (a as { params?: { kind?: string } }).params?.kind !== 'road')) f.cityOrSettlementTargetLegal++;
      f.ore += s.players.find((x) => x.id === me)!.hand.ore;
    }
    const m = chooseWeighted(moves(s, rng, actions), rng);
    const r = applyAction(s, m.pid, m.action, rng);
    if (!r.ok) throw new Error(`bot move refused: ${JSON.stringify(m.action)} ${JSON.stringify(r.error)}`);
    s = r.state;
    if (facts) for (const e of r.events) if (e.type === 'captured') facts.captures[e.player] = (facts.captures[e.player] ?? 0) + 1;
    if (s.turn !== lastTurn) { lastTurn = s.turn; actions = 0; } else actions++;
  }
  return s;
}

/**
 * `games` games per player count and mode. Roles are spread evenly: for each
 * player count the least-played roles are picked first (ties at random), so
 * every role plays the same number of games. Seeds are fixed by `seed`.
 */
export function measure(moves: MoveFn, games: number, seed0: number): Measurement {
  const overall = newTally();
  const byCount: Record<number, RoleTally> = {};
  const byMode: Record<string, RoleTally> = { standard: newTally(), short: newTally() };
  let unfinished = 0;
  let seed = seed0 * 100003;
  const newCap = (): CaptureStats => ({ games: 0, soldierGames: 0, captures: 0, soldierCaptures: 0, soldierMainTurns: 0, soldierTurnsCaptureLegal: 0, soldierTurnsBigTargetLegal: 0, soldierOreAtTurnStart: 0, captured: { played: 0, won: 0 }, notCaptured: { played: 0, won: 0 } });
  const captureStats: Record<number, CaptureStats> = {};
  const allCaptureStats = newCap();

  for (let n = 2; n <= 5; n++) {
    byCount[n] = newTally();
    captureStats[n] = newCap();
    const plays = Object.fromEntries(ROLE_IDS.map((r) => [r, 0]));
    for (const mode of ['standard', 'short'] as GameMode[]) {
      const pickRng = mulberry32(seed++);
      for (let g = 0; g < games; g++) {
        const order = [...ROLE_IDS].sort((a, b) => plays[a] - plays[b] || pickRng() - 0.5);
        const lowest = plays[order[n - 1]];
        const must = order.filter((r) => plays[r] < lowest);
        const tied = order.filter((r) => plays[r] === lowest);
        const chosen = [...must];
        while (chosen.length < n) chosen.push(tied.splice(Math.floor(pickRng() * tied.length), 1)[0]);
        for (const r of chosen) plays[r]++;
        const facts: GameFacts = { captures: {}, mainTurns: {} };
        const s = playOne(seed++, chosen, mode, moves, facts);
        if (s.phase !== 'finished') { unfinished++; continue; }
        for (const c of [captureStats[n], allCaptureStats]) {
          c.games++;
          c.captures += Object.values(facts.captures).reduce((a, b) => a + b, 0);
          const sol = s.players.find((p) => p.role === 'soldier');
          if (sol) {
            c.soldierGames++;
            const did = facts.captures[sol.id] ?? 0;
            c.soldierCaptures += did;
            const mt = facts.mainTurns[sol.id];
            if (mt) { c.soldierMainTurns += mt.turns; c.soldierTurnsCaptureLegal += mt.captureLegal; c.soldierTurnsBigTargetLegal += mt.cityOrSettlementTargetLegal; c.soldierOreAtTurnStart += mt.ore; }
            const bucket = did > 0 ? c.captured : c.notCaptured;
            bucket.played++;
            if (s.winner === sol.id) bucket.won++;
          }
        }
        for (const p of s.players) {
          for (const t of [overall[p.role], byCount[n][p.role], byMode[mode][p.role]]) {
            t.played++;
            t.expected += 1 / n;
            if (p.id === s.winner) t.won++;
          }
        }
      }
    }
  }
  return { overall, byCount, byMode, unfinished, captureStats, allCaptureStats };
}

export const rate = (t: Tally) => (t.played ? t.won / t.played : NaN);
/** Win rate minus the equal share, in percentage points. */
export const gap = (t: Tally) => (t.played ? ((t.won - t.expected) / t.played) * 100 : NaN);
