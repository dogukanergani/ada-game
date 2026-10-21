import { RESOURCES, type Resource, type TileKind } from '@ada/game-core';

export const TILE_COLOR: Record<TileKind, string> = {
  lumber: '#2e6b45',
  brick: '#b4572f',
  wool: '#8fb45a',
  grain: '#d8b342',
  ore: '#77808c',
  desert: '#c9b88a',
};

export const RES_ORDER: readonly Resource[] = RESOURCES;
