import type { DevCardKind, GameMode, Hand, PieceKind } from './types';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

export const BASE_COSTS: Record<PieceKind, Hand> = {
  road: { lumber: 1, brick: 1, wool: 0, grain: 0, ore: 0 },
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 0 },
  city: { lumber: 0, brick: 0, wool: 0, grain: 2, ore: 3 },
};
export const DEV_CARD_COST: Hand = { lumber: 0, brick: 0, wool: 1, grain: 1, ore: 1 };

export const PIECE_LIMITS: Record<PieceKind, number> = { road: 15, settlement: 5, city: 4 };

export const DEV_DECK_COMPOSITION: Record<DevCardKind, number> = {
  knight: 14,
  victoryPoint: 5,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
};
export const DEV_DECK_SIZE = 25;

export const MODES: Record<GameMode, { vpToWin: number }> = {
  standard: { vpToWin: 10 },
  short: { vpToWin: 7 },
};

/** Per-resource bank stock at the start of a game. */
export function bankStockFor(mode: GameMode, playerCount: number): number {
  if (mode === 'standard') return playerCount >= 5 ? 24 : 19;
  return playerCount >= 5 ? 19 : 14;
}

/** A player holding more than this many cards discards half when a 7 is rolled. */
export const DEFAULT_DISCARD_LIMIT = 7;
/** No bank ratio goes below this, whatever ports and roles say. */
export const MIN_BANK_RATIO = 2;
export const BASE_BANK_RATIO = 4;
export const GENERIC_PORT_RATIO = 3;
export const SPECIFIC_PORT_RATIO = 2;

export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

/** Free roads granted by the road building card. */
export const MAX_ROADS_PER_CARD = 2;
