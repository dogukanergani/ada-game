import type { GameError, GameEvent } from './events';
import type { GameState, Hand, Resource } from './types';

export type Action =
  | { type: 'placeSettlement'; vertex: number }
  | { type: 'placeRoad'; edge: number }
  | { type: 'upgradeCity'; vertex: number }
  | { type: 'roll' }
  | { type: 'discard'; resources: Partial<Hand> }
  | { type: 'moveRobber'; tile: number }
  | { type: 'steal'; victim: string }
  | { type: 'bankTrade'; give: Resource; get: Resource }
  | { type: 'offerTrade'; give: Partial<Hand>; want: Partial<Hand> }
  | { type: 'acceptTrade'; offerId: number }
  | { type: 'cancelTrade'; offerId: number }
  | { type: 'buyDevCard' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty'; a: Resource; b: Resource }
  | { type: 'playMonopoly'; resource: Resource }
  | { type: 'endTurn' }
  /** An action defined by the acting player's role; the core only routes it. */
  | { type: 'roleAction'; name: string; params?: Record<string, unknown> };

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: GameError };
