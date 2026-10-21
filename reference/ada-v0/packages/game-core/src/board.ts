import type { Rng, Tile, TileKind } from './types';

/**
 * Board geometry. Pointy-top hexes in axial coordinates, radius 2 (19 tiles).
 * Vertices (settlement spots) and edges (road spots) are derived once at load
 * and get stable integer ids, so server and client always agree on them.
 */

const SQRT3 = Math.sqrt(3);
const RADIUS = 2;

export interface TopoTile {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  /** 6 vertex ids, clockwise from the upper-right corner */
  corners: number[];
  neighbors: number[];
}
export interface TopoVertex {
  id: number;
  x: number;
  y: number;
  tiles: number[];
  neighbors: number[];
  edges: number[];
}
export interface TopoEdge {
  id: number;
  a: number;
  b: number;
  x: number;
  y: number;
}
export interface Topology {
  tiles: TopoTile[];
  vertices: TopoVertex[];
  edges: TopoEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function build(): Topology {
  const hexes: { q: number; r: number }[] = [];
  for (let r = -RADIUS; r <= RADIUS; r++) {
    for (let q = -RADIUS; q <= RADIUS; q++) {
      if (Math.abs(-q - r) <= RADIUS) hexes.push({ q, r });
    }
  }

  const vKey = new Map<string, number>();
  const eKey = new Map<string, number>();
  const vertices: TopoVertex[] = [];
  const edges: TopoEdge[] = [];
  const tiles: TopoTile[] = [];

  hexes.forEach((h, id) => {
    const cx = SQRT3 * (h.q + h.r / 2);
    const cy = 1.5 * h.r;
    const corners: number[] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 30);
      const x = cx + Math.cos(ang);
      const y = cy + Math.sin(ang);
      const key = `${Math.round(x * 100)}_${Math.round(y * 100)}`;
      let vid = vKey.get(key);
      if (vid === undefined) {
        vid = vertices.length;
        vKey.set(key, vid);
        vertices.push({ id: vid, x, y, tiles: [], neighbors: [], edges: [] });
      }
      corners.push(vid);
      if (!vertices[vid].tiles.includes(id)) vertices[vid].tiles.push(id);
    }
    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (eKey.has(k)) continue;
      const eid = edges.length;
      eKey.set(k, eid);
      edges.push({
        id: eid,
        a,
        b,
        x: (vertices[a].x + vertices[b].x) / 2,
        y: (vertices[a].y + vertices[b].y) / 2,
      });
      vertices[a].neighbors.push(b);
      vertices[b].neighbors.push(a);
      vertices[a].edges.push(eid);
      vertices[b].edges.push(eid);
    }
    tiles.push({ id, q: h.q, r: h.r, x: cx, y: cy, corners, neighbors: [] });
  });

  for (const t of tiles) {
    for (const u of tiles) {
      if (t.id >= u.id) continue;
      const shared = t.corners.filter((c) => u.corners.includes(c)).length;
      if (shared >= 2) {
        t.neighbors.push(u.id);
        u.neighbors.push(t.id);
      }
    }
  }

  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  return {
    tiles,
    vertices,
    edges,
    bounds: {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    },
  };
}

export const TOPOLOGY: Topology = build();

const KINDS: TileKind[] = [
  ...Array<TileKind>(4).fill('lumber'),
  ...Array<TileKind>(4).fill('wool'),
  ...Array<TileKind>(4).fill('grain'),
  ...Array<TileKind>(3).fill('brick'),
  ...Array<TileKind>(3).fill('ore'),
  'desert',
];
const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hasAdjacentHotNumbers(tiles: Tile[]): boolean {
  const hot = (t: Tile) => t.number === 6 || t.number === 8;
  return tiles.some((t) => hot(t) && TOPOLOGY.tiles[t.id].neighbors.some((n) => hot(tiles[n])));
}

/** Random board; 6 and 8 are never placed next to each other. */
export function generateTiles(rng: Rng): Tile[] {
  let tiles: Tile[] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    const kinds = shuffle(KINDS, rng);
    const nums = shuffle(NUMBERS, rng);
    let ni = 0;
    tiles = TOPOLOGY.tiles.map((t, i) => ({
      id: t.id,
      q: t.q,
      r: t.r,
      kind: kinds[i],
      number: kinds[i] === 'desert' ? null : nums[ni++],
    }));
    if (!hasAdjacentHotNumbers(tiles)) break;
  }
  return tiles;
}
