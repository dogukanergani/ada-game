import type { DevCardKind, GameMode, Hand, PieceKind, Resource, RoleId, TradeOffer } from './types';

/**
 * The core never produces text. It returns events (what happened) and errors
 * (why a move was refused) as `{type, ...values}`; the client turns them into
 * Turkish/English sentences.
 */
export type GameEvent =
  | { type: 'gameStarted'; mode: GameMode; mapId: string; order: string[] }
  | { type: 'settlementBuilt'; player: string; vertex: number; setup: boolean }
  | { type: 'roadBuilt'; player: string; edge: number; free: boolean }
  | { type: 'cityBuilt'; player: string; vertex: number }
  | { type: 'setupResources'; player: string; gains: Hand }
  /**
   * `hitTiles`: tiles whose number came up, that the robber is not on and that have a building, i.e. where production came from.
   * `robbedTile`: the tile whose number came up but the robber sits on (null if none). Both are public board facts and say nothing hidden.
   */
  | { type: 'diceRolled'; player: string; dice: [number, number]; total: number; hitTiles: number[]; robbedTile: number | null }
  | { type: 'produced'; player: string; gains: Hand }
  | { type: 'productionBlocked'; resource: Resource; reason: 'multiple' | 'short' }
  | { type: 'roleBonus'; player: string; role: RoleId; gains: Hand }
  | { type: 'discardRequired'; players: Record<string, number> }
  | { type: 'discarded'; player: string; count: number }
  | { type: 'robberMoved'; player: string; tile: number }
  | { type: 'stolen'; thief: string; victim: string; resource: Resource | null }
  | { type: 'bankTraded'; player: string; give: Resource; get: Resource; ratio: number }
  | { type: 'tradeOffered'; offer: TradeOffer }
  | { type: 'tradeAccepted'; offerId: number; from: string; to: string; give: Hand; want: Hand }
  | { type: 'tradeCancelled'; offerId: number }
  | { type: 'devCardBought'; player: string; kind: DevCardKind | null }
  | { type: 'devCardPlayed'; player: string; kind: DevCardKind }
  | { type: 'yearOfPlentyTaken'; player: string; gains: Hand }
  | { type: 'monopolyCollected'; player: string; resource: Resource; count: number }
  | { type: 'roadBuildingEnded'; player: string; unused: number }
  | { type: 'longestRoadChanged'; holder: string | null; length: number }
  | { type: 'largestArmyChanged'; holder: string | null; size: number }
  | { type: 'captured'; player: string; from: string; kind: PieceKind; id: number }
  | { type: 'turnEnded'; player: string }
  | { type: 'turnStarted'; player: string; turn: number }
  | { type: 'gameWon'; player: string; points: number };

/** Every error type the core can return, as data: clients check their translations against this list. */
/** Every event type the core can emit, as data. The type check below fails to compile if this list and the `GameEvent` union drift apart. */
export const GAME_EVENT_TYPES = [
  'gameStarted',
  'settlementBuilt',
  'roadBuilt',
  'cityBuilt',
  'setupResources',
  'diceRolled',
  'produced',
  'productionBlocked',
  'roleBonus',
  'discardRequired',
  'discarded',
  'robberMoved',
  'stolen',
  'bankTraded',
  'tradeOffered',
  'tradeAccepted',
  'tradeCancelled',
  'devCardBought',
  'devCardPlayed',
  'yearOfPlentyTaken',
  'monopolyCollected',
  'roadBuildingEnded',
  'longestRoadChanged',
  'largestArmyChanged',
  'captured',
  'turnEnded',
  'turnStarted',
  'gameWon',
] as const satisfies readonly GameEvent['type'][];
type MissingEventTypes = Exclude<GameEvent['type'], (typeof GAME_EVENT_TYPES)[number]>;
export const eventTypesAreComplete: [MissingEventTypes] extends [never] ? true : never = true;

export const GAME_ERROR_TYPES = [
  'gameOver',
  'notInGame',
  'invalidAction',
  'notYourTurn',
  'wrongPhase',
  'invalidTarget',
  'occupied',
  'distanceRule',
  'notConnected',
  'pieceLimit',
  'cannotAfford',
  'bankLacks',
  'invalidHand',
  'invalidTrade',
  'noSuchOffer',
  'ownOffer',
  'noDevCard',
  'deckEmpty',
  'devCardNotPlayable',
  'unknownRoleAction',
  'roleActionRefused',
  'invalidSetup',
] as const;
export type GameErrorType = (typeof GAME_ERROR_TYPES)[number];

export interface GameError {
  type: GameErrorType;
  [detail: string]: unknown;
}

export const err = (type: GameErrorType, detail: Record<string, unknown> = {}): GameError => ({ ...detail, type });
