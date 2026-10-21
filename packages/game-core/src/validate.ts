import type { Action } from './actions';
import { BASE_COSTS, DEV_CARD_COST, DEFAULT_DISCARD_LIMIT } from './constants';
import { err, type GameError } from './events';
import { roleOf } from './roles/registry';
import {
  canAfford, getPlayer, handCount, hasPlayer, isInt, isResource, pieceLimitReached, sanitizeHand, topoOf,
  type ValidateOpts,
} from './state';
import { bankRatioFor } from './trade';
import { RESOURCES, type DevCardKind, type GameState, type Hand, type PieceKind, type Resource } from './types';

/**
 * Every rule check lives here. The legal-move listers at the bottom call the
 * same `validate`, so what the client highlights is exactly what the server
 * accepts (including piece limits and costs).
 */

/* ---------------- costs ---------------- */

export function costFor(s: GameState, pid: string, piece: PieceKind): Hand {
  const base = BASE_COSTS[piece];
  return roleOf(s, pid).cost?.(piece, base) ?? { ...base };
}

export function devCardCostFor(s: GameState, pid: string): Hand {
  return roleOf(s, pid).devCardCost?.(DEV_CARD_COST) ?? { ...DEV_CARD_COST };
}

export function discardLimitFor(s: GameState, pid: string): number {
  return roleOf(s, pid).discardLimit ?? DEFAULT_DISCARD_LIMIT;
}

/* ---------------- geometry ---------------- */

type Geo = Pick<GameState, 'map' | 'buildings' | 'roads'>;

const distanceOk = (s: Geo, v: number) => topoOf(s).vertices[v].neighbors.every((n) => !s.buildings[n]) && !s.buildings[v];
const touchesOwnRoad = (s: Geo, v: number, pid: string) => topoOf(s).vertices[v].edges.some((e) => s.roads[e] === pid);

export function roadConnected(s: Geo, edge: number, pid: string): boolean {
  const e = topoOf(s).edges[edge];
  return [e.a, e.b].some((v) => {
    const b = s.buildings[v];
    return b ? b.owner === pid : touchesOwnRoad(s, v, pid);
  });
}

/** A free edge the player could extend to, with piece limit but without cost or phase. */
export function roadSpotOk(s: GameState, pid: string, edge: number): boolean {
  return s.roads[edge] === undefined && roadConnected(s, edge, pid) && !pieceLimitReached(s, pid, 'road');
}

const phaseErr = (s: GameState) => err('wrongPhase', { phase: s.phase });

/* ---------------- placement checks ---------------- */

function checkSettlement(s: GameState, pid: string, v: unknown, opts: ValidateOpts): GameError | null {
  if (!isInt(v, topoOf(s).vertices.length)) return err('invalidTarget');
  if (s.current !== pid) return err('notYourTurn');
  if (s.phase === 'setup') {
    if (s.setup?.step !== 'settlement') return phaseErr(s);
    if (s.buildings[v]) return err('occupied');
    if (!distanceOk(s, v)) return err('distanceRule');
    return null;
  }
  if (s.phase !== 'main') return phaseErr(s);
  if (s.buildings[v]) return err('occupied');
  if (!distanceOk(s, v)) return err('distanceRule');
  if (!touchesOwnRoad(s, v, pid)) return err('notConnected');
  if (pieceLimitReached(s, pid, 'settlement')) return err('pieceLimit', { piece: 'settlement' });
  const cost = costFor(s, pid, 'settlement');
  if (!opts.ignoreCost && !canAfford(getPlayer(s, pid).hand, cost)) return err('cannotAfford', { cost });
  return null;
}

