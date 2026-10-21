import type { Resource } from '@ada/game-core';

/**
 * Small pictures for the five resources, drawn in a 24x24 box. The same paths
 * make the terrain patterns of the board, the harbors and the hand, so a
 * resource looks the same everywhere.
 */
export const GLYPH_PATHS: Record<Resource, string> = {
  // pine tree
  lumber: 'M12 2 L19 12 H15.5 L20.5 20 H3.5 L8.5 12 H5 Z M11 20 H13 V23 H11 Z',
  // bricks
  brick: 'M2 5 H22 V9 H2 Z M2 10 H11 V14 H2 Z M12 10 H22 V14 H12 Z M2 15 H8 V19 H2 Z M9 15 H17 V19 H9 Z M18 15 H22 V19 H18 Z',
  // sheep: a cloud of wool and a head
  wool: 'M7 9 a4 4 0 0 1 7 -2 a4 4 0 0 1 6 3 a4 4 0 0 1 -1 7 H8 a4 4 0 0 1 -1 -8 Z M19 12 a2.6 2.6 0 1 1 3 3 Z M8 17 H10 V21 H8 Z M15 17 H17 V21 H15 Z',
  // wheat ear
  grain: 'M11.3 6 H12.7 V23 H11.3 Z M12 1 c2 2 2 4 0 6 c-2 -2 -2 -4 0 -6 Z M12 8 c3 -1 5 0 6 2 c-3 1 -5 0 -6 -2 Z M12 8 c-3 -1 -5 0 -6 2 c3 1 5 0 6 -2 Z M12 13 c3 -1 5 0 6 2 c-3 1 -5 0 -6 -2 Z M12 13 c-3 -1 -5 0 -6 2 c3 1 5 0 6 -2 Z',
  // mountains
  ore: 'M1 21 L9 6 L13.5 14 L16.5 9.5 L23 21 Z',
};

export const DESERT_GLYPH = 'M3 19 q4 -8 9 -3 q4 4 9 -4 V21 H3 Z M17 4 a3 3 0 1 1 0 6 a3 3 0 0 1 0 -6 Z';

export const HOUSE_PATH = 'M -0.5 0.45 L -0.5 -0.1 L 0 -0.55 L 0.5 -0.1 L 0.5 0.45 Z';
export const CITY_PATH = 'M -0.75 0.45 V -0.1 H -0.2 V -0.5 L 0.15 -0.8 L 0.5 -0.5 V -0.1 H 0.75 V 0.45 Z';
