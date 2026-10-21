import { topologyOf, type Harbor, type MapDef, type Topology } from '@ada/game-core';

export interface HarborSpot {
  edge: number;
  type: Harbor['type'];
  /** the badge centre, out at sea */
  x: number;
  y: number;
  /** the two planks run from these shore points to the badge */
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface BoardGeometry {
  topo: Topology;
  harbors: HarborSpot[];
  /** everything that must be visible: land, harbors and a margin of sea */
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

/** How far out to sea a harbor badge sits, in tile radii. */
const HARBOR_REACH = 0.72;
const BADGE_RADIUS = 0.42;
const SEA_MARGIN = 0.55;

/** All geometry of a map, from its data alone: nothing depends on a particular layout. */
export function boardGeometry(map: MapDef, harbors: Harbor[]): BoardGeometry {
  const topo = topologyOf(map);
  const spots: HarborSpot[] = harbors.map((h) => {
    const e = topo.edges[h.edge];
    const tile = topo.tiles[e.tiles[0]];
    const dx = e.x - tile.x;
    const dy = e.y - tile.y;
    const len = Math.hypot(dx, dy) || 1;
    const a = topo.vertices[e.a];
    const b = topo.vertices[e.b];
    return {
      edge: h.edge,
      type: h.type,
      x: e.x + (dx / len) * HARBOR_REACH,
      y: e.y + (dy / len) * HARBOR_REACH,
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
    };
  });
  const xs = [...topo.vertices.map((v) => v.x), ...spots.flatMap((s) => [s.x - BADGE_RADIUS, s.x + BADGE_RADIUS])];
  const ys = [...topo.vertices.map((v) => v.y), ...spots.flatMap((s) => [s.y - BADGE_RADIUS, s.y + BADGE_RADIUS])];
  return {
    topo,
    harbors: spots,
    box: {
      minX: Math.min(...xs) - SEA_MARGIN,
      maxX: Math.max(...xs) + SEA_MARGIN,
      minY: Math.min(...ys) - SEA_MARGIN,
      maxY: Math.max(...ys) + SEA_MARGIN,
    },
  };
}

export const tilePoints = (topo: Topology, tile: number): string => topo.tiles[tile].corners.map((v) => `${topo.vertices[v].x},${topo.vertices[v].y}`).join(' ');

export interface Candidate {
  id: number;
  x: number;
  y: number;
}

/** The candidate nearest to (x, y) within `maxDist`, or null. */
export function nearest(candidates: Candidate[], x: number, y: number, maxDist: number): Candidate | null {
  let best: Candidate | null = null;
  let bestD = maxDist;
  for (const c of candidates) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** Dots under a number token: 6 minus the distance of the number from 7. */
export const probabilityDots = (n: number): number => 6 - Math.abs(7 - n);

/** A camera over the board: where the view is centred and how many pixels one tile radius takes. */
export interface Camera {
  cx: number;
  cy: number;
  scale: number;
}

/** Fits the board into the view; `topInset` px at the top are kept free (for the small dice tray that rests in the corner). */
export function fitCamera(box: BoardGeometry['box'], width: number, height: number, topInset = 0): Camera {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const scale = Math.min(width / w, Math.max(1, height - topInset) / h);
  // the middle of the board goes to the middle of the free part, which lies topInset / 2 px below the middle of the view
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2 - topInset / 2 / scale, scale };
}

export const viewBoxOf = (cam: Camera, width: number, height: number) =>
  `${cam.cx - width / 2 / cam.scale} ${cam.cy - height / 2 / cam.scale} ${width / cam.scale} ${height / cam.scale}`;

export const toUnits = (cam: Camera, width: number, height: number, px: number, py: number) => ({
  x: cam.cx + (px - width / 2) / cam.scale,
  y: cam.cy + (py - height / 2) / cam.scale,
});