function checkRoad(s: GameState, pid: string, e: unknown, opts: ValidateOpts): GameError | null {
  if (!isInt(e, topoOf(s).edges.length)) return err('invalidTarget');
  if (s.current !== pid) return err('notYourTurn');
  if (s.roads[e] !== undefined) return err('occupied');
  if (s.phase === 'setup') {
    if (s.setup?.step !== 'road' || s.setup.lastSettlement === null) return phaseErr(s);
    return topoOf(s).vertices[s.setup.lastSettlement].edges.includes(e) ? null : err('notConnected');
  }
  if (s.phase !== 'main' && s.phase !== 'roadBuilding') return phaseErr(s);
  if (s.phase === 'roadBuilding' && s.roadBuildingLeft <= 0) return phaseErr(s);
  if (!roadConnected(s, e, pid)) return err('notConnected');
  if (pieceLimitReached(s, pid, 'road')) return err('pieceLimit', { piece: 'road' });
  if (s.phase === 'main') {
    const cost = costFor(s, pid, 'road');
    if (!opts.ignoreCost && !canAfford(getPlayer(s, pid).hand, cost)) return err('cannotAfford', { cost });
  }
  return null;
}

function checkCity(s: GameState, pid: string, v: unknown, opts: ValidateOpts): GameError | null {
  if (!isInt(v, topoOf(s).vertices.length)) return err('invalidTarget');
  if (s.current !== pid) return err('notYourTurn');
  if (s.phase !== 'main') return phaseErr(s);
  const b = s.buildings[v];
  if (!b || b.owner !== pid || b.kind !== 'settlement') return err('invalidTarget');
  if (pieceLimitReached(s, pid, 'city')) return err('pieceLimit', { piece: 'city' });
  const cost = costFor(s, pid, 'city');
  if (!opts.ignoreCost && !canAfford(getPlayer(s, pid).hand, cost)) return err('cannotAfford', { cost });
  return null;
}

/* ---------------- dice, robber, discard ---------------- */

function checkDiscard(s: GameState, pid: string, input: unknown): GameError | null {
  if (s.phase !== 'discard') return phaseErr(s);
  const need = s.pendingDiscards[pid];
  if (!need) return err('invalidTarget', { reason: 'nothingToDiscard' });
  const h = sanitizeHand(input);
  if (!h || handCount(h) !== need) return err('invalidHand', { need });
  if (!canAfford(getPlayer(s, pid).hand, h)) return err('invalidHand', { need });
  return null;
}

function checkMoveRobber(s: GameState, pid: string, tile: unknown): GameError | null {
  if (s.phase !== 'robber') return phaseErr(s);
  if (s.current !== pid) return err('notYourTurn');
  if (!isInt(tile, s.tiles.length) || tile === s.robber) return err('invalidTarget');
  return null;
}

function checkSteal(s: GameState, pid: string, victim: unknown): GameError | null {
  if (s.phase !== 'steal') return phaseErr(s);
  if (s.current !== pid) return err('notYourTurn');
  if (typeof victim !== 'string' || !s.stealFrom.includes(victim)) return err('invalidTarget');
  return null;
}

/* ---------------- trade ---------------- */

function checkBankTrade(s: GameState, pid: string, give: unknown, get: unknown): GameError | null {
  if (s.current !== pid) return err('notYourTurn');
  if (s.phase !== 'main') return phaseErr(s);
  if (!isResource(give) || !isResource(get) || give === get) return err('invalidTrade');
  const ratio = bankRatioFor(s, pid, give);
  if (getPlayer(s, pid).hand[give] < ratio) return err('cannotAfford', { resource: give, ratio });
  if (s.bank[get] < 1) return err('bankLacks', { resource: get });
  return null;
}

function checkOffer(s: GameState, pid: string, giveIn: unknown, wantIn: unknown): GameError | null {
  if (s.current !== pid) return err('notYourTurn');
  if (s.phase !== 'main') return phaseErr(s);
  const give = sanitizeHand(giveIn);
  const want = sanitizeHand(wantIn);
  if (!give || !want || handCount(give) === 0 || handCount(want) === 0) return err('invalidTrade');
  if (RESOURCES.some((r) => give[r] > 0 && want[r] > 0)) return err('invalidTrade');
  if (!canAfford(getPlayer(s, pid).hand, give)) return err('cannotAfford', { cost: give });
  return null;
}

