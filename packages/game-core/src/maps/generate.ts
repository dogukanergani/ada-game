import type { Harbor, Rng, Tile, TileKind } from '../types';
import type { MapDef } from './mapdef';
import { harborSlotEdge, topologyOf } from './topology';

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const hot = (t: Tile) => t.number === 6 || t.number === 8;

function hasAdjacentHot(map: MapDef, tiles: Tile[]): boolean {
  const topo = topologyOf(map);
  return tiles.some((t, i) => hot(t) && topo.tiles[i].neighbors.some((n) => hot(tiles[n])));
}

/** Random terrain and number placement; 6 and 8 are never adjacent. The robber starts on the first desert. */
export function generateTiles(map: MapDef, rng: Rng): { tiles: Tile[]; robber: number } {
  const kinds: TileKind[] = [];
  for (const [kind, n] of Object.entries(map.terrains) as [TileKind, number][]) {
    for (let i = 0; i < n; i++) kinds.push(kind);
  }
  let tiles: Tile[] = [];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const shuffled = shuffle(kinds, rng);
    const nums = shuffle(map.numbers, rng);
    let ni = 0;
    tiles = shuffled.map((kind) => ({ kind, number: kind === 'desert' ? null : nums[ni++] }));
    if (!hasAdjacentHot(map, tiles)) {
      return { tiles, robber: tiles.findIndex((t) => t.kind === 'desert') };
    }
  }
  throw new Error(`map ${map.id}: could not place numbers without adjacent 6/8`);
}

export function generateHarbors(map: MapDef, rng: Rng): Harbor[] {
  const topo = topologyOf(map);
  const types = shuffle(map.harborPool, rng);
  return map.harborSlots.map((slot, i) => ({ edge: harborSlotEdge(topo, slot)!, type: types[i] }));
}
