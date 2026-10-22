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
  /** a road or an edge is a line, not a point: a tap is measured to the line, not to its middle */
  segment?: { x1: number; y1: number; x2: number; y2: number };
}

/** Distance from (x, y) to the segment (x1, y1)-(x2, y2). */
export function distanceToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

const reachOf = (c: Candidate, x: number, y: number): number =>
  c.segment ? distanceToSegment(x, y, c.segment.x1, c.segment.y1, c.segment.x2, c.segment.y2) : Math.hypot(c.x - x, c.y - y);

/**
 * The candidate nearest to (x, y) within `maxDist`, or null. A point candidate is measured to its point, a line
 * (an edge) to the closest spot on it, so a tap near the end of a road picks that road and not a neighbour whose
 * middle happens to be closer. Equal distances (a tap on a corner) go to the one whose middle is nearer.
 */
export function nearest(candidates: Candidate[], x: number, y: number, maxDist: number): Candidate | null {
  let best: Candidate | null = null;
  let bestD = maxDist;
  let bestMid = Infinity;
  for (const c of candidates) {
    const d = reachOf(c, x, y);
    const mid = Math.hypot(c.x - x, c.y - y);
    if (d < bestD - 1e-9 || (d <= bestD + 1e-9 && mid < bestMid)) {
      best = c;
      bestD = Math.min(d, bestD);
      bestMid = mid;
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

/** The two ends of an edge, as a tap target. */
export function segmentOf(topo: Topology, edge: number): { x1: number; y1: number; x2: number; y2: number } {
  const e = topo.edges[edge];
  const a = topo.vertices[e.a];
  const b = topo.vertices[e.b];
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}