function checkAccept(s: GameState, pid: string, offerId: unknown): GameError | null {
  if (s.phase !== 'main') return phaseErr(s);
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer) return err('noSuchOffer');
  if (offer.from === pid) return err('ownOffer');
  if (!canAfford(getPlayer(s, pid).hand, offer.want)) return err('cannotAfford', { cost: offer.want });
  if (!canAfford(getPlayer(s, offer.from).hand, offer.give)) return err('cannotAfford', { cost: offer.give, player: offer.from });
  return null;
}

function checkCancel(s: GameState, pid: string, offerId: unknown): GameError | null {
  if (s.phase !== 'main') return phaseErr(s);
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer || offer.from !== pid) return err('noSuchOffer');
  return null;
}

/* ---------------- development cards ---------------- */

export function playableDevCard(s: GameState, pid: string, kind: DevCardKind): boolean {
  return getPlayer(s, pid).devCards.some((c) => c.kind === kind && c.boughtTurn < s.turn);
}

function checkBuyDev(s: GameState, pid: string, opts: ValidateOpts): GameError | null {
  if (s.current !== pid) return err('notYourTurn');
  if (s.phase !== 'main') return phaseErr(s);
  if (s.devDeck.length === 0) return err('deckEmpty');
  const cost = devCardCostFor(s, pid);
  if (!opts.ignoreCost && !canAfford(getPlayer(s, pid).hand, cost)) return err('cannotAfford', { cost });
  return null;
}

function checkPlayDev(s: GameState, pid: string, kind: DevCardKind, params: { a?: unknown; b?: unknown; resource?: unknown }): GameError | null {
  if (s.current !== pid) return err('notYourTurn');
  const okPhase = kind === 'knight' ? s.phase === 'roll' || s.phase === 'main' : s.phase === 'main';
  if (!okPhase) return phaseErr(s);
  if (!getPlayer(s, pid).devCards.some((c) => c.kind === kind)) return err('noDevCard', { kind });
  if (!playableDevCard(s, pid, kind)) return err('devCardNotPlayable', { kind, reason: 'boughtThisTurn' });
  if (s.turnFlags.devPlayed) return err('devCardNotPlayable', { kind, reason: 'alreadyPlayed' });
  if (kind === 'roadBuilding') {
    const topo = topoOf(s);
    if (!topo.edges.some((e) => roadSpotOk(s, pid, e.id))) return err('devCardNotPlayable', { kind, reason: 'noRoadSpot' });
  }
  if (kind === 'yearOfPlenty') {
    const { a, b } = params;
    if (!isResource(a) || !isResource(b)) return err('invalidTarget');
    const need: Partial<Record<Resource, number>> = {};
    need[a] = (need[a] ?? 0) + 1;
    need[b] = (need[b] ?? 0) + 1;
    for (const r of RESOURCES) if ((need[r] ?? 0) > s.bank[r]) return err('bankLacks', { resource: r });
  }
  if (kind === 'monopoly' && !isResource(params.resource)) return err('invalidTarget');
  return null;
}

/* ---------------- the single entry point ---------------- */

export function validate(s: GameState, pid: string, a: Action, opts: ValidateOpts = {}): GameError | null {
  if (s.phase === 'finished') return err('gameOver');
  if (!hasPlayer(s, pid)) return err('notInGame');
  if (!a || typeof a !== 'object') return err('invalidAction');
  const x = a as Record<string, unknown>;
  switch (a.type) {
    case 'placeSettlement':
      return checkSettlement(s, pid, x.vertex, opts);
    case 'placeRoad':
      return checkRoad(s, pid, x.edge, opts);
    case 'upgradeCity':
      return checkCity(s, pid, x.vertex, opts);
    case 'roll':
      if (s.current !== pid) return err('notYourTurn');
      return s.phase === 'roll' ? null : phaseErr(s);
    case 'discard':
      return checkDiscard(s, pid, x.resources);
    case 'moveRobber':
      return checkMoveRobber(s, pid, x.tile);
    case 'steal':
      return checkSteal(s, pid, x.victim);
    case 'bankTrade':
      return checkBankTrade(s, pid, x.give, x.get);
    case 'offerTrade':
      return checkOffer(s, pid, x.give, x.want);
    case 'acceptTrade':
      return checkAccept(s, pid, x.offerId);
    case 'cancelTrade':
      return checkCancel(s, pid, x.offerId);
    case 'buyDevCard':
      return checkBuyDev(s, pid, opts);
    case 'playKnight':
      return checkPlayDev(s, pid, 'knight', {});
    case 'playRoadBuilding':
      return checkPlayDev(s, pid, 'roadBuilding', {});
    case 'playYearOfPlenty':
      return checkPlayDev(s, pid, 'yearOfPlenty', { a: x.a, b: x.b });
    case 'playMonopoly':
      return checkPlayDev(s, pid, 'monopoly', { resource: x.resource });
    case 'endTurn':
      if (s.current !== pid) return err('notYourTurn');
      return s.phase === 'main' ? null : phaseErr(s);
    case 'roleAction': {
      if (typeof x.name !== 'string') return err('invalidAction');
      const actions = roleOf(s, pid).actions;
      const def = actions && Object.hasOwn(actions, x.name) ? actions[x.name] : undefined;
      if (!def) return err('unknownRoleAction', { name: x.name });
      const params = x.params;
      if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) return err('invalidAction');
      return def.check(s, pid, (params ?? {}) as Record<string, unknown>, opts);
    }
    default:
      return err('invalidAction');
  }
}

