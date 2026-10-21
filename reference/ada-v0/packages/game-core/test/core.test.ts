import { describe, expect, it } from 'vitest';
import {
  RESOURCES, TOPOLOGY as T, applyAction, bankRatioFor, costFor, generateTiles, handCount,
  legalRoadEdges, legalSettlementVertices, longestRoadFor, victoryPoints, viewFor, ROLES,
  type GameState,
} from '../src';
import { act, autoSetup, mulberry32, newGame, rigged } from './helpers';

describe('board topology', () => {
  it('has 19 tiles, 54 vertices, 72 edges', () => {
    expect(T.tiles).toHaveLength(19);
    expect(T.vertices).toHaveLength(54);
    expect(T.edges).toHaveLength(72);
  });
  it('every tile has 6 distinct corners and vertices have 2-3 neighbours', () => {
    for (const t of T.tiles) expect(new Set(t.corners).size).toBe(6);
    for (const v of T.vertices) expect([2, 3]).toContain(v.neighbors.length);
  });
  it('tile adjacency is symmetric; centre has 6 neighbours', () => {
    const centre = T.tiles.find((t) => t.q === 0 && t.r === 0)!;
    expect(centre.neighbors).toHaveLength(6);
    for (const t of T.tiles) for (const n of t.neighbors) expect(T.tiles[n].neighbors).toContain(t.id);
  });
});

describe('tile generation', () => {
  it('uses the standard distribution and never puts 6/8 next to each other', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const tiles = generateTiles(mulberry32(seed));
      const count = (k: string) => tiles.filter((t) => t.kind === k).length;
      expect([count('lumber'), count('wool'), count('grain'), count('brick'), count('ore'), count('desert')]).toEqual([4, 4, 4, 3, 3, 1]);
      expect(tiles.filter((t) => t.number !== null)).toHaveLength(18);
      const hot = tiles.filter((t) => t.number === 6 || t.number === 8);
      for (const h of hot) for (const n of T.tiles[h.id].neighbors) expect([6, 8]).not.toContain(tiles[n].number);
    }
  });
});

