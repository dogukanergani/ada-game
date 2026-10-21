import {
  RESOURCES, costFor, devCardCostFor, bankRatioFor, legalMovesFor, topologyOf,
  type Action, type Building, type GameState, type GameView, type Hand, type LegalMoves, type MapDef, type PieceKind, type Phase,
  type Resource, type Rng,
} from '../src';
import { moves as randomMoves, pick, type Move } from './bot';

/**
 * A bot with a plan. It reasons only from what a client knows (a `BotSee`:
 * the board, its own hand and costs) and from the `LegalMoves` the core lists
 * for it, so the same bot drives the balance reports and the CLI's autoplay.
 */
export interface BotSee {
  phase: Phase;
  me: string;
  current: string;
  robber: number;
  map: MapDef;
  buildings: Record<number, Building>;
  hand: Hand;
  costs: Record<PieceKind | 'devCard', Hand>;
  bankRatios: Record<Resource, number>;
}

export function seeOfState(s: GameState, pid: string): BotSee {
  return {
    phase: s.phase,
    me: pid,
    current: s.current,
    robber: s.robber,
    map: s.map,
    buildings: s.buildings,
    hand: s.players.find((p) => p.id === pid)!.hand,
    costs: {
      road: costFor(s, pid, 'road'),
      settlement: costFor(s, pid, 'settlement'),
      city: costFor(s, pid, 'city'),
      devCard: devCardCostFor(s, pid),
    },
    bankRatios: Object.fromEntries(RESOURCES.map((r) => [r, bankRatioFor(s, pid, r)])) as Record<Resource, number>,
  };
}

export function seeOfView(v: GameView): BotSee {
  return {
    phase: v.phase,
    me: v.me,
    current: v.current,
    robber: v.robber,
    map: v.map,
    buildings: v.buildings,
    hand: v.players.find((p) => p.id === v.me)!.hand!,
    costs: v.mine!.costs,
    bankRatios: v.mine!.bankRatios,
  };
}

const canPay = (hand: Hand, cost: Hand) => RESOURCES.every((r) => hand[r] >= cost[r]);
const CAPTURE_VALUE: Partial<Record<PieceKind, number>> = { city: 2, settlement: 1 };

/**
 * The move this bot would make, or null when it has nothing in mind (callers
 * then fall back to `fallbackAction` or to random play). Order of ambition:
 * capture a city or settlement, build a city, a settlement, buy a card, build
 * a road that opens a settlement site, play a knight, trade surplus toward the
 * next goal.
 */
export function greedyAction(see: BotSee, legal: LegalMoves, rng: Rng): Action | null {
  if (see.current !== see.me) return null;
  if (see.phase === 'roll') {
    const knight = legal.devPlays.find((a) => a.type === 'playKnight');
    if (knight && ownsTile(see, see.robber)) return knight;
    return legal.canRoll ? { type: 'roll' } : null;
  }
  if (see.phase === 'robber') return legal.robberTiles.length ? { type: 'moveRobber', tile: bestRobberTile(see, legal.robberTiles, rng) } : null;
  if (see.phase !== 'main') return null;

  const captures = legal.roleActions
    .map((a) => ({ a, value: CAPTURE_VALUE[(a as { params?: { kind?: PieceKind } }).params?.kind as PieceKind] ?? 0 }))
    .filter((x) => x.value > 0)
    .sort((x, y) => y.value - x.value);
  if (captures.length) return captures[0].a;

  if (legal.cities.length) return { type: 'upgradeCity', vertex: pick(legal.cities, rng) };
  if (legal.settlements.length) return { type: 'placeSettlement', vertex: pick(legal.settlements, rng) };
  if (legal.canBuyDevCard) return { type: 'buyDevCard' };
  const openings = Object.entries(legal.roadOpenings);
  if (openings.length) {
    const best = Math.max(...openings.map(([, n]) => n));
    return { type: 'placeRoad', edge: Number(pick(openings.filter(([, n]) => n === best), rng)[0]) };
  }
  const knight = legal.devPlays.find((a) => a.type === 'playKnight');
  if (knight) return knight;
  const trade = surplusTrade(see, legal, rng);
  return trade ? { type: 'bankTrade', ...trade } : null;
}

