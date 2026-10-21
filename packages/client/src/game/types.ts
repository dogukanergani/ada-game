/** One place the client takes game-core names from, so screens do not each import the whole core. */
export { RESOURCES, ROLES, canAfford } from '@ada/game-core';
export type { Action, GameView, Hand, LegalMoves, Phase, PieceKind, Resource } from '@ada/game-core';
import type { GameView } from '@ada/game-core';
export type PlayerViewLike = GameView['players'][number];
