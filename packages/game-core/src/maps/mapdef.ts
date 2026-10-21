import type { Resource, TileKind } from '../types';

/**
 * A map is plain data. Tile order defines tile ids; vertex and edge ids are
 * derived from it deterministically (see topology.ts).
 */
export interface MapDef {
  id: string;
  /** axial hex coordinates (pointy-top) */
  tiles: { q: number; r: number }[];
  /** how many tiles of each kind (sums to tiles.length) */
  terrains: Record<TileKind, number>;
  /** number tokens, one per non-desert tile */
  numbers: number[];
  /** coastal sides that carry a harbor; side i lies between corners i and i+1 */
  harborSlots: { tile: number; side: number }[];
  /** harbor types, shuffled onto the slots at game start (one per slot) */
  harborPool: (Resource | 'any')[];
}
