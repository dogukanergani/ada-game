import { describe, expect, it } from 'vitest';
import {
  RESOURCES, applyAction, createGame, dealTestHands, handCount, legalCityVertices, legalRoadEdges, legalSettlementVertices, longestRoadFor,
  publicPoints, topologyOf, validate, type GameState,
} from '../src';
import {
  act, autoSetup, dice, farVertices, findPath, give, hand, mainPhase, mulberry32, newGame, putBuilding, putRoad, scripted, setTile, vertexAwayFrom,
} from './helpers';

const sum = (s: GameState, r: (typeof RESOURCES)[number]) => s.bank[r] + s.players.reduce((a, p) => a + p.hand[r], 0);

describe('createGame', () => {
  const base = [{ id: 'a', name: 'A', role: 'soldier' }, { id: 'b', name: 'B', role: 'sage' }];
  it('accepts 2-5 players and rejects the rest', () => {
    expect(createGame({ players: base, mode: 'standard' }, mulberry32(1)).ok).toBe(true);
    expect(createGame({ players: base.slice(0, 1), mode: 'standard' }, mulberry32(1)).ok).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: 'x', role: `r${i}` }));
    expect(createGame({ players: six, mode: 'standard' }, mulberry32(1)).ok).toBe(false);
  });
  it('rejects duplicate roles, duplicate ids and unknown roles', () => {
    const dupRole = createGame({ players: [base[0], { ...base[1], role: 'soldier' }], mode: 'standard' }, mulberry32(1));
    expect(dupRole).toMatchObject({ ok: false, error: { type: 'invalidSetup', reason: 'duplicateRole' } });
    const dupId = createGame({ players: [base[0], { ...base[1], id: 'a' }], mode: 'standard' }, mulberry32(1));
    expect(dupId).toMatchObject({ ok: false, error: { reason: 'duplicateId' } });
    const unknown = createGame({ players: [base[0], { ...base[1], role: 'nope' }], mode: 'standard' }, mulberry32(1));
    expect(unknown).toMatchObject({ ok: false, error: { reason: 'unknownRole' } });
  });
  it('sets the mode parameters', () => {
    const std = newGame(3);
    expect(std.vpToWin).toBe(10);
    expect(std.bank.ore).toBe(19);
    expect(std.map.id).toBe('classic19');
    const short = newGame(3, { mode: 'short' });
    expect(short.vpToWin).toBe(7);
    expect(short.bank.ore).toBe(14);
    expect(short.map.id).toBe('short14');
    expect(newGame(5).map.id).toBe('large30');
    expect(newGame(5).bank.wool).toBe(24);
  });
  it('state is plain JSON', () => {
    const s = newGame(4);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('setup', () => {
  it('follows the snake order and ends on the first player', () => {
    let s = newGame(3);
    const ids = s.players.map((p) => p.id);
    const seen: string[] = [];
    const rng = mulberry32(3);
    while (s.phase === 'setup') {
      if (s.setup!.step === 'settlement') seen.push(s.current);
      s = act(s, s.current, s.setup!.step === 'settlement'
        ? { type: 'placeSettlement', vertex: legalSettlementVertices(s, s.current)[0] }
        : { type: 'placeRoad', edge: legalRoadEdges(s, s.current)[0] }, rng);
    }
    expect(seen).toEqual([...ids, ...[...ids].reverse()]);
    expect(s.phase).toBe('roll');
    expect(s.current).toBe(ids[0]);
    expect(s.turn).toBe(1);
  });

  it('the road must touch the settlement just placed', () => {
    let s = newGame(2);
    const topo = topologyOf(s.map);
    s = act(s, s.current, { type: 'placeSettlement', vertex: 0 });
    const far = topo.edges.find((e) => e.a !== 0 && e.b !== 0)!.id;
    expect(validate(s, s.current, { type: 'placeRoad', edge: far })).toMatchObject({ type: 'notConnected' });
    expect(legalRoadEdges(s, s.current).sort()).toEqual([...topo.vertices[0].edges].sort());
  });

  it('the second settlement yields one card per neighbouring producing tile, taken from the bank', () => {
    let s = newGame(2);
    const topo = topologyOf(s.map);
    const rng = mulberry32(8);
    let second = 0;
    while (s.phase === 'setup') {
      const pid = s.current;
      const action = s.setup!.step === 'settlement'
        ? ({ type: 'placeSettlement', vertex: legalSettlementVertices(s, pid)[Math.floor(rng() * 20)] ?? legalSettlementVertices(s, pid)[0] } as const)
        : ({ type: 'placeRoad', edge: legalRoadEdges(s, pid)[0] } as const);
      const r = applyAction(s, pid, action, rng);
      if (!r.ok) throw new Error('setup move refused');
      if (action.type === 'placeSettlement') {
        const isSecond = s.setup!.index >= s.players.length;
        const gains = r.events.find((e) => e.type === 'setupResources');
        const expected = topo.vertices[action.vertex].tiles.filter((t) => s.tiles[t].kind !== 'desert').length;
        if (isSecond) {
          second++;
          if (expected > 0) expect(gains && gains.type === 'setupResources' && handCount(gains.gains)).toBe(expected);
        } else {
          expect(gains).toBeUndefined();
        }
      }
      s = r.state;
    }
    expect(second).toBe(2);
    for (const r of RESOURCES) expect(sum(s, r)).toBe(19);
  });

  it('no building actions in the wrong order or by the wrong player', () => {
    const s = newGame(3);
    const other = s.players.find((p) => p.id !== s.current)!.id;
    expect(validate(s, other, { type: 'placeSettlement', vertex: 0 })).toMatchObject({ type: 'notYourTurn' });
    expect(validate(s, s.current, { type: 'placeRoad', edge: 0 })).toMatchObject({ type: 'wrongPhase' });
    expect(validate(s, s.current, { type: 'roll' })).toMatchObject({ type: 'wrongPhase' });
  });
});

describe('building', () => {
  it('settlement needs distance, a connected road, cost and a free piece', () => {
    const s = mainPhase(2);
    const [v0] = [0];
    const topo = topologyOf(s.map);
    const road = topo.vertices[v0].edges[0];
    putRoad(s, road, 'p0');
    const far = topo.edges[road].a === v0 ? topo.edges[road].b : topo.edges[road].a;
    // end of the road is connected but we cannot afford it yet
    expect(validate(s, 'p0', { type: 'placeSettlement', vertex: far })).toMatchObject({ type: 'cannotAfford' });
    give(s, 'p0', hand({ lumber: 1, brick: 1, wool: 1, grain: 1 }));
    expect(validate(s, 'p0', { type: 'placeSettlement', vertex: far })).toBeNull();
    // not connected
    const lone = topo.vertices.find((v) => !topo.vertices[v0].neighbors.includes(v.id) && v.id !== v0 && v.id !== far && !topo.vertices[far].neighbors.includes(v.id))!.id;
    expect(validate(s, 'p0', { type: 'placeSettlement', vertex: lone })).toMatchObject({ type: 'notConnected' });
    // distance rule: next to an existing building
    putBuilding(s, far, 'p1');
    expect(validate(s, 'p0', { type: 'placeSettlement', vertex: topo.vertices[far].neighbors[0] })).toMatchObject({ type: 'distanceRule' });
    expect(validate(s, 'p0', { type: 'placeSettlement', vertex: far })).toMatchObject({ type: 'occupied' });
  });

  it('paying returns the cost to the bank', () => {
    let s = mainPhase(2);
    const topo = topologyOf(s.map);
    putBuilding(s, 0, 'p0');
    give(s, 'p0', hand({ lumber: 1, brick: 1 }));
    const e = topo.vertices[0].edges[0];
    s = act(s, 'p0', { type: 'placeRoad', edge: e });
    expect(handCount(s.players[0].hand)).toBe(0);
    for (const r of RESOURCES) expect(sum(s, r)).toBe(19);
  });

  it('a road cannot pass through an opponent building', () => {
    const s = mainPhase(2);
    const topo = topologyOf(s.map);
    const [e1] = topo.vertices[0].edges;
    const mid = topo.edges[e1].a === 0 ? topo.edges[e1].b : topo.edges[e1].a;
    putBuilding(s, 0, 'p0');
    putRoad(s, e1, 'p0');
    putBuilding(s, mid, 'p1');
    give(s, 'p0', hand({ lumber: 5, brick: 5 }));
    const next = topo.vertices[mid].edges.find((e) => e !== e1)!;
    expect(validate(s, 'p0', { type: 'placeRoad', edge: next })).toMatchObject({ type: 'notConnected' });
  });

  it('the road limit is a piece limit, not a geometry problem', () => {
    const s = mainPhase(2);
    const topo = topologyOf(s.map);
    const path = findPath(s, 15);
    path.forEach((e) => putRoad(s, e, 'p0'));
    give(s, 'p0', hand({ lumber: 5, brick: 5 }));
    const end = topo.edges[path[14]];
    const next = topo.vertices[end.a].edges.concat(topo.vertices[end.b].edges).find((e) => s.roads[e] === undefined)!;
    expect(validate(s, 'p0', { type: 'placeRoad', edge: next })).toMatchObject({ type: 'pieceLimit', piece: 'road' });
    expect(legalRoadEdges(s, 'p0')).toEqual([]);
    expect(legalRoadEdges(s, 'p0', { ignoreCost: true })).toEqual([]);
  });

  it('the settlement limit hides settlement spots in the legal list and the validator', () => {
    const s0 = newGame(2);
    const topo = topologyOf(s0.map);
    // spur v0 - w - x: x is a connected, legal spot as long as no other building touches it
    const v0 = 0;
    const e1 = topo.vertices[v0].edges[0];
    const w = topo.edges[e1].a === v0 ? topo.edges[e1].b : topo.edges[e1].a;
    const e2 = topo.vertices[w].edges.find((e) => e !== e1)!;
    const x = topo.edges[e2].a === w ? topo.edges[e2].b : topo.edges[e2].a;
    const taken = new Set([v0, w, x, ...topo.vertices[v0].neighbors, ...topo.vertices[x].neighbors]);
    const others: number[] = [];
    for (const v of topo.vertices) {
      if (taken.has(v.id) || others.some((o) => o === v.id || topo.vertices[o].neighbors.includes(v.id))) continue;
      others.push(v.id);
    }
    const build = (settlements: number) => {
      const s = mainPhase(2);
      [v0, ...others].slice(0, settlements).forEach((v) => putBuilding(s, v, 'p0'));
      putRoad(s, e1, 'p0');
      putRoad(s, e2, 'p0');
      give(s, 'p0', hand({ lumber: 4, brick: 4, wool: 4, grain: 4 }));
      return s;
    };
    expect(legalSettlementVertices(build(4), 'p0')).toContain(x);
    const full = build(5);
    expect(legalSettlementVertices(full, 'p0')).toEqual([]);
    expect(legalSettlementVertices(full, 'p0', { ignoreCost: true })).toEqual([]);
    expect(validate(full, 'p0', { type: 'placeSettlement', vertex: x })).toMatchObject({ type: 'pieceLimit', piece: 'settlement' });
  });

  it('the city limit hides city spots', () => {
    const s = mainPhase(2);
    const spread = farVertices(s, 6);
    spread.slice(0, 4).forEach((v) => putBuilding(s, v, 'p0', 'city'));
    putBuilding(s, spread[4], 'p0');
    give(s, 'p0', hand({ grain: 2, ore: 3 }));
    expect(legalCityVertices(s, 'p0', { ignoreCost: true })).toEqual([]);
    expect(validate(s, 'p0', { type: 'upgradeCity', vertex: spread[4] })).toMatchObject({ type: 'pieceLimit', piece: 'city' });
  });

  it('upgrades only own settlements, then the city counts double', () => {
    let s = mainPhase(2);
    putBuilding(s, 3, 'p0');
    putBuilding(s, 20, 'p1');
    give(s, 'p0', hand({ grain: 2, ore: 3 }));
    expect(validate(s, 'p0', { type: 'upgradeCity', vertex: 20 })).toMatchObject({ type: 'invalidTarget' });
    s = act(s, 'p0', { type: 'upgradeCity', vertex: 3 });
    expect(s.buildings[3].kind).toBe('city');
    expect(publicPoints(s, 'p0')).toBe(2);
    expect(validate(s, 'p0', { type: 'upgradeCity', vertex: 3 })).toMatchObject({ type: 'invalidTarget' });
  });
});

describe('dice and production', () => {
  function board() {
    const s = mainPhase(3);
    s.phase = 'roll';
    const topo = topologyOf(s.map);
    const c = topo.tiles[9].corners;
    s.tiles.forEach((_, i) => setTile(s, i, 'lumber', 4));
    setTile(s, 9, 'ore', 8);
    s.robber = 0;
    setTile(s, 0, 'desert', null);
    return { s, c };
  }

  it('settlements give 1, cities give 2', () => {
    const { s, c } = board();
    putBuilding(s, c[0], 'p0');
    putBuilding(s, c[2], 'p1', 'city');
    const r = applyAction(s, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    if (!r.ok) throw new Error('roll refused');
    expect(r.state.players[0].hand.ore).toBe(1);
    expect(r.state.players[1].hand.ore).toBe(2);
    expect(r.state.phase).toBe('main');
    expect(sum(r.state, 'ore')).toBe(19);
  });

  it('the robber blocks its tile', () => {
    const { s, c } = board();
    putBuilding(s, c[0], 'p0');
    s.robber = 9;
    const r = act(s, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    expect(r.players[0].hand.ore).toBe(0);
  });

  describe('which tiles the roll hit (public, for the client to mark)', () => {
    const rollEvent = (s: ReturnType<typeof board>['s'], d1: number, d2: number) => {
      const r = applyAction(s, 'p0', { type: 'roll' }, scripted(dice(d1, d2)));
      if (!r.ok) throw new Error('roll refused');
      const e = r.events.find((x) => x.type === 'diceRolled');
      if (!e || e.type !== 'diceRolled') throw new Error('no diceRolled event');
      return e;
    };

    it('lists the tiles whose number came up and that have a building', () => {
      const { s, c } = board();
      putBuilding(s, c[0], 'p0');
      expect(rollEvent(s, 4, 4)).toMatchObject({ total: 8, hitTiles: [9], robbedTile: null });
    });

    it('leaves out a tile with no building, and a number nobody rolled', () => {
      const { s } = board();
      expect(rollEvent(s, 4, 4)).toMatchObject({ hitTiles: [], robbedTile: null });
      const { s: s2, c: c2 } = board();
      putBuilding(s2, c2[0], 'p0');
      expect(rollEvent(s2, 1, 2)).toMatchObject({ hitTiles: [] });
    });

    it('reports the robber tile apart: it is not a hit, whether or not it has a building', () => {
      const { s, c } = board();
      putBuilding(s, c[0], 'p0');
      s.robber = 9;
      expect(rollEvent(s, 4, 4)).toMatchObject({ hitTiles: [], robbedTile: 9 });
      const { s: s2 } = board();
      s2.robber = 9;
      expect(rollEvent(s2, 4, 4)).toMatchObject({ hitTiles: [], robbedTile: 9 });
    });

    it('a robber elsewhere, or a seven, reports no robbed tile', () => {
      const { s, c } = board();
      putBuilding(s, c[0], 'p0');
      expect(rollEvent(s, 4, 4).robbedTile).toBeNull();
      const { s: s7 } = board();
      expect(rollEvent(s7, 3, 4)).toMatchObject({ total: 7, hitTiles: [], robbedTile: null });
    });

    it('a tile that is hit but whose resource the bank cannot pay is still a hit (the log says what was short)', () => {
      const { s, c } = board();
      putBuilding(s, c[0], 'p0');
      putBuilding(s, c[2], 'p1');
      s.bank.ore = 1;
      expect(rollEvent(s, 4, 4).hitTiles).toEqual([9]);
    });
  });

  it('short bank: several claimants get nothing, a single claimant gets the rest', () => {
    const { s, c } = board();
    putBuilding(s, c[0], 'p0');
    putBuilding(s, c[2], 'p1');
    s.bank.ore = 1;
    const both = applyAction(s, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    if (!both.ok) throw new Error('refused');
    expect(both.state.players[0].hand.ore + both.state.players[1].hand.ore).toBe(0);
    expect(both.events).toContainEqual({ type: 'productionBlocked', resource: 'ore', reason: 'multiple' });

    const { s: s2, c: c2 } = board();
    putBuilding(s2, c2[0], 'p0', 'city');
    s2.bank.ore = 1;
    const single = applyAction(s2, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    if (!single.ok) throw new Error('refused');
    expect(single.state.players[0].hand.ore).toBe(1);
    expect(single.state.bank.ore).toBe(0);
  });

  it('enough stock pays everyone in full', () => {
    const { s, c } = board();
    putBuilding(s, c[0], 'p0');
    putBuilding(s, c[2], 'p1');
    s.bank.ore = 2;
    const r = act(s, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    expect(r.players[0].hand.ore).toBe(1);
    expect(r.players[1].hand.ore).toBe(1);
  });

  it('only the current player rolls, and only once', () => {
    const { s } = board();
    expect(validate(s, 'p1', { type: 'roll' })).toMatchObject({ type: 'notYourTurn' });
    const r = act(s, 'p0', { type: 'roll' }, scripted(dice(1, 2)));
    expect(validate(r, 'p0', { type: 'roll' })).toMatchObject({ type: 'wrongPhase' });
  });
});

describe('seven, discard, robber', () => {
  function sevenGame() {
    const s = mainPhase(3);
    s.phase = 'roll';
    const topo = topologyOf(s.map);
    const c = topo.tiles[9].corners;
    putBuilding(s, c[0], 'p1');
    putBuilding(s, c[2], 'p2');
    return { s, c };
  }

  it('players above the limit discard half, rounded down; others do not', () => {
    const { s } = sevenGame();
    give(s, 'p0', hand({ lumber: 8 }));
    give(s, 'p1', hand({ brick: 7 }));
    give(s, 'p2', hand({ wool: 9 }));
    let g = act(s, 'p0', { type: 'roll' }, scripted(dice(3, 4)));
    expect(g.phase).toBe('discard');
    expect(g.pendingDiscards).toEqual({ p0: 4, p2: 4 });
    expect(validate(g, 'p0', { type: 'discard', resources: { lumber: 3 } })).toMatchObject({ type: 'invalidHand' });
    expect(validate(g, 'p0', { type: 'discard', resources: { brick: 4 } })).toMatchObject({ type: 'invalidHand' });
    expect(validate(g, 'p1', { type: 'discard', resources: { brick: 3 } })).toMatchObject({ type: 'invalidTarget' });
    g = act(g, 'p2', { type: 'discard', resources: { wool: 4 } });
    expect(g.phase).toBe('discard');
    g = act(g, 'p0', { type: 'discard', resources: { lumber: 4 } });
    expect(g.phase).toBe('robber');
    expect(g.players[2].hand.wool).toBe(5);
    expect(sum(g, 'wool')).toBe(19);
  });

  it('no discard needed goes straight to the robber; the robber must move', () => {
    const { s } = sevenGame();
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(3, 4)));
    expect(g.phase).toBe('robber');
    expect(validate(g, 'p0', { type: 'moveRobber', tile: g.robber })).toMatchObject({ type: 'invalidTarget' });
    expect(validate(g, 'p1', { type: 'moveRobber', tile: 3 })).toMatchObject({ type: 'notYourTurn' });
  });

  it('one victim is robbed automatically; the game returns to main', () => {
    const { s } = sevenGame();
    give(s, 'p1', hand({ grain: 2 }));
    let g = act(s, 'p0', { type: 'roll' }, scripted(dice(3, 4)));
    const topo = topologyOf(g.map);
    const tile = topo.tiles[9].id === g.robber ? 8 : 9;
    expect(tile).toBe(9);
    g = act(g, 'p0', { type: 'moveRobber', tile });
    expect(g.phase).toBe('main');
    expect(g.players[0].hand.grain).toBe(1);
    expect(g.players[1].hand.grain).toBe(1);
  });

  it('several victims: choose one; players without cards cannot be chosen', () => {
    const { s } = sevenGame();
    give(s, 'p1', hand({ grain: 1 }));
    give(s, 'p2', hand({ ore: 1 }));
    let g = act(s, 'p0', { type: 'roll' }, scripted(dice(3, 4)));
    g = act(g, 'p0', { type: 'moveRobber', tile: 9 });
    expect(g.phase).toBe('steal');
    expect(g.stealFrom.sort()).toEqual(['p1', 'p2']);
    expect(validate(g, 'p0', { type: 'steal', victim: 'p0' })).toMatchObject({ type: 'invalidTarget' });
    g = act(g, 'p0', { type: 'steal', victim: 'p2' });
    expect(g.players[0].hand.ore).toBe(1);
    expect(g.phase).toBe('main');
  });

  it('an empty-handed neighbour is not a victim', () => {
    const { s } = sevenGame();
    let g = act(s, 'p0', { type: 'roll' }, scripted(dice(3, 4)));
    g = act(g, 'p0', { type: 'moveRobber', tile: 9 });
    expect(g.phase).toBe('main');
  });
});

describe('player trade', () => {
  it('only the current player offers, others accept, cards swap', () => {
    let s = mainPhase(3);
    give(s, 'p0', hand({ lumber: 2 }));
    give(s, 'p1', hand({ ore: 1 }));
    expect(validate(s, 'p1', { type: 'offerTrade', give: { ore: 1 }, want: { lumber: 1 } })).toMatchObject({ type: 'notYourTurn' });
    expect(validate(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { lumber: 1 } })).toMatchObject({ type: 'invalidTrade' });
    expect(validate(s, 'p0', { type: 'offerTrade', give: { lumber: 3 }, want: { ore: 1 } })).toMatchObject({ type: 'cannotAfford' });
    s = act(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { ore: 1 } });
    const id = s.offers[0].id;
    expect(validate(s, 'p0', { type: 'acceptTrade', offerId: id })).toMatchObject({ type: 'ownOffer' });
    expect(validate(s, 'p2', { type: 'acceptTrade', offerId: id })).toMatchObject({ type: 'cannotAfford' });
    s = act(s, 'p1', { type: 'acceptTrade', offerId: id });
    expect(s.players[0].hand).toEqual(hand({ lumber: 1, ore: 1 }));
    expect(s.players[1].hand).toEqual(hand({ lumber: 1 }));
    expect(s.offers).toEqual([]);
  });

  it('cancel and replace', () => {
    let s = mainPhase(2);
    give(s, 'p0', hand({ lumber: 2 }));
    s = act(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { ore: 1 } });
    s = act(s, 'p0', { type: 'offerTrade', give: { lumber: 2 }, want: { ore: 1 } });
    expect(s.offers).toHaveLength(1);
    expect(validate(s, 'p1', { type: 'cancelTrade', offerId: s.offers[0].id })).toMatchObject({ type: 'noSuchOffer' });
    s = act(s, 'p0', { type: 'cancelTrade', offerId: s.offers[0].id });
    expect(s.offers).toEqual([]);
  });

  it('offers vanish at the end of the turn', () => {
    let s = mainPhase(2);
    give(s, 'p0', hand({ lumber: 1 }));
    s = act(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { ore: 1 } });
    s = act(s, 'p0', { type: 'endTurn' });
    expect(s.offers).toEqual([]);
    expect(s.current).toBe('p1');
    expect(s.phase).toBe('roll');
  });
});

describe('longest road and winning', () => {
  it('needs 5 roads, is worth 2 points, and is lost when an opponent settlement cuts it', () => {
    let s = mainPhase(2);
    s.vpToWin = 99;
    const topo = topologyOf(s.map);
    const path = findPath(s, 5);
    path.slice(0, 4).forEach((e) => putRoad(s, e, 'p0'));
    give(s, 'p0', hand({ lumber: 1, brick: 1 }));
    expect(s.longestRoad.holder).toBeNull();
    s = act(s, 'p0', { type: 'placeRoad', edge: path[4] });
    expect(longestRoadFor(s, 'p0')).toBe(5);
    expect(s.longestRoad).toEqual({ holder: 'p0', length: 5 });
    expect(publicPoints(s, 'p0')).toBe(2);

    // p1 settles on the vertex between the second and third road, on a spur of its own
    const e1 = topo.edges[path[1]];
    const e2 = topo.edges[path[2]];
    const inner = [e1.a, e1.b].find((v) => v === e2.a || v === e2.b)!;
    const spur = topo.vertices[inner].edges.find((e) => !path.includes(e))!;
    putRoad(s, spur, 'p1');
    s.current = 'p1';
    give(s, 'p1', hand({ lumber: 1, brick: 1, wool: 1, grain: 1 }));
    s = act(s, 'p1', { type: 'placeSettlement', vertex: inner });
    expect(longestRoadFor(s, 'p0')).toBeLessThan(5);
    expect(s.longestRoad).toEqual({ holder: null, length: 0 });
  });

  it('a tie keeps the holder; a strictly longer road takes the award', () => {
    const s = mainPhase(2);
    s.vpToWin = 99;
    const topo = topologyOf(s.map);
    const a = findPath(s, 5, 0);
    const b = findPath(s, 6, topo.vertices.length - 1);
    const touched = new Set(a.flatMap((e) => [topo.edges[e].a, topo.edges[e].b]));
    if (b.some((e) => touched.has(topo.edges[e].a) || touched.has(topo.edges[e].b))) throw new Error('test paths overlap');
    a.forEach((e) => putRoad(s, e, 'p0'));
    s.longestRoad = { holder: 'p0', length: 5 };
    b.slice(0, 4).forEach((e) => putRoad(s, e, 'p1'));
    s.current = 'p1';
    give(s, 'p1', hand({ lumber: 2, brick: 2 }));
    let g = act(s, 'p1', { type: 'placeRoad', edge: b[4] });
    expect(longestRoadFor(g, 'p1')).toBe(5);
    expect(g.longestRoad.holder).toBe('p0');
    g = act(g, 'p1', { type: 'placeRoad', edge: b[5] });
    expect(g.longestRoad).toEqual({ holder: 'p1', length: 6 });
  });

  it('an equal road elsewhere does not take the award; an unresolved tie without a holder gives it to nobody', () => {
    const s = mainPhase(3);
    s.vpToWin = 99;
    const topo = topologyOf(s.map);
    const a = findPath(s, 5, 0);
    const b = findPath(s, 5, topo.vertices.length - 1);
    a.slice(0, 4).forEach((e) => putRoad(s, e, 'p0'));
    b.forEach((e) => putRoad(s, e, 'p1'));
    s.longestRoad = { holder: 'p1', length: 5 };
    give(s, 'p0', hand({ lumber: 1, brick: 1 }));
    const g = act(s, 'p0', { type: 'placeRoad', edge: a[4] });
    expect(g.longestRoad.holder).toBe('p1');

    // same position, but nobody holds the award yet: p1's 5 roads were never scored, so p0's fifth road ties
    const none = structuredClone(s);
    none.longestRoad = { holder: null, length: 0 };
    const g2 = act(none, 'p0', { type: 'placeRoad', edge: a[4] });
    expect(g2.longestRoad.holder).toBeNull();
  });
  it('the current player wins the moment they reach the target', () => {
    let s = mainPhase(2);
    s.vpToWin = 2;
    const topo = topologyOf(s.map);
    putBuilding(s, 0, 'p0');
    const e1 = topo.vertices[0].edges[0];
    const w = topo.edges[e1].a === 0 ? topo.edges[e1].b : topo.edges[e1].a;
    const e2 = topo.vertices[w].edges.find((e) => e !== e1)!;
    const end = topo.edges[e2].a === w ? topo.edges[e2].b : topo.edges[e2].a;
    putRoad(s, e1, 'p0');
    putRoad(s, e2, 'p0');
    give(s, 'p0', hand({ lumber: 1, brick: 1, wool: 1, grain: 1 }));
    s = act(s, 'p0', { type: 'placeSettlement', vertex: end });
    expect(s.phase).toBe('finished');
    expect(s.winners).toEqual(['p0']);
    expect(validate(s, 'p0', { type: 'endTurn' })).toMatchObject({ type: 'gameOver' });
  });

  it('a player at the target on another turn wins when their own turn starts', () => {
    let s = mainPhase(2);
    s.vpToWin = 2;
    putBuilding(s, vertexAwayFrom(s, []), 'p1', 'city');
    give(s, 'p0', hand({ lumber: 1 }));
    s = act(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { ore: 1 } });
    expect(s.phase).toBe('main');
    expect(s.winners).toEqual([]);
    s = act(s, 'p0', { type: 'endTurn' });
    expect(s.phase).toBe('finished');
    expect(s.winners).toEqual(['p1']);
  });
});

