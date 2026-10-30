import type { GameEvent } from './events';
import type { Topology } from './maps/topology';
import { topologyOf } from './maps/topology';
import { PIECE_LIMITS } from './constants';
import { RESOURCES, type GameState, type Hand, type PieceKind, type Player, type Resource, type Rng } from './types';

/** Mutable working context used while applying one action to a cloned state. */
export interface Ctx {
  s: GameState;
  rng: Rng;
  /** the caller's clock in ms; only read when the game is timed */
  now?: number;
  events: GameEvent[];
  /** set when roads or buildings changed, so awards are recomputed */
  boardChanged: boolean;
}

/* ---------------- hands ---------------- */

export const emptyHand = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
export const handCount = (h: Hand): number => RESOURCES.reduce((s, r) => s + h[r], 0);
export const canAfford = (have: Hand, cost: Hand): boolean => RESOURCES.every((r) => have[r] >= cost[r]);
export const addHands = (a: Hand, b: Partial<Hand>): Hand => {
  const out = emptyHand();
  for (const r of RESOURCES) out[r] = a[r] + (b[r] ?? 0);
  return out;
};
export const isResource = (x: unknown): x is Resource => typeof x === 'string' && (RESOURCES as readonly string[]).includes(x);
export const isInt = (n: unknown, len: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < len;

/** Validates an untrusted partial hand coming from a client; null if malformed. */
export function sanitizeHand(input: unknown): Hand | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = emptyHand();
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isResource(k)) return null;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 99) return null;
    out[k] = v as number;
  }
  return out;
}

/* ---------------- lookups ---------------- */

export const topoOf = (s: Pick<GameState, 'map'>): Topology => topologyOf(s.map);
export const getPlayer = (s: Pick<GameState, 'players'>, id: string): Player => s.players.find((p) => p.id === id)!;
export const hasPlayer = (s: Pick<GameState, 'players'>, id: unknown): boolean => s.players.some((p) => p.id === id);

/** True when both are on the same team of a team-mode game; always false in a normal game and for the same player. */
export function sameTeam(s: Pick<GameState, 'players' | 'teamMode'>, a: string, b: string): boolean {
  if (!s.teamMode || a === b) return false;
  const ta = s.players.find((p) => p.id === a)?.team ?? null;
  return ta !== null && ta === s.players.find((p) => p.id === b)?.team;
}

export function countPieces(s: Pick<GameState, 'roads' | 'buildings'>, pid: string): Record<PieceKind, number> {
  const out = { road: 0, settlement: 0, city: 0 };
  for (const o of Object.values(s.roads)) if (o === pid) out.road++;
  for (const b of Object.values(s.buildings)) if (b.owner === pid) out[b.kind]++;
  return out;
}

export const pieceLimitReached = (s: Pick<GameState, 'roads' | 'buildings'>, pid: string, piece: PieceKind): boolean =>
  countPieces(s, pid)[piece] >= PIECE_LIMITS[piece];

/* ---------------- bank <-> hands (the only place cards move) ---------------- */

/** Player pays `cost` to the bank. Caller has checked affordability. */
export function payToBank(s: GameState, pid: string, cost: Partial<Hand>) {
  const p = getPlayer(s, pid);
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    p.hand[r] -= n;
    s.bank[r] += n;
  }
}

/** Bank gives `gains` to a player, never more than the bank holds. Returns what was actually given. */
export function grantFromBank(s: GameState, pid: string, gains: Partial<Hand>): Hand {
  const p = getPlayer(s, pid);
  const given = emptyHand();
  for (const r of RESOURCES) {
    const n = Math.min(gains[r] ?? 0, s.bank[r]);
    if (n <= 0) continue;
    s.bank[r] -= n;
    p.hand[r] += n;
    given[r] = n;
  }
  return given;
}

/**
 * TEST ONLY (the server calls it only when `ADA_TEST_RESOURCES` is set in a test environment): every player gets up to
 * `each` cards of every resource, taken from the bank. Cards are dealt one at a time around the table, and the player
 * who goes first rotates with the resource, so when the bank runs short nobody (not the last seat) is left out and
 * the shortfall is shared evenly. Bank plus hands stay constant.
 */
export function dealTestHands(s: GameState, each: number): void {
  const n = s.players.length;
  RESOURCES.forEach((r, ri) => {
    for (let round = 0; round < each; round++) {
      for (let k = 0; k < n; k++) {
        if (s.bank[r] <= 0) return;
        s.players[(ri + k) % n].hand[r] += 1;
        s.bank[r] -= 1;
      }
    }
  });
}

export function transfer(s: GameState, from: string, to: string, cards: Partial<Hand>) {
  const a = getPlayer(s, from);
  const b = getPlayer(s, to);
  for (const r of RESOURCES) {
    const n = cards[r] ?? 0;
    a.hand[r] -= n;
    b.hand[r] += n;
  }
}

export interface ValidateOpts {
  /** judge placement as if the player could pay (for highlighting spots in the client) */
  ignoreCost?: boolean;
}
