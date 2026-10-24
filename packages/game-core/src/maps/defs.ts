import type { GameMode } from '../types';
import type { MapDef } from './mapdef';

/** Tiles of a hex board given the width of each row (rows centered, top to bottom). */
function rows(widths: number[]): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  const r0 = -Math.floor(widths.length / 2);
  widths.forEach((w, i) => {
    const r = r0 + i;
    const q0 = Math.ceil(-(w - 1 + r) / 2);
    for (let k = 0; k < w; k++) out.push({ q: q0 + k, r });
  });
  return out;
}

const specific = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const;

/** Classic 19-tile board, 2-4 players. */
export const CLASSIC_19: MapDef = {
  id: 'classic19',
  tiles: rows([3, 4, 5, 4, 3]),
  terrains: { lumber: 4, wool: 4, grain: 4, brick: 3, ore: 3, desert: 1 },
  numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  harborSlots: [{ tile: 0, side: 3 }, { tile: 1, side: 4 }, { tile: 2, side: 5 }, { tile: 11, side: 5 }, { tile: 15, side: 0 }, { tile: 18, side: 1 }, { tile: 16, side: 1 }, { tile: 12, side: 2 }, { tile: 7, side: 3 }],
  harborPool: [...specific, 'any', 'any', 'any', 'any'],
};

/** Large 30-tile board in the layout of the classic 5-6 player expansion, for 5 players. */
export const LARGE_30: MapDef = {
  id: 'large30',
  tiles: rows([3, 4, 5, 6, 5, 4, 3]),
  terrains: { lumber: 6, wool: 6, grain: 6, brick: 5, ore: 5, desert: 2 },
  numbers: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
  harborSlots: [{ tile: 0, side: 3 }, { tile: 1, side: 4 }, { tile: 2, side: 5 }, { tile: 11, side: 5 }, { tile: 17, side: 0 }, { tile: 26, side: 0 }, { tile: 29, side: 1 }, { tile: 27, side: 1 }, { tile: 23, side: 2 }, { tile: 12, side: 2 }, { tile: 7, side: 3 }],
  harborPool: [...specific, 'any', 'any', 'any', 'any', 'any', 'any'],
};

/** Short-game board: 14 tiles in a diamond. */
export const SHORT_14: MapDef = {
  id: 'short14',
  tiles: rows([2, 3, 4, 3, 2]),
  terrains: { lumber: 3, wool: 3, grain: 3, brick: 2, ore: 2, desert: 1 },
  numbers: [2, 3, 4, 4, 5, 5, 6, 8, 9, 9, 10, 10, 11],
  harborSlots: [{ tile: 0, side: 3 }, { tile: 1, side: 4 }, { tile: 4, side: 0 }, { tile: 11, side: 0 }, { tile: 13, side: 1 }, { tile: 12, side: 3 }, { tile: 5, side: 3 }],
  harborPool: [...specific, 'any', 'any'],
};

export const MAPS: Record<string, MapDef> = {
  [CLASSIC_19.id]: CLASSIC_19,
  [LARGE_30.id]: LARGE_30,
  [SHORT_14.id]: SHORT_14,
};

/** Which map a game uses. A 14-tile board is too tight for 5 players, so short games with 5 use the classic board. */
export function mapFor(mode: GameMode, playerCount: number): MapDef {
  if (mode === 'standard' || mode === 'custom') return playerCount >= 5 ? LARGE_30 : CLASSIC_19;
  return playerCount >= 5 ? CLASSIC_19 : SHORT_14;
}