/* ---------------- legal-move listers (built on validate) ---------------- */

export function legalSettlementVertices(s: GameState, pid: string, opts: ValidateOpts = {}): number[] {
  return topoOf(s).vertices.map((v) => v.id).filter((v) => validate(s, pid, { type: 'placeSettlement', vertex: v }, opts) === null);
}

export function legalRoadEdges(s: GameState, pid: string, opts: ValidateOpts = {}): number[] {
  return topoOf(s).edges.map((e) => e.id).filter((e) => validate(s, pid, { type: 'placeRoad', edge: e }, opts) === null);
}

export function legalCityVertices(s: GameState, pid: string, opts: ValidateOpts = {}): number[] {
  return topoOf(s).vertices.map((v) => v.id).filter((v) => validate(s, pid, { type: 'upgradeCity', vertex: v }, opts) === null);
}

export function legalRobberTiles(s: GameState, pid: string): number[] {
  return s.tiles.map((_, i) => i).filter((t) => validate(s, pid, { type: 'moveRobber', tile: t }) === null);
}

export function legalStealVictims(s: GameState, pid: string): string[] {
  return s.players.map((p) => p.id).filter((v) => validate(s, pid, { type: 'steal', victim: v }) === null);
}

export function legalBankTrades(s: GameState, pid: string): { give: Resource; get: Resource }[] {
  const out: { give: Resource; get: Resource }[] = [];
  for (const give of RESOURCES) for (const get of RESOURCES) {
    if (validate(s, pid, { type: 'bankTrade', give, get }) === null) out.push({ give, get });
  }
  return out;
}

/** Concrete development-card plays that are legal right now. */
export function legalDevPlays(s: GameState, pid: string): Action[] {
  const out: Action[] = [];
  const simple: Action[] = [{ type: 'playKnight' }, { type: 'playRoadBuilding' }];
  for (const a of simple) if (validate(s, pid, a) === null) out.push(a);
  for (const resource of RESOURCES) {
    const m: Action = { type: 'playMonopoly', resource };
    if (validate(s, pid, m) === null) out.push(m);
  }
  for (const a of RESOURCES) for (const b of RESOURCES) {
    const y: Action = { type: 'playYearOfPlenty', a, b };
    if (validate(s, pid, y) === null) out.push(y);
  }
  return out;
}

/** Legal role actions right now, as ready-to-send actions. */
export function legalRoleActions(s: GameState, pid: string, opts: ValidateOpts = {}): Action[] {
  if (s.phase === 'finished' || !hasPlayer(s, pid)) return [];
  const actions = roleOf(s, pid).actions ?? {};
  const out: Action[] = [];
  for (const [name, def] of Object.entries(actions)) {
    for (const params of def.list(s, pid, opts)) {
      const a: Action = { type: 'roleAction', name, params };
      if (validate(s, pid, a, opts) === null) out.push(a);
    }
  }
  return out;
}