describe('purity', () => {
  it('applyAction never mutates its input', () => {
    const s = mainPhase(2);
    give(s, 'p0', hand({ lumber: 2 }));
    const before = JSON.stringify(s);
    applyAction(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { ore: 1 } }, mulberry32(1));
    applyAction(s, 'p0', { type: 'endTurn' }, mulberry32(1));
    expect(JSON.stringify(s)).toBe(before);
  });

  it('refuses malformed input without throwing', () => {
    const s = mainPhase(2);
    const bad: unknown[] = [
      null, 5, {}, { type: 'nope' }, { type: 'placeRoad', edge: 'x' }, { type: 'placeRoad', edge: -1 }, { type: 'placeSettlement', vertex: 1.5 },
      { type: 'discard', resources: 7 }, { type: 'bankTrade', give: 'gold', get: 'ore' }, { type: 'offerTrade', give: { lumber: -1 }, want: { ore: 1 } },
      { type: 'roleAction' }, { type: 'roleAction', name: 'constructor' }, { type: 'roleAction', name: 'x', params: [] },
    ];
    for (const b of bad) {
      const r = applyAction(s, 'p0', b as never, mulberry32(1));
      expect(r.ok).toBe(false);
    }
    expect(applyAction(s, 'ghost', { type: 'endTurn' }, mulberry32(1))).toMatchObject({ ok: false, error: { type: 'notInGame' } });
  });
});

