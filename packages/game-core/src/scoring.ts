import { LARGEST_ARMY_MIN, LONGEST_ROAD_MIN } from './constants';
import { topologyOf } from './maps/topology';
import type { Ctx } from './state';
import type { GameState } from './types';

type RoadBoard = Pick<GameState, 'map' | 'roads' | 'buildings'>;

/** Longest continuous road of a player; an opponent's building cuts the path. */
export function longestRoadFor(s: RoadBoard, pid: string): number {
  const topo = topologyOf(s.map);
  const byVertex = new Map<number, number[]>();
  let count = 0;
  for (const [eid, owner] of Object.entries(s.roads)) {
    if (owner !== pid) continue;
    count++;
    const e = topo.edges[Number(eid)];
    for (const v of [e.a, e.b]) {
      const list = byVertex.get(v);
      if (list) list.push(e.id);
      else byVertex.set(v, [e.id]);
    }
  }
  if (count === 0) return 0;
  const blocked = (v: number) => {
    const b = s.buildings[v];
    return !!b && b.owner !== pid;
  };
  const used = new Set<number>();
  let best = 0;
  const dfs = (v: number, len: number) => {
    if (len > best) best = len;
    if (len > 0 && blocked(v)) return;
    for (const eid of byVertex.get(v) ?? []) {
      if (used.has(eid)) continue;
      used.add(eid);
      const e = topo.edges[eid];
      dfs(e.a === v ? e.b : e.a, len + 1);
      used.delete(eid);
    }
  };
  // a path's ends are vertices touched by one road or branching points; starting everywhere is simplest and correct
  for (const v of byVertex.keys()) {
    dfs(v, 0);
    if (best === count) break;
  }
  return best;
}

/** Points everyone can see: buildings and awards (no hidden cards). */
export function publicPoints(s: Pick<GameState, 'buildings' | 'longestRoad' | 'largestArmy'>, pid: string): number {
  let vp = 0;
  for (const b of Object.values(s.buildings)) if (b.owner === pid) vp += b.kind === 'city' ? 2 : 1;
  if (s.longestRoad.holder === pid) vp += 2;
  if (s.largestArmy.holder === pid) vp += 2;
  return vp;
}

export function hiddenPoints(s: Pick<GameState, 'players'>, pid: string): number {
  const p = s.players.find((x) => x.id === pid);
  return p ? p.devCards.filter((c) => c.kind === 'victoryPoint').length : 0;
}

/** Public points plus the player's own victory point cards. */
export function totalPoints(s: Pick<GameState, 'players' | 'buildings' | 'longestRoad' | 'largestArmy'>, pid: string): number {
  return publicPoints(s, pid) + hiddenPoints(s, pid);
}

/** Recomputes who holds the longest road (ties keep the holder; no holder on an unresolved tie). */
export function updateLongestRoad(ctx: Ctx) {
  const { s } = ctx;
  const lens: Record<string, number> = {};
  for (const p of s.players) lens[p.id] = longestRoadFor(s, p.id);
  const max = Math.max(...Object.values(lens));
  let holder = s.longestRoad.holder;
  if (max < LONGEST_ROAD_MIN) {
    holder = null;
  } else if (!(holder && lens[holder] === max)) {
    const top = s.players.filter((p) => lens[p.id] === max);
    holder = top.length === 1 ? top[0].id : null;
  }
  const length = max >= LONGEST_ROAD_MIN ? max : 0;
  if (holder !== s.longestRoad.holder || length !== s.longestRoad.length) {
    s.longestRoad = { holder, length };
    ctx.events.push({ type: 'longestRoadChanged', holder, length });
  }
}

/** The largest army changes hands only when someone plays strictly more knights than the holder. */
export function updateLargestArmy(ctx: Ctx) {
  const { s } = ctx;
  let { holder, size } = s.largestArmy;
  for (const p of s.players) {
    if (p.knightsPlayed >= LARGEST_ARMY_MIN && p.knightsPlayed > size) {
      holder = p.id;
      size = p.knightsPlayed;
    }
  }
  if (holder !== s.largestArmy.holder || size !== s.largestArmy.size) {
    s.largestArmy = { holder, size };
    ctx.events.push({ type: 'largestArmyChanged', holder, size });
  }
}

/** Only the player whose turn it is can win, counting their hidden cards. */
export function checkWin(ctx: Ctx) {
  const { s } = ctx;
  if (s.phase === 'finished' || s.phase === 'setup') return;
  const pts = totalPoints(s, s.current);
  if (pts >= s.vpToWin) {
    s.phase = 'finished';
    s.winner = s.current;
    // drop any interrupted step (robber, free roads, open offers): the game is over
    s.returnPhase = null;
    s.stealFrom = [];
    s.roadBuildingLeft = 0;
    s.pendingDiscards = {};
    s.offers = [];
    ctx.events.push({ type: 'gameWon', player: s.current, points: pts });
  }
}