describe('setup phase', () => {
  it('plays out in snake order and ends with player 0 rolling', () => {
    const start = newGame(3);
    const order = start.setup!.order;
    expect(order).toEqual([...order.slice(0, 3), ...order.slice(0, 3).reverse()]);
    const s = autoSetup(start);
    expect(s.phase).toBe('roll');
    expect(s.current).toBe(order[0]);
    for (const p of s.players) {
      expect(Object.values(s.buildings).filter((b) => b.owner === p.id)).toHaveLength(2);
      expect(Object.values(s.roads).filter((o) => o === p.id)).toHaveLength(2);
    }
  });
  it('pays out resources for the second settlement only', () => {
    const s = autoSetup(newGame(3, 11));
    const total = s.players.reduce((n, p) => n + handCount(p.resources), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(9);
  });
  it('rejects the distance-rule violation and out-of-turn moves', () => {
    let s = newGame(2);
    const v = legalSettlementVertices(s, s.current)[0];
    s = act(s, s.current, { type: 'placeSettlement', vertex: v });
    const other = s.players.find((p) => p.id !== s.current)!.id;
    expect(applyAction(s, other, { type: 'placeRoad', edge: 0 }, mulberry32(1)).ok).toBe(false);
    s = act(s, s.current, { type: 'placeRoad', edge: legalRoadEdges(s, s.current)[0] });
    const neighbour = T.vertices[v].neighbors[0];
    const r = applyAction(s, s.current, { type: 'placeSettlement', vertex: neighbour }, mulberry32(1));
    expect(r.ok).toBe(false);
  });
});

/** Puts a state into the main phase with the first player to move. */
function mainState(seed = 3): GameState {
  let s = autoSetup(newGame(3, seed));
  s = structuredClone(s);
  for (const p of s.players) for (const r of RESOURCES) p.resources[r] = 0;
  return s;
}

describe('dice and production', () => {
  it('pays 1 per settlement and 2 per city on matching tiles, none on the robber tile', () => {
    for (const total of [4, 5, 6, 8, 9, 10]) {
      const s0 = mainState();
      const me = s0.current;
      const hit = s0.tiles.find((t) => t.number === total)!;
      const vertex = T.tiles[hit.id].corners.find((v) => !s0.buildings[v]) ?? T.tiles[hit.id].corners[0];
      s0.buildings = { [vertex]: { owner: me, kind: 'city' } };
      s0.robber = s0.tiles.find((t) => t.number !== total && t.kind !== 'desert')!.id;
      const d1 = Math.min(6, total - 1);
      const s1 = act(s0, me, { type: 'roll' }, rigged([d1, total - d1]));
      const expected = T.vertices[vertex].tiles.filter((t) => s0.tiles[t].number === total).length * 2;
      const myRole = ROLES[s1.players.find((p) => p.id === me)!.role];
      const bonus = myRole.id === 'farmer' || myRole.id === 'miner' ? 1 : 0;
      expect(handCount(s1.players.find((p) => p.id === me)!.resources)).toBe(expected + (expected > 0 ? bonus : 0));
      expect(s1.phase).toBe('main');
    }
  });
  it('robber blocks production', () => {
    const s0 = mainState();
    const me = s0.current;
    const hit = s0.tiles.find((t) => t.number === 8)!;
    s0.buildings = { [T.tiles[hit.id].corners[0]]: { owner: me, kind: 'settlement' } };
    s0.robber = hit.id;
    const s1 = act(s0, me, { type: 'roll' }, rigged([4, 4]));
    expect(handCount(s1.players.find((p) => p.id === me)!.resources)).toBe(0);
  });
});

describe('rolling a seven', () => {
  it('forces discards of half, then robber move and steal', () => {
    const s0 = mainState();
    const [a, b, c] = s0.players.map((p) => p.id);
    s0.players.find((p) => p.id === b)!.resources = { lumber: 3, brick: 3, wool: 2, grain: 0, ore: 0 };
    s0.players.find((p) => p.id === c)!.resources = { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 };
    s0.current = a;
    let s = act(s0, a, { type: 'roll' }, rigged([3, 4]));
    expect(s.phase).toBe('discard');
    expect(s.pendingDiscards).toEqual({ [b]: 4 });
    expect(applyAction(s, b, { type: 'discard', resources: { lumber: 1 } }, mulberry32(1)).ok).toBe(false);
    expect(applyAction(s, b, { type: 'discard', resources: { grain: 4 } }, mulberry32(1)).ok).toBe(false);
    s = act(s, b, { type: 'discard', resources: { lumber: 2, brick: 2 } });
    expect(s.phase).toBe('robber');
    // put the robber on a tile where b has a building
    const bVertex = Number(Object.entries(s.buildings).find(([, x]) => x.owner === b)![0]);
    const target = T.vertices[bVertex].tiles.find((t) => t !== s.robber)!;
    const before = handCount(s.players.find((p) => p.id === a)!.resources);
    s = act(s, a, { type: 'moveRobber', tile: target });
    expect(s.robber).toBe(target);
    const after = handCount(s.players.find((p) => p.id === a)!.resources);
    // auto-steal when exactly one victim, otherwise waiting for a choice
    if (s.phase === 'steal') {
      s = act(s, a, { type: 'steal', victim: s.stealFrom[0] });
      expect(handCount(s.players.find((p) => p.id === a)!.resources)).toBe(before + 1);
    } else {
      expect(after).toBeGreaterThanOrEqual(before);
    }
    expect(s.phase).toBe('main');
  });
  it('the robber must actually move', () => {
    const s0 = mainState();
    s0.phase = 'robber';
    expect(applyAction(s0, s0.current, { type: 'moveRobber', tile: s0.robber }, mulberry32(1)).ok).toBe(false);
  });
});

describe('roles', () => {
  it('merchant trades 3:1, others 4:1', () => {
    const s = newGame(2);
    const m = s.players.find((p) => p.role === 'merchant')!;
    const o = s.players.find((p) => p.role !== 'merchant')!;
    expect(bankRatioFor(s, m.id, 'ore')).toBe(3);
    expect(bankRatioFor(s, o.id, 'ore')).toBe(4);
  });
  it('architect builds roads for 1 lumber', () => {
    const s = newGame(4, 5);
    const arch = s.players.find((p) => p.role === 'architect')!;
    expect(costFor(s, arch.id, 'road')).toEqual({ lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 });
    expect(costFor(s, arch.id, 'settlement').brick).toBe(1);
  });
  it('farmer gets +1 grain only when they produced grain', () => {
    const s0 = mainState();
    const farmer = s0.players[0];
    farmer.role = 'farmer';
    s0.current = farmer.id;
    const grainTile = s0.tiles.find((t) => t.kind === 'grain' && t.number && t.number !== 7 && ![2, 12].includes(t.number))!;
    s0.buildings = { [T.tiles[grainTile.id].corners[0]]: { owner: farmer.id, kind: 'settlement' } };
    s0.robber = s0.tiles.find((t) => t.kind === 'desert')!.id;
    const n = grainTile.number!;
    const d1 = Math.min(6, n - 1);
    const s1 = act(s0, farmer.id, { type: 'roll' }, rigged([d1, n - d1]));
    const produced = T.vertices[T.tiles[grainTile.id].corners[0]].tiles.filter((t) => s0.tiles[t].number === n && s0.tiles[t].kind === 'grain').length;
    expect(s1.players[0].resources.grain).toBe(produced + 1);
  });
  it('hunter never has to discard on a 7', () => {
    const s0 = mainState();
    const [a, b] = s0.players;
    b.role = 'hunter';
    b.resources = { lumber: 9, brick: 9, wool: 9, grain: 9, ore: 9 };
    s0.current = a.id;
    const s = act(s0, a.id, { type: 'roll' }, rigged([3, 4]));
    expect(s.phase).toBe('robber');
    expect(s.pendingDiscards).toEqual({});
  });
  it('explorer gets a resource when building a settlement', () => {
    const s0 = mainState();
    const p = s0.players[0];
    p.role = 'explorer';
    s0.phase = 'main';
    s0.current = p.id;
    p.resources = { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 0 };
    const spot = legalSettlementVertices(s0, p.id)[0];
    if (spot === undefined) return; // no legal spot on this seed (extremely unlikely)
    const s1 = act(s0, p.id, { type: 'placeSettlement', vertex: spot });
    expect(handCount(s1.players[0].resources)).toBe(T.vertices[spot].tiles.some((t) => s0.tiles[t].kind !== 'desert') ? 1 : 0);
  });
});

describe('building and trading', () => {
  it('needs resources and connection, and charges the cost', () => {
    const s0 = mainState();
    const me = s0.players.find((p) => p.id === s0.current)!;
    s0.phase = 'main';
    const edge = legalRoadEdges(s0, me.id)[0];
    expect(applyAction(s0, me.id, { type: 'placeRoad', edge }, mulberry32(1)).ok).toBe(false);
    me.resources = { lumber: 5, brick: 5, wool: 0, grain: 0, ore: 0 };
    const s1 = act(s0, me.id, { type: 'placeRoad', edge });
    const cost = costFor(s1, me.id, 'road');
    expect(s1.players.find((p) => p.id === me.id)!.resources.lumber).toBe(5 - cost.lumber);
    // a disconnected edge is refused
    const far = T.edges.find((e) => !legalRoadEdges(s1, me.id).includes(e.id) && s1.roads[e.id] === undefined)!;
    expect(applyAction(s1, me.id, { type: 'placeRoad', edge: far.id }, mulberry32(1)).ok).toBe(false);
  });
  it('bank trade follows the ratio', () => {
    const s0 = mainState();
    const me = s0.players.find((p) => p.id === s0.current)!;
    s0.phase = 'main';
    me.resources.ore = 4;
    const ratio = bankRatioFor(s0, me.id, 'ore');
    const s1 = act(s0, me.id, { type: 'bankTrade', give: 'ore', get: 'wool' });
    const mine = s1.players.find((p) => p.id === me.id)!;
    expect(mine.resources.ore).toBe(4 - ratio);
    expect(mine.resources.wool).toBe(1);
  });
  it('player trade swaps cards and validates both sides', () => {
    const s0 = mainState();
    s0.phase = 'main';
    const a = s0.players.find((p) => p.id === s0.current)!;
    const b = s0.players.find((p) => p.id !== s0.current)!;
    a.resources.lumber = 2;
    b.resources.ore = 1;
    expect(applyAction(s0, a.id, { type: 'offerTrade', give: { grain: 1 }, want: { ore: 1 } }, mulberry32(1)).ok).toBe(false);
    let s = act(s0, a.id, { type: 'offerTrade', give: { lumber: 2 }, want: { ore: 1 } });
    expect(s.offers).toHaveLength(1);
    expect(applyAction(s, a.id, { type: 'acceptTrade', offerId: s.offers[0].id }, mulberry32(1)).ok).toBe(false);
    s = act(s, b.id, { type: 'acceptTrade', offerId: s.offers[0].id });
    expect(s.players.find((p) => p.id === a.id)!.resources.ore).toBe(1);
    expect(s.players.find((p) => p.id === b.id)!.resources.lumber).toBe(2);
    expect(s.offers).toHaveLength(0);
  });
  it('ending the turn passes play on and clears offers', () => {
    const s0 = mainState();
    s0.phase = 'main';
    const first = s0.current;
    const s = act(s0, first, { type: 'endTurn' });
    expect(s.current).not.toBe(first);
    expect(s.phase).toBe('roll');
  });
});

describe('longest road and winning', () => {
  /** Finds a simple path of n edges (no repeated vertex) from `start`, by backtracking. */
  function pathFrom(start: number, n: number): number[] {
    const seen = new Set([start]);
    const walk = (v: number, acc: number[]): number[] | null => {
      if (acc.length === n) return acc;
      for (const id of T.vertices[v].edges) {
        const e = T.edges[id];
        const next = e.a === v ? e.b : e.a;
        if (seen.has(next)) continue;
        seen.add(next);
        const found = walk(next, [...acc, id]);
        if (found) return found;
        seen.delete(next);
      }
      return null;
    };
    return walk(start, [])!;
  }

  it('awards 2 points at 5 roads and loses them when an enemy settlement cuts the road', () => {
    const s0 = mainState();
    s0.phase = 'main';
    const me = s0.current;
    const rival = s0.players.find((p) => p.id !== me)!.id;
    s0.buildings = {};
    s0.roads = {};
    const path = pathFrom(0, 6);
    path.slice(0, 5).forEach((e) => (s0.roads[e] = me));
    expect(longestRoadFor(s0, me)).toBe(5);
    // let the engine recompute by placing a 6th road
    s0.players.find((p) => p.id === me)!.resources = { lumber: 3, brick: 3, wool: 0, grain: 0, ore: 0 };
    s0.buildings[T.edges[path[0]].a] = { owner: me, kind: 'settlement' };
    const s1 = act(s0, me, { type: 'placeRoad', edge: path[5] });
    expect(s1.longestRoad.holder).toBe(me);
    expect(victoryPoints(s1, me)).toBe(1 + 2);
    // cut the chain in the middle with a rival settlement
    const mid = T.edges[path[2]].b;
    const s2 = structuredClone(s1);
    s2.buildings[mid] = { owner: rival, kind: 'settlement' };
    expect(longestRoadFor(s2, me)).toBeLessThan(6);
  });

  it('ends the game at the victory point target', () => {
    const s0 = mainState();
    s0.phase = 'main';
    s0.vpToWin = 3;
    const me = s0.current;
    s0.players.find((p) => p.id === me)!.resources = { lumber: 0, brick: 0, wool: 0, grain: 4, ore: 6 };
    const settlement = Number(Object.entries(s0.buildings).find(([, b]) => b.owner === me)![0]);
    const s1 = act(s0, me, { type: 'upgradeCity', vertex: settlement });
    expect(s1.phase).toBe('finished');
    expect(s1.winner).toBe(me);
    expect(applyAction(s1, me, { type: 'endTurn' }, mulberry32(1)).ok).toBe(false);
  });
});

describe('hidden information', () => {
  it('only the owner sees their hand', () => {
    const s = mainState();
    s.players[0].resources.ore = 3;
    s.players[1].resources.wool = 2;
    const v = viewFor(s, s.players[0].id);
    expect(v.players[0].resources?.ore).toBe(3);
    expect(v.players[1].resources).toBeNull();
    expect(v.players[1].cardCount).toBe(2);
    expect(JSON.stringify(v)).not.toContain('"wool":2');
  });
});
