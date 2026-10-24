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
  demolitions: Record<string, number>;
  /** per player, in main-phase turns: turns played, turns where a demolition was legal, and cards held at the start of those turns */
  mainTurns: Record<string, { turns: number; demolishLegal: number; cityOrSettlementTargetLegal: number; ore: number }>;
}

export interface DemolitionStats {
  games: number;
  /** games with a soldier at the table */
  soldierGames: number;
  demolitions: number;
  soldierDemolitions: number;
  soldierMainTurns: number;
  soldierTurnsDemolishLegal: number;
  soldierTurnsBigTargetLegal: number;
  soldierOreAtTurnStart: number;
  /** soldier outcomes in games where the soldier demolished at least once, and in games where it did not */
  demolished: { played: number; won: number };
  notDemolished: { played: number; won: number };
}

export interface Measurement {
  demolitionStats: Record<number, DemolitionStats>;
  allDemolitionStats: DemolitionStats;
  overall: RoleTally;
  byCount: Record<number, RoleTally>;
  byMode: Record<string, RoleTally>;
  unfinished: number;
  /** which games hit the step cap: seed (to replay with `playOne`), players, mode, roles in seat order, and where they stood */
  unfinishedGames: { seed: number; players: number; mode: GameMode; roles: string[]; turn: number; phase: string }[];
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
      const f = (facts.mainTurns[me] ??= { turns: 0, demolishLegal: 0, cityOrSettlementTargetLegal: 0, ore: 0 });
      f.turns++;
      if (caps.length) f.demolishLegal++;
      if (caps.some((a) => (a as { params?: { kind?: string } }).params?.kind !== 'road')) f.cityOrSettlementTargetLegal++;
      f.ore += s.players.find((x) => x.id === me)!.hand.ore;
    }
    const m = chooseWeighted(moves(s, rng, actions), rng);
    const r = applyAction(s, m.pid, m.action, rng);
    if (!r.ok) throw new Error(`bot move refused: ${JSON.stringify(m.action)} ${JSON.stringify(r.error)}`);
    s = r.state;
    if (facts) for (const e of r.events) if (e.type === 'demolished') facts.demolitions[e.player] = (facts.demolitions[e.player] ?? 0) + 1;
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
  const unfinishedGames: Measurement['unfinishedGames'] = [];
  let seed = seed0 * 100003;
  const newDemo = (): DemolitionStats => ({ games: 0, soldierGames: 0, demolitions: 0, soldierDemolitions: 0, soldierMainTurns: 0, soldierTurnsDemolishLegal: 0, soldierTurnsBigTargetLegal: 0, soldierOreAtTurnStart: 0, demolished: { played: 0, won: 0 }, notDemolished: { played: 0, won: 0 } });
  const demolitionStats: Record<number, DemolitionStats> = {};
  const allDemolitionStats = newDemo();

  for (let n = 2; n <= 5; n++) {
    byCount[n] = newTally();
    demolitionStats[n] = newDemo();
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
        const facts: GameFacts = { demolitions: {}, mainTurns: {} };
        const gameSeed = seed++;
        const s = playOne(gameSeed, chosen, mode, moves, facts);
        if (s.phase !== 'finished') { unfinished++; unfinishedGames.push({ seed: gameSeed, players: n, mode, roles: chosen, turn: s.turn, phase: s.phase }); continue; }
        for (const c of [demolitionStats[n], allDemolitionStats]) {
          c.games++;
          c.demolitions += Object.values(facts.demolitions).reduce((a, b) => a + b, 0);
          const sol = s.players.find((p) => p.role === 'soldier');
          if (sol) {
            c.soldierGames++;
            const did = facts.demolitions[sol.id] ?? 0;
            c.soldierDemolitions += did;
            const mt = facts.mainTurns[sol.id];
            if (mt) { c.soldierMainTurns += mt.turns; c.soldierTurnsDemolishLegal += mt.demolishLegal; c.soldierTurnsBigTargetLegal += mt.cityOrSettlementTargetLegal; c.soldierOreAtTurnStart += mt.ore; }
            const bucket = did > 0 ? c.demolished : c.notDemolished;
            bucket.played++;
            if (s.winners.includes(sol.id)) bucket.won++;
          }
        }
        for (const p of s.players) {
          for (const t of [overall[p.role], byCount[n][p.role], byMode[mode][p.role]]) {
            t.played++;
            t.expected += 1 / n;
            if (s.winners.includes(p.id)) t.won++;
          }
        }
      }
    }
  }
  return { overall, byCount, byMode, unfinished, unfinishedGames, demolitionStats, allDemolitionStats };
}

export const rate = (t: Tally) => (t.played ? t.won / t.played : NaN);
/** Win rate minus the equal share, in percentage points. */
export const gap = (t: Tally) => (t.played ? ((t.won - t.expected) / t.played) * 100 : NaN);