describe('dealTestHands (test-only starting cards)', () => {
  const total = (s: GameState, r: (typeof RESOURCES)[number]) => s.bank[r] + s.players.reduce((n, p) => n + p.hand[r], 0);

  it('gives every player that many of each resource from the bank, and keeps the totals', () => {
    const s = newGame(3, { mode: 'short' });
    const before = RESOURCES.map((r) => total(s, r));
    dealTestHands(s, 4);
    for (const p of s.players) for (const r of RESOURCES) expect(p.hand[r]).toBe(4);
    for (const r of RESOURCES) expect(s.bank[r]).toBe(14 - 12); // the short mode's bank holds 14 of each
    expect(RESOURCES.map((r) => total(s, r))).toEqual(before);
  });

  it('when the bank runs short, deals round by round so the last seat is not the one left out', () => {
    const s = newGame(5, { mode: 'short' });
    dealTestHands(s, 5); // 25 wanted, 19 in the bank
    for (const r of RESOURCES) {
      const held = s.players.map((p) => p.hand[r]);
      expect(Math.max(...held) - Math.min(...held), `${r}: ${held}`).toBeLessThanOrEqual(1);
      expect(Math.min(...held)).toBeGreaterThanOrEqual(3);
      expect(s.bank[r]).toBe(0);
      expect(total(s, r)).toBe(19);
    }
    // and the one who is short rotates with the resource: every player ends with the same number of cards
    const sizes = s.players.map((p) => RESOURCES.reduce((n, r) => n + p.hand[r], 0));
    expect(new Set(sizes).size).toBe(1);
    // the last seat in particular holds as many cards as the first
    expect(sizes[4]).toBe(sizes[0]);
  });

  it('never makes anything negative, and a game still plays on from there', () => {
    const s = newGame(2, { mode: 'short' });
    dealTestHands(s, 19); // far more than the bank holds
    for (const r of RESOURCES) {
      expect(s.bank[r]).toBe(0);
      expect(s.players.map((p) => p.hand[r])).toEqual([7, 7]);
    }
    const played = autoSetup(s);
    expect(played.phase).toBe('roll');
    for (const r of RESOURCES) expect(total(played, r)).toBe(14);
  });
});
