import { err } from '../events';
import { canAfford, countPieces, getPlayer, isInt, payToBank, pieceLimitReached, topoOf } from '../state';
import type { Hand, PieceKind, Resource } from '../types';
import { RESOURCES } from '../types';
import type { RoleActionDef, RoleDef } from './types';

/**
 * The role list is data. Each entry only declares hooks and actions; the core
 * rules never test for a role by name. Names and descriptions are translations.
 */

/* ---------------- Soldier: capture ---------------- */

const CAPTURE_COSTS: Record<PieceKind, Hand> = {
  road: { lumber: 0, brick: 0, wool: 2, grain: 0, ore: 2 },
  settlement: { lumber: 0, brick: 0, wool: 2, grain: 2, ore: 3 },
  city: { lumber: 0, brick: 0, wool: 3, grain: 3, ore: 5 },
};
const CAPTURES_PER_TURN = 1;
const CAPTURE_COUNTER = 'capture';

const isPiece = (x: unknown): x is PieceKind => x === 'road' || x === 'settlement' || x === 'city';

const capture: RoleActionDef = {
  check(s, pid, params, opts) {
    if (s.current !== pid) return err('notYourTurn');
    if (s.phase !== 'main') return err('wrongPhase', { phase: s.phase });
    const { kind, id } = params;
    if (!isPiece(kind)) return err('invalidTarget');
    const topo = topoOf(s);
    if (!isInt(id, kind === 'road' ? topo.edges.length : topo.vertices.length)) return err('invalidTarget');
    if ((s.turnFlags.counters[CAPTURE_COUNTER] ?? 0) >= CAPTURES_PER_TURN) return err('roleActionRefused', { reason: 'perTurnLimit' });

    let owner: string | undefined;
    if (kind === 'road') owner = s.roads[id];
    else if (s.buildings[id]?.kind === kind) owner = s.buildings[id].owner;
    if (owner === undefined || owner === pid) return err('invalidTarget');

    const guarded = kind === 'road' ? s.protectedUntil.roads[id] : s.protectedUntil.buildings[id];
    if (guarded !== undefined && s.turn < guarded) return err('roleActionRefused', { reason: 'protected', until: guarded });
    if (kind !== 'road') {
      const theirs = countPieces(s, owner);
      if (theirs.settlement + theirs.city <= 1) return err('roleActionRefused', { reason: 'lastBuilding' });
    }
    if (pieceLimitReached(s, pid, kind)) return err('pieceLimit', { piece: kind });
    if (!opts.ignoreCost && !canAfford(getPlayer(s, pid).hand, CAPTURE_COSTS[kind])) {
      return err('cannotAfford', { cost: CAPTURE_COSTS[kind] });
    }
    return null;
  },

  list(s, pid) {
    const out: Record<string, unknown>[] = [];
    for (const [id, owner] of Object.entries(s.roads)) if (owner !== pid) out.push({ kind: 'road', id: Number(id) });
    for (const [id, b] of Object.entries(s.buildings)) if (b.owner !== pid) out.push({ kind: b.kind, id: Number(id) });
    return out;
  },

  apply(ctx, pid, params) {
    const { s } = ctx;
    const kind = params.kind as PieceKind;
    const id = params.id as number;
    payToBank(s, pid, CAPTURE_COSTS[kind]);
    const until = s.turn + s.players.length;
    let from: string;
    if (kind === 'road') {
      from = s.roads[id];
      s.roads[id] = pid;
      s.protectedUntil.roads[id] = until;
    } else {
      from = s.buildings[id].owner;
      s.buildings[id].owner = pid;
      s.protectedUntil.buildings[id] = until;
    }
    s.turnFlags.counters[CAPTURE_COUNTER] = (s.turnFlags.counters[CAPTURE_COUNTER] ?? 0) + 1;
    ctx.boardChanged = true;
    ctx.events.push({ type: 'captured', player: pid, from, kind, id });
  },
};

/* ---------------- passive roles ---------------- */

const pickResource = (bank: Hand, rng: () => number): Resource | null => {
  const stocked = RESOURCES.filter((r) => bank[r] > 0);
  return stocked.length ? stocked[Math.floor(rng() * stocked.length)] : null;
};

const HARVEST_HAND_LIMIT = 3;
const TRADE_BONUS_COUNTER = 'tradeBonus';

export const ROLE_DEFS: RoleDef[] = [
  { id: 'soldier', actions: { capture } },
  {
    id: 'sage',
    devCardCost: (base) => ({ ...base, wool: Math.max(0, base.wool - 1) }),
  },
  {
    id: 'sailor',
    bankRatio: (ratio) => ratio - 1,
  },
  {
    id: 'diplomat',
    onTradeAccepted: ({ counters, bank, rng }) => {
      if ((counters[TRADE_BONUS_COUNTER] ?? 0) >= 1) return;
      const r = pickResource(bank, rng);
      if (r) return { gains: { [r]: 1 }, counter: TRADE_BONUS_COUNTER };
    },
  },
  {
    id: 'harvester',
    // Only on their own roll, only when the dice hit none of their buildings, and only while they hold at most
    // HARVEST_HAND_LIMIT cards: one random card the bank has.
    onProduce: ({ gains, matched, bank, rng, hand, roller, self }) => {
      if (roller !== self || matched || RESOURCES.some((r) => gains[r] > 0)) return;
      if (RESOURCES.reduce((n, r) => n + hand[r], 0) > HARVEST_HAND_LIMIT) return;
      const r = pickResource(bank, rng);
      return r ? { [r]: 1 } : undefined;
    },
  },
];
