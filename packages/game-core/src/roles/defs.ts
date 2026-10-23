import { err } from '../events';
import { PIECE_LIMITS } from '../constants';
import { canAfford, countPieces, getPlayer, isInt, payToBank, topoOf } from '../state';
import type { Hand, PieceKind, Resource } from '../types';
import { RESOURCES } from '../types';
import type { RoleActionDef, RoleDef } from './types';

/**
 * The role list is data. Each entry only declares hooks and actions; the core
 * rules never test for a role by name. Names and descriptions are translations.
 */

/* ---------------- Soldier: demolish ---------------- */

/**
 * What demolishing a rival's piece costs the Soldier, and the only place these numbers live (the balance report
 * changes nothing but this table). The payment goes to the bank; the Soldier gains no points and no cards.
 */
export const DEMOLISH_COSTS: Record<PieceKind, Hand> = {
  road: { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 1 },
  settlement: { lumber: 0, brick: 0, wool: 1, grain: 1, ore: 2 },
  city: { lumber: 0, brick: 0, wool: 2, grain: 2, ore: 3 },
};
export const DEMOLISHES_PER_TURN = 1;
const DEMOLISH_COUNTER = 'demolish';

const isPiece = (x: unknown): x is PieceKind => x === 'road' || x === 'settlement' || x === 'city';

/**
 * A rival's road, settlement or city is demolished. A road and a settlement go back to their owner's stock; a city falls
 * to a settlement (its piece goes back to the stock). The place is empty (or a settlement again) for anyone the distance
 * rule lets build there. Afterwards the longest road is worked out again for everyone and the win check runs, as after any
 * change to the board (the core does both for every action).
 *
 * Refused, each with its own reason: a second demolition in one turn (`perTurnLimit`); a player who was demolished
 * during the last full round (`protected`, with the player and the turn it lasts until); a player's last settlement or city
 * (`lastBuilding`); a city whose owner has no settlement piece left to fall to (`settlementLimit`).
 */
const demolish: RoleActionDef = {
  check(s, pid, params, opts) {
    if (s.current !== pid) return err('notYourTurn');
    if (s.phase !== 'main') return err('wrongPhase', { phase: s.phase });
    const { kind, id } = params;
    if (!isPiece(kind)) return err('invalidTarget');
    const topo = topoOf(s);
    if (!isInt(id, kind === 'road' ? topo.edges.length : topo.vertices.length)) return err('invalidTarget');
    if ((s.turnFlags.counters[DEMOLISH_COUNTER] ?? 0) >= DEMOLISHES_PER_TURN) return err('roleActionRefused', { reason: 'perTurnLimit' });

    let owner: string | undefined;
    if (kind === 'road') owner = s.roads[id];
    else if (s.buildings[id]?.kind === kind) owner = s.buildings[id].owner;
    if (owner === undefined || owner === pid) return err('invalidTarget');

    const until = s.demolishShield[owner];
    if (until !== undefined && s.turn < until) return err('roleActionRefused', { reason: 'protected', player: owner, until });
    const theirs = countPieces(s, owner);
    if (kind !== 'road' && theirs.settlement + theirs.city <= 1) return err('roleActionRefused', { reason: 'lastBuilding', player: owner });
    if (kind === 'city' && theirs.settlement >= PIECE_LIMITS.settlement) return err('roleActionRefused', { reason: 'settlementLimit', player: owner });
    if (!opts.ignoreCost && !canAfford(getPlayer(s, pid).hand, DEMOLISH_COSTS[kind])) {
      return err('cannotAfford', { cost: DEMOLISH_COSTS[kind] });
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
    const cost = DEMOLISH_COSTS[kind];
    payToBank(s, pid, cost);
    let from: string;
    if (kind === 'road') {
      from = s.roads[id];
      delete s.roads[id];
    } else {
      from = s.buildings[id].owner;
      if (kind === 'city') s.buildings[id] = { owner: from, kind: 'settlement' };
      else delete s.buildings[id];
    }
    s.demolishShield[from] = s.turn + s.players.length;
    s.turnFlags.counters[DEMOLISH_COUNTER] = (s.turnFlags.counters[DEMOLISH_COUNTER] ?? 0) + 1;
    ctx.boardChanged = true;
    ctx.events.push({ type: 'demolished', player: pid, from, kind, id, cost: { ...cost } });
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
  { id: 'soldier', actions: { demolish } },
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
