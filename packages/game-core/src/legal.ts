import type { Action } from './actions';
import { applyAction } from './reducer';
import {
  legalBankTrades, legalCityVertices, legalDevPlays, legalRoadEdges, legalRobberTiles, legalRoleActions, legalSettlementVertices,
  legalStealVictims, validate,
} from './validate';
import type { GameState, Phase, Resource } from './types';

/**
 * Everything one player may do right now, built from the same functions that
 * validate moves. A client uses it to highlight moves (or to let a bot pick),
 * the server hands it to a player who asks. It describes only that player's
 * own options.
 */
export interface LegalMoves {
  phase: Phase;
  canRoll: boolean;
  canEndTurn: boolean;
  canBuyDevCard: boolean;
  settlements: number[];
  cities: number[];
  /** sites for a city / settlement if the player could pay (what to save up for) */
  citySites: number[];
  settlementSites: number[];
  roads: number[];
  /** for the roads above, how many more settlement sites each one would open (only roads that open some) */
  roadOpenings: Record<number, number>;
  robberTiles: number[];
  stealVictims: string[];
  bankTrades: { give: Resource; get: Resource }[];
  devPlays: Action[];
  roleActions: Action[];
  acceptableOffers: number[];
  /** how many cards this player still has to discard (0 when none) */
  mustDiscard: number;
}

const FLAT = () => 0.5;

export function legalMovesFor(s: GameState, pid: string): LegalMoves {
  const settlements = legalSettlementVertices(s, pid);
  const roads = legalRoadEdges(s, pid);
  const settlementSites = legalSettlementVertices(s, pid, { ignoreCost: true });
  const roadOpenings: Record<number, number> = {};
  if (s.phase === 'main' && roads.length) {
      for (const edge of roads) {
      const r = applyAction(s, pid, { type: 'placeRoad', edge }, FLAT);
      if (!r.ok) continue;
      const gain = legalSettlementVertices(r.state, pid, { ignoreCost: true }).length - settlementSites.length;
      if (gain > 0) roadOpenings[edge] = gain;
    }
  }
  return {
    phase: s.phase,
    canRoll: validate(s, pid, { type: 'roll' }) === null,
    canEndTurn: validate(s, pid, { type: 'endTurn' }) === null,
    canBuyDevCard: validate(s, pid, { type: 'buyDevCard' }) === null,
    settlements,
    cities: legalCityVertices(s, pid),
    citySites: legalCityVertices(s, pid, { ignoreCost: true }),
    settlementSites,
    roads,
    roadOpenings,
    robberTiles: legalRobberTiles(s, pid),
    stealVictims: legalStealVictims(s, pid),
    bankTrades: legalBankTrades(s, pid),
    devPlays: legalDevPlays(s, pid),
    roleActions: legalRoleActions(s, pid),
    acceptableOffers: s.offers.filter((o) => validate(s, pid, { type: 'acceptTrade', offerId: o.id }) === null).map((o) => o.id),
    mustDiscard: s.phase === 'discard' ? (s.pendingDiscards[pid] ?? 0) : 0,
  };
}
