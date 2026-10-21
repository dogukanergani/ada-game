import type { MapDef } from './mapdef';

const SQRT3 = Math.sqrt(3);

export interface TopoTile {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  /** 6 vertex ids, clockwise from the upper-right corner; side i joins corners i and i+1 */
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
  tiles: number[];
}
export interface Topology {
  tiles: TopoTile[];
  vertices: TopoVertex[];
  edges: TopoEdge[];
  /** edges with exactly one adjacent tile, in perimeter order */
  coastEdges: number[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  edgeIndex: Map<string, number>;
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

function build(map: MapDef): Topology {
  const vKey = new Map<string, number>();
  const edgeIndex = new Map<string, number>();
  const vertices: TopoVertex[] = [];
  const edges: TopoEdge[] = [];
  const tiles: TopoTile[] = [];

  map.tiles.forEach((h, id) => {
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
      const k = edgeKey(a, b);
      const existing = edgeIndex.get(k);
      if (existing !== undefined) {
        edges[existing].tiles.push(id);
        continue;
      }
      const eid = edges.length;
      edgeIndex.set(k, eid);
      edges.push({ id: eid, a, b, x: (vertices[a].x + vertices[b].x) / 2, y: (vertices[a].y + vertices[b].y) / 2, tiles: [id] });
      vertices[a].neighbors.push(b);
      vertices[b].neighbors.push(a);
      vertices[a].edges.push(eid);
      vertices[b].edges.push(eid);
    }
    tiles.push({ id, q: h.q, r: h.r, x: cx, y: cy, corners, neighbors: [] });
  });

  for (const e of edges) {
    if (e.tiles.length === 2) {
      tiles[e.tiles[0]].neighbors.push(e.tiles[1]);
      tiles[e.tiles[1]].neighbors.push(e.tiles[0]);
    }
  }

  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  return {
    tiles,
    vertices,
    edges,
    coastEdges: perimeter(edges, vertices),
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
    edgeIndex,
  };
}

/** Coast edges ordered by walking the outer boundary; any coast edges not on that loop follow. */
function perimeter(edges: TopoEdge[], vertices: TopoVertex[]): number[] {
  const left = new Set(edges.filter((e) => e.tiles.length === 1).map((e) => e.id));
  const out: number[] = [];
  while (left.size) {
    let cur = Math.min(...left);
    let v = edges[cur].b;
    while (left.has(cur)) {
      left.delete(cur);
      out.push(cur);
      const next = vertices[v].edges.find((e) => e !== cur && left.has(e));
      if (next === undefined) break;
      v = edges[next].a === v ? edges[next].b : edges[next].a;
      cur = next;
    }
  }
  return out;
}

const byIdentity = new WeakMap<MapDef, Topology>();
const byId = new Map<string, { tiles: MapDef['tiles']; topo: Topology }>();

const sameTiles = (a: MapDef['tiles'], b: MapDef['tiles']) => a.length === b.length && a.every((t, i) => t.q === b[i].q && t.r === b[i].r);

/**
 * Derived geometry for a map; cached and deterministic. States are cloned on
 * every action, so the cache is keyed by map id and verified against the tiles.
 */
export function topologyOf(map: MapDef): Topology {
  const hit = byIdentity.get(map);
  if (hit) return hit;
  const known = byId.get(map.id);
  let topo: Topology;
  if (known && sameTiles(known.tiles, map.tiles)) topo = known.topo;
  else {
    topo = build(map);
    byId.set(map.id, { tiles: map.tiles.map((t) => ({ q: t.q, r: t.r })), topo });
  }
  byIdentity.set(map, topo);
  return topo;
}

export function edgeBetween(topo: Topology, a: number, b: number): number | undefined {
  return topo.edgeIndex.get(edgeKey(a, b));
}

/** Edge id of a map-data harbor slot (tile + side), or undefined if the slot is not on the coast. */
export function harborSlotEdge(topo: Topology, slot: { tile: number; side: number }): number | undefined {
  const t = topo.tiles[slot.tile];
  if (!t || !Number.isInteger(slot.side) || slot.side < 0 || slot.side > 5) return undefined;
  const e = edgeBetween(topo, t.corners[slot.side], t.corners[(slot.side + 1) % 6]);
  return e !== undefined && topo.edges[e].tiles.length === 1 ? e : undefined;
}

/** Problems with a map definition, as keys; empty when the map is usable. */
export function validateMap(map: MapDef): string[] {
  const problems: string[] = [];
  const total = Object.values(map.terrains).reduce((s, n) => s + n, 0);
  if (total !== map.tiles.length) problems.push('terrainCountMismatch');
  if (map.numbers.length !== map.tiles.length - map.terrains.desert) problems.push('numberCountMismatch');
  if (map.numbers.some((n) => !Number.isInteger(n) || n < 2 || n > 12 || n === 7)) problems.push('badNumber');
  if (map.terrains.desert < 1) problems.push('noDesert');
  if (new Set(map.tiles.map((t) => `${t.q},${t.r}`)).size !== map.tiles.length) problems.push('duplicateTile');
  const topo = topologyOf(map);
  const slotEdges = map.harborSlots.map((s) => harborSlotEdge(topo, s));
  if (slotEdges.some((e) => e === undefined)) problems.push('harborNotOnCoast');
  if (new Set(slotEdges).size !== slotEdges.length) problems.push('duplicateHarbor');
  if (map.harborPool.length !== map.harborSlots.length) problems.push('harborCountMismatch');
  return problems;
}