/** What to do when there is no plan: the forced steps (setup, discarding, stealing, free roads) at random, else end the turn. */
export function fallbackAction(see: BotSee, legal: LegalMoves, rng: Rng): Action | null {
  switch (see.phase) {
    case 'setup':
    case 'roadBuilding':
      if (see.current !== see.me) return null;
      if (legal.settlements.length) return { type: 'placeSettlement', vertex: pick(legal.settlements, rng) };
      return legal.roads.length ? { type: 'placeRoad', edge: pick(legal.roads, rng) } : null;
    case 'discard': {
      if (legal.mustDiscard <= 0) return null;
      const have = { ...see.hand };
      const out: Hand = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
      for (let i = 0; i < legal.mustDiscard; i++) {
        const r = pick(RESOURCES.filter((x) => have[x] > 0), rng);
        have[r]--;
        out[r]++;
      }
      return { type: 'discard', resources: out };
    }
    case 'steal':
      return see.current === see.me && legal.stealVictims.length ? { type: 'steal', victim: pick(legal.stealVictims, rng) } : null;
    case 'main':
      if (legal.acceptableOffers.length && rng() < 0.5) return { type: 'acceptTrade', offerId: legal.acceptableOffers[0] };
      return legal.canEndTurn ? { type: 'endTurn' } : null;
    default:
      return null;
  }
}

function ownsTile(see: BotSee, tile: number): boolean {
  return topologyOf(see.map).tiles[tile].corners.some((v) => see.buildings[v]?.owner === see.me);
}

/** The robber tile hurting rivals most: the most buildings (cities count double) of others, none of mine. */
function bestRobberTile(see: BotSee, tiles: number[], rng: Rng): number {
  const topo = topologyOf(see.map);
  let best: number[] = [];
  let bestScore = -Infinity;
  for (const t of tiles) {
    let score = 0;
    for (const v of topo.tiles[t].corners) {
      const b = see.buildings[v];
      if (!b) continue;
      const w = b.kind === 'city' ? 2 : 1;
      score += b.owner === see.me ? -3 * w : w;
    }
    if (score > bestScore) {
      bestScore = score;
      best = [t];
    } else if (score === bestScore) best.push(t);
  }
  return pick(best, rng);
}

/** Turns a resource the player has plenty of (4+) into the one the next goal lacks most. */
function surplusTrade(see: BotSee, legal: LegalMoves, rng: Rng): { give: Resource; get: Resource } | null {
  // the goal: the next city if a site exists, else a settlement, else a card
  const cost = legal.citySites.length ? see.costs.city : legal.settlementSites.length ? see.costs.settlement : see.costs.devCard;
  const deficit = (r: Resource) => Math.max(0, cost[r] - see.hand[r]);
  const options = legal.bankTrades.filter(
    (t) => see.hand[t.give] >= 4 && see.hand[t.give] >= see.bankRatios[t.give] && deficit(t.give) === 0 && deficit(t.get) > 0,
  );
  if (!options.length) return null;
  const top = Math.max(...options.map((t) => deficit(t.get)));
  return pick(options.filter((t) => deficit(t.get) === top), rng);
}

/** Share of decisions the balance bot leaves to the random bot ("the rest is random"). */
const RANDOM_SHARE = 0.1;

/** The greedy bot as a move generator for simulations: it plans for the player to move, anything else (discards, rivals' turns) is random. */
export function greedyMoves(s: GameState, rng: Rng, actionsThisTurn: number): Move[] {
  if (s.phase === 'discard' || rng() < RANDOM_SHARE) return randomMoves(s, rng, actionsThisTurn);
  const me = s.current;
  const see = seeOfState(s, me);
  const legal = legalMovesFor(s, me);
  const a = greedyAction(see, legal, rng) ?? (s.phase === 'main' ? null : fallbackAction(see, legal, rng));
  if (a) return [{ pid: me, action: a, weight: 1 }];
  // nothing planned: the random bot moves (it ends the turn more eagerly the longer the turn runs)
  return randomMoves(s, rng, actionsThisTurn + 3);
}
