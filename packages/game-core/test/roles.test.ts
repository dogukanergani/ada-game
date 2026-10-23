import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMOLISHES_PER_TURN, DEMOLISH_COSTS, RESOURCES, ROLE_LIST, applyAction, bankRatioFor, countPieces, createGame, legalRoleActions, longestRoadFor, publicPoints, topologyOf, validate,
  type Action, type GameState,
} from '../src';
import { act, dice, findPath, give, hand, mainPhase, mulberry32, putBuilding, putRoad, scripted, setTile, vertexAwayFrom } from './helpers';

const sum = (s: GameState, r: (typeof RESOURCES)[number]) => s.bank[r] + s.players.reduce((a, p) => a + p.hand[r], 0);
const demolish = (kind: string, id: number): Action => ({ type: 'roleAction', name: 'demolish', params: { kind, id } });

describe('role registry', () => {
  it('has five roles; the list is data and the core knows no role by name', () => {
    expect(ROLE_LIST.map((r) => r.id).sort()).toEqual(['diplomat', 'harvester', 'sage', 'sailor', 'soldier']);
    const dir = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else files.push(join(d, e.name));
      }
    };
    walk(dir);
    const names = /(soldier|sage|sailor|diplomat|harvester)/i;
    for (const f of files) {
      if (f.replace(/\\/g, '/').endsWith('roles/defs.ts')) continue;
      if (names.test(readFileSync(f, 'utf8'))) throw new Error(`role name found outside roles/defs.ts: ${f}`);
    }
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/Math\.random|Date\.now|new Date\(/.test(src)) throw new Error(`impure call in ${f}`);
    }
  });

  it('a role action of another role is unknown', () => {
    const s = mainPhase(2, { roles: ['sage', 'soldier'] });
    expect(validate(s, 'p0', demolish('road', 0))).toMatchObject({ type: 'unknownRoleAction' });
    expect(validate(s, 'p0', { type: 'roleAction', name: 'toString' })).toMatchObject({ type: 'unknownRoleAction' });
    expect(legalRoleActions(s, 'p0')).toEqual([]);
  });

  it('players cannot share a role', () => {
    const r = createGame({ players: [{ id: 'a', name: 'a', role: 'sage' }, { id: 'b', name: 'b', role: 'sage' }], mode: 'standard' }, mulberry32(1));
    expect(r.ok).toBe(false);
  });
});

describe('sage: cheaper development cards', () => {
  it('costs grain and ore only', () => {
    let s = mainPhase(2, { roles: ['sage', 'sailor'] });
    give(s, 'p0', hand({ grain: 1, ore: 1 }));
    give(s, 'p1', hand({ grain: 1, ore: 1 }));
    expect(validate(s, 'p1', { type: 'buyDevCard' })).toMatchObject({ type: 'notYourTurn' });
    s = act(s, 'p0', { type: 'buyDevCard' });
    expect(s.players[0].hand).toEqual(hand());
    const other = mainPhase(2, { roles: ['sailor', 'sage'] });
    give(other, 'p0', hand({ grain: 1, ore: 1 }));
    expect(validate(other, 'p0', { type: 'buyDevCard' })).toMatchObject({ type: 'cannotAfford' });
  });
});

describe('sailor: bank ratio one lower', () => {
  it('4 becomes 3, a generic harbor 3 becomes 2, never below 2', () => {
    const s = mainPhase(2, { roles: ['sailor', 'sage'] });
    const topo = topologyOf(s.map);
    expect(bankRatioFor(s, 'p0', 'ore')).toBe(3);
    expect(bankRatioFor(s, 'p1', 'ore')).toBe(4);
    s.harbors[0] = { edge: s.harbors[0].edge, type: 'any' };
    putBuilding(s, topo.edges[s.harbors[0].edge].a, 'p0');
    expect(bankRatioFor(s, 'p0', 'ore')).toBe(2);
    s.harbors[1] = { edge: s.harbors[1].edge, type: 'ore' };
    putBuilding(s, topo.edges[s.harbors[1].edge].a, 'p0');
    expect(bankRatioFor(s, 'p0', 'ore')).toBe(2);
    expect(bankRatioFor(s, 'p0', 'wool')).toBe(2);
  });

  it('trades at the lowered ratio', () => {
    let s = mainPhase(2, { roles: ['sailor', 'sage'] });
    give(s, 'p0', hand({ lumber: 3 }));
    s = act(s, 'p0', { type: 'bankTrade', give: 'lumber', get: 'ore' });
    expect(s.players[0].hand).toEqual(hand({ ore: 1 }));
  });
});

describe('diplomat: bonus for accepted offers', () => {
  function trade(s: GameState): GameState {
    s = act(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { ore: 1 } });
    return act(s, 'p1', { type: 'acceptTrade', offerId: s.offers[0].id }, scripted([0.3]));
  }

  it('the offerer gets one bank resource, once per turn', () => {
    let s = mainPhase(2, { roles: ['diplomat', 'sage'] });
    give(s, 'p0', hand({ lumber: 3 }));
    give(s, 'p1', hand({ ore: 3 }));
    s = trade(s);
    const total = (g: GameState) => g.players[0].hand.lumber + g.players[0].hand.ore + g.players[0].hand.brick + g.players[0].hand.wool + g.players[0].hand.grain;
    expect(total(s)).toBe(2 + 1 + 1); // 3 lumber - 1 + 1 ore + 1 bonus
    expect(s.turnFlags.counters.tradeBonus).toBe(1);
    s = trade(s);
    expect(total(s)).toBe(4); // second trade: a plain swap, no second bonus
    for (const r of RESOURCES) expect(sum(s, r)).toBe(19);
  });

  it('the counter resets with the next turn', () => {
    let s = mainPhase(2, { roles: ['diplomat', 'sage'] });
    give(s, 'p0', hand({ lumber: 3 }));
    give(s, 'p1', hand({ ore: 3 }));
    s = trade(s);
    s = act(s, 'p0', { type: 'endTurn' });
    expect(s.turnFlags.counters).toEqual({});
  });

  it('only the offerer\'s role matters, not the accepter\'s', () => {
    let s = mainPhase(2, { roles: ['sage', 'diplomat'] });
    give(s, 'p0', hand({ lumber: 1 }));
    give(s, 'p1', hand({ ore: 1 }));
    s = trade(s);
    expect(s.players[0].hand).toEqual(hand({ ore: 1 }));
    expect(s.players[1].hand).toEqual(hand({ lumber: 1 }));
  });

  it('gets nothing when the bank is empty', () => {
    let s = mainPhase(2, { roles: ['diplomat', 'sage'] });
    give(s, 'p0', hand({ lumber: 1 }));
    give(s, 'p1', hand({ ore: 1 }));
    for (const r of RESOURCES) s.bank[r] = 0;
    s = trade(s);
    expect(s.players[0].hand).toEqual(hand({ ore: 1 }));
  });
});

describe('harvester: a bank card when the roll gives nothing', () => {
  function board(roles: string[]) {
    const s = mainPhase(2, { roles });
    s.phase = 'roll';
    const topo = topologyOf(s.map);
    s.tiles.forEach((_, i) => setTile(s, i, 'lumber', 4));
    setTile(s, 9, 'ore', 8);
    setTile(s, 0, 'desert', null);
    s.robber = 0;
    const c = topo.tiles[9].corners;
    putBuilding(s, c[0], 'p0');
    return s;
  }

  it('gets one random bank card on a roll with no production', () => {
    const s = board(['harvester', 'sage']);
    const g = act(s, 'p0', { type: 'roll' }, scripted([...dice(1, 2), 0.5]));
    const n = RESOURCES.reduce((a, r) => a + g.players[0].hand[r], 0);
    expect(n).toBe(1);
    for (const r of RESOURCES) expect(sum(g, r)).toBe(19);
  });

  it('gets nothing extra when the roll produced something', () => {
    const s = board(['harvester', 'sage']);
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    expect(g.players[0].hand).toEqual(hand({ ore: 1 }));
  });

  it('no bonus when the robber blocks the matching tile', () => {
    // changed on purpose: the dice did hit the player's building, the robber is what stopped it
    const s = board(['harvester', 'sage']);
    s.robber = 9;
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    expect(g.players[0].hand).toEqual(hand());
  });

  it('no bonus when the bank cannot pay the matching tile', () => {
    const s = board(['harvester', 'sage']);
    s.bank.ore = 0;
    for (const p of s.players) p.hand.ore = 0;
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    expect(g.players[0].hand).toEqual(hand());
  });

  it('only on their own roll: an empty roll by someone else gives them nothing', () => {
    const s = board(['sage', 'harvester']);
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(1, 2)));
    expect(g.players[1].hand).toEqual(hand());
    expect(g.players[0].hand).toEqual(hand());
  });

  it('only while holding at most 3 cards', () => {
    const rich = board(['harvester', 'sage']);
    rich.players[0].hand = hand({ ore: 4 });
    const none = act(rich, 'p0', { type: 'roll' }, scripted([...dice(1, 2), 0.5]));
    expect(none.players[0].hand).toEqual(hand({ ore: 4 }));

    const poor = board(['harvester', 'sage']);
    poor.players[0].hand = hand({ ore: 3 });
    const some = act(poor, 'p0', { type: 'roll' }, scripted([...dice(1, 2), 0.5]));
    expect(RESOURCES.reduce((n, r) => n + some.players[0].hand[r], 0)).toBe(4);
  });

  it('does not trigger on a seven', () => {
    const s = board(['harvester', 'sage']);
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(3, 4)));
    expect(g.players[0].hand).toEqual(hand());
  });

  it('other roles get nothing for an empty roll', () => {
    const s = board(['sage', 'harvester']);
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(1, 2)));
    expect(g.players[0].hand).toEqual(hand());
  });

  it('never exceeds an empty bank', () => {
    const s = board(['harvester', 'sage']);
    for (const r of RESOURCES) s.bank[r] = 0;
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(1, 2)));
    expect(g.players[0].hand).toEqual(hand());
  });

  it('a role bonus cannot take the last card of a resource that production already took', () => {
    const s = board(['sage', 'harvester']);
    const topo = topologyOf(s.map);
    putBuilding(s, topo.tiles[9].corners[2], 'p1', 'city');
    s.phase = 'roll';
    s.current = 'p0';
    for (const r of RESOURCES) s.bank[r] = 0;
    s.bank.ore = 2;
    const g = act(s, 'p0', { type: 'roll' }, scripted(dice(4, 4)));
    expect(sum(g, 'ore')).toBe(2);
    expect(g.bank.ore + g.players[0].hand.ore + g.players[1].hand.ore).toBe(2);
  });
});

describe('soldier: demolish', () => {
  function war() {
    const s = mainPhase(3, { roles: ['soldier', 'sage', 'sailor'] });
    s.vpToWin = 99;
    const topo = topologyOf(s.map);
    // p1 owns two settlements, a city and a road; p2 owns one settlement
    const spread: number[] = [];
    for (const v of topo.vertices) {
      if (spread.every((o) => o !== v.id && !topo.vertices[o].neighbors.includes(v.id))) spread.push(v.id);
    }
    putBuilding(s, spread[0], 'p1');
    putBuilding(s, spread[1], 'p1');
    putBuilding(s, spread[2], 'p1', 'city');
    putBuilding(s, spread[3], 'p2');
    const road = topo.vertices[spread[0]].edges[0];
    putRoad(s, road, 'p1');
    give(s, 'p0', hand({ ore: 5, wool: 3, grain: 3 }));
    return { s, spread, road, topo };
  }
  const piecesOf = (s: GameState, pid: string) => countPieces(s, pid);

  it('the costs are one table with the three prices, and nothing else in the rules names a price', () => {
    expect(DEMOLISH_COSTS).toEqual({
      road: hand({ ore: 1, wool: 1 }),
      settlement: hand({ ore: 2, wool: 1, grain: 1 }),
      city: hand({ ore: 3, wool: 2, grain: 2 }),
    });
    expect(DEMOLISHES_PER_TURN).toBe(1);
  });

  it('lists exactly what it accepts', () => {
    const { s } = war();
    const acts = legalRoleActions(s, 'p0');
    expect(acts.length).toBeGreaterThan(0);
    for (const a of acts) expect(validate(s, 'p0', a)).toBeNull();
    // 5 ore, 3 wool, 3 grain: everything is affordable; without enough, the list shrinks to what can be paid
    const poor = structuredClone(s);
    poor.players[0].hand = hand({ ore: 1, wool: 1 });
    const lessActs = legalRoleActions(poor, 'p0');
    expect(lessActs.length).toBeGreaterThan(0);
    expect(lessActs.every((a) => a.type === 'roleAction' && (a.params as { kind: string }).kind === 'road')).toBe(true);
    expect(legalRoleActions(poor, 'p0', { ignoreCost: true }).length).toBe(acts.length);
  });

  it('demolishes a road for 1 ore + 1 wool: the road is gone, goes back to its owner\'s stock, the payment goes to the bank', () => {
    let { s, road } = war();
    const before = piecesOf(s, 'p1');
    s = act(s, 'p0', demolish('road', road));
    expect(s.roads[road]).toBeUndefined();
    expect(piecesOf(s, 'p1').road).toBe(before.road - 1);
    expect(s.players[0].hand).toEqual(hand({ ore: 4, wool: 2, grain: 3 }));
    for (const r of RESOURCES) expect(sum(s, r)).toBe(19);
  });

  it('demolishes a settlement (2 ore, 1 wool, 1 grain): it is gone, its owner loses 1 point, the Soldier gains nothing', () => {
    let { s, spread } = war();
    const points = publicPoints(s, 'p0');
    s = act(s, 'p0', demolish('settlement', spread[0]));
    expect(s.buildings[spread[0]]).toBeUndefined();
    expect(s.players[0].hand).toEqual(hand({ ore: 3, wool: 2, grain: 2 }));
    expect(publicPoints(s, 'p1')).toBe(3);
    expect(publicPoints(s, 'p0')).toBe(points);
    expect(piecesOf(s, 'p1').settlement).toBe(1);
    for (const r of RESOURCES) expect(sum(s, r)).toBe(19);
  });

  it('demolishes a city (3 ore, 2 wool, 2 grain): it falls to a settlement, its owner loses 1 point, the city piece goes back to the stock', () => {
    let { s, spread } = war();
    s = act(s, 'p0', demolish('city', spread[2]));
    expect(s.buildings[spread[2]]).toEqual({ owner: 'p1', kind: 'settlement' });
    expect(s.players[0].hand).toEqual(hand({ ore: 2, wool: 1, grain: 1 }));
    expect(publicPoints(s, 'p1')).toBe(3);
    expect(piecesOf(s, 'p1')).toMatchObject({ settlement: 3, city: 0 });
    expect(publicPoints(s, 'p0')).toBe(0);
  });

  it('says what happened as an event: who, whom, what, where, and the price (public data only)', () => {
    const { s, spread } = war();
    const r = applyAction(s, 'p0', demolish('city', spread[2]), mulberry32(3));
    if (!r.ok) throw new Error('refused');
    expect(r.events).toContainEqual({ type: 'demolished', player: 'p0', from: 'p1', kind: 'city', id: spread[2], cost: DEMOLISH_COSTS.city });
  });

  it('the place is free afterwards: another player who is connected there may build on it, and nobody could before', () => {
    let { s, spread, topo } = war();
    // p2 has a road to that corner (a second edge of it, besides p1's)
    const toCorner = topo.vertices[spread[0]].edges.find((e) => s.roads[e] === undefined)!;
    putRoad(s, toCorner, 'p2');
    s.players[0].hand = hand();
    give(s, 'p0', hand({ ore: 2, wool: 1, grain: 1 }));
    give(s, 'p2', hand({ lumber: 1, brick: 1, wool: 1, grain: 1 }));
    const build: Action = { type: 'placeSettlement', vertex: spread[0] };
    s.current = 'p2';
    expect(validate(s, 'p2', build)).toMatchObject({ type: 'occupied' });
    s.current = 'p0';
    s = act(s, 'p0', demolish('settlement', spread[0]));
    s.current = 'p2';
    expect(validate(s, 'p2', build)).toBeNull();
    s = act(s, 'p2', build);
    expect(s.buildings[spread[0]]).toEqual({ owner: 'p2', kind: 'settlement' });
  });

  it('one demolition per turn; the allowance returns next turn', () => {
    let { s, spread, road } = war();
    s.players[0].hand = hand();
    give(s, 'p0', hand({ ore: 10, wool: 6, grain: 6 }));
    s = act(s, 'p0', demolish('road', road));
    expect(validate(s, 'p0', demolish('settlement', spread[0]))).toMatchObject({ type: 'roleActionRefused', reason: 'perTurnLimit' });
    expect(legalRoleActions(s, 'p0')).toEqual([]);
    s = act(s, 'p0', { type: 'endTurn' });
    expect(s.turnFlags.counters).toEqual({});
  });

  it('needs the main phase, a rival\'s piece of that kind, and the money', () => {
    const { s, spread, road } = war();
    const roll = structuredClone(s);
    roll.phase = 'roll';
    expect(validate(roll, 'p0', demolish('road', road))).toMatchObject({ type: 'wrongPhase' });
    expect(validate(s, 'p1', demolish('road', road))).toMatchObject({ type: 'unknownRoleAction' });
    expect(validate(s, 'p0', demolish('settlement', spread[2]))).toMatchObject({ type: 'invalidTarget' }); // that is a city
    expect(validate(s, 'p0', demolish('road', 9999))).toMatchObject({ type: 'invalidTarget' });
    expect(validate(s, 'p0', demolish('castle', 0))).toMatchObject({ type: 'invalidTarget' });
    expect(validate(s, 'p0', { type: 'roleAction', name: 'demolish', params: { kind: 'road' } })).toMatchObject({ type: 'invalidTarget' });
    const broke = structuredClone(s);
    broke.players[0].hand = hand({ ore: 2, wool: 2, grain: 2 });
    expect(validate(broke, 'p0', demolish('city', spread[2]))).toMatchObject({ type: 'cannotAfford', cost: DEMOLISH_COSTS.city });
    // an empty place and the Soldier's own pieces are not targets
    expect(validate(s, 'p0', demolish('road', 41))).toMatchObject({ type: 'invalidTarget' });
    putRoad(s, 40, 'p0');
    expect(validate(s, 'p0', demolish('road', 40))).toMatchObject({ type: 'invalidTarget' });
  });

  it('the Soldier\'s own piece limits do not matter: nothing is built', () => {
    const { s, spread } = war();
    const far = spread.slice(4);
    for (let i = 0; i < 5 && i < far.length; i++) putBuilding(s, far[i], 'p0');
    expect(validate(s, 'p0', demolish('settlement', spread[0]))).toBeNull();
    expect(validate(s, 'p0', demolish('city', spread[2]))).toBeNull();
  });

  describe('the reasons for a refusal are told apart', () => {
    it('protected: a player who was demolished in the last full round, with who and until when', () => {
      let { s, spread, road } = war();
      s.players[0].hand = hand();
      give(s, 'p0', hand({ ore: 10, wool: 6, grain: 6 }));
      s = act(s, 'p0', demolish('settlement', spread[0]));
      expect(s.demolishShield).toEqual({ p1: s.turn + 3 });
      s.current = 'p0';
      s.turnFlags.counters = {};
      // all of p1's pieces are shielded, not only the one that was hit; p2 is not
      expect(validate(s, 'p0', demolish('road', road))).toMatchObject({ type: 'roleActionRefused', reason: 'protected', player: 'p1', until: s.turn + 3 });
      expect(validate(s, 'p0', demolish('city', spread[2]))).toMatchObject({ reason: 'protected', player: 'p1' });
      expect(validate(s, 'p0', demolish('settlement', spread[3]))).not.toMatchObject({ reason: 'protected' });
      // a full round later (every player has played once) the Soldier may hit p1 again
      s.turn += 3;
      expect(validate(s, 'p0', demolish('road', road))).toBeNull();
    });

    it('lastBuilding: a player\'s last settlement or city, with who', () => {
      const { s, spread } = war();
      expect(validate(s, 'p0', demolish('settlement', spread[3]))).toMatchObject({ type: 'roleActionRefused', reason: 'lastBuilding', player: 'p2' });
      // a lone city is just as protected; a player with two buildings may lose either
      const lone = war();
      delete lone.s.buildings[lone.spread[0]];
      delete lone.s.buildings[lone.spread[1]];
      expect(validate(lone.s, 'p0', demolish('city', lone.spread[2]))).toMatchObject({ reason: 'lastBuilding', player: 'p1' });
      putBuilding(lone.s, lone.spread[0], 'p1');
      expect(validate(lone.s, 'p0', demolish('city', lone.spread[2]))).toBeNull();
      // roads are never "last": a player keeps no roads and is still in the game
      expect(validate(s, 'p0', demolish('road', 40))).toMatchObject({ type: 'invalidTarget' });
    });

    it('settlementLimit: a city whose owner has no settlement piece left to fall to (a settlement of theirs can still be demolished)', () => {
      const { s, spread } = war();
      // p1 holds the most settlements the limit allows, besides the city
      const extra = spread.slice(4, 9);
      expect(extra.length).toBe(5);
      delete s.buildings[spread[0]];
      delete s.buildings[spread[1]];
      for (const v of extra) putBuilding(s, v, 'p1');
      expect(countPieces(s, 'p1')).toMatchObject({ settlement: 5, city: 1 });
      expect(validate(s, 'p0', demolish('city', spread[2]))).toMatchObject({ type: 'roleActionRefused', reason: 'settlementLimit', player: 'p1' });
      expect(validate(s, 'p0', demolish('settlement', extra[0]))).toBeNull();
      // one fewer settlement and the city may fall
      delete s.buildings[extra[0]];
      expect(validate(s, 'p0', demolish('city', spread[2]))).toBeNull();
    });

    it('perTurnLimit and cannotAfford are their own errors, not the three above', () => {
      const { s, spread } = war();
      s.turnFlags.counters.demolish = 1;
      expect(validate(s, 'p0', demolish('city', spread[2]))).toMatchObject({ reason: 'perTurnLimit' });
      s.turnFlags.counters = {};
      s.players[0].hand = hand();
      expect(validate(s, 'p0', demolish('city', spread[2]))).toMatchObject({ type: 'cannotAfford' });
    });
  });

  describe('the longest road is worked out again, then the win check runs', () => {
    /** two roads of five, one for each of two players, that do not touch */
    function twoRoads(s: GameState, a: string, b: string) {
      const topo = topologyOf(s.map);
      for (let from = 0; from < topo.vertices.length; from++) {
        const pa = findPath(s, 5, from);
        const verts = new Set(pa.flatMap((e) => [topo.edges[e].a, topo.edges[e].b]));
        for (let other = 0; other < topo.vertices.length; other++) {
          if (verts.has(other)) continue;
          let pb: number[];
          try {
            pb = findPath(s, 5, other);
          } catch {
            continue;
          }
          const touches = pb.some((e) => verts.has(topo.edges[e].a) || verts.has(topo.edges[e].b) || pa.includes(e));
          if (!touches) {
            pa.forEach((e) => putRoad(s, e, a));
            pb.forEach((e) => putRoad(s, e, b));
            return { pa, pb };
          }
        }
      }
      throw new Error('no two separate roads');
    }

    it('cutting the holder\'s road leaves nobody with the longest road', () => {
      let s = mainPhase(2, { roles: ['soldier', 'sage'] });
      s.vpToWin = 99;
      const path = findPath(s, 5);
      path.forEach((e) => putRoad(s, e, 'p1'));
      putBuilding(s, 40, 'p1');
      putBuilding(s, 41, 'p1');
      s.longestRoad = { holder: 'p1', length: 5 };
      give(s, 'p0', hand({ ore: 1, wool: 1 }));
      s = act(s, 'p0', demolish('road', path[2]));
      expect(longestRoadFor(s, 'p1')).toBeLessThan(5);
      expect(s.longestRoad).toEqual({ holder: null, length: 0 });
      expect(publicPoints(s, 'p1')).toBe(2); // the two settlements; the 2 points of the road went
    });

    it('cutting it can hand the longest road to the Soldier, who may win with it', () => {
      let s = mainPhase(2, { roles: ['soldier', 'sage'] });
      s.vpToWin = 2;
      const { pa, pb } = twoRoads(s, 'p0', 'p1');
      putBuilding(s, 40, 'p1');
      putBuilding(s, 41, 'p1');
      s.longestRoad = { holder: 'p1', length: 5 };
      give(s, 'p0', hand({ ore: 1, wool: 1 }));
      expect(pa.length).toBe(5);
      const r = applyAction(s, 'p0', demolish('road', pb[2]), mulberry32(2));
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      expect(r.events).toContainEqual({ type: 'longestRoadChanged', holder: 'p0', length: 5 });
      expect(r.state.longestRoad.holder).toBe('p0');
      expect(r.state.phase).toBe('finished');
      expect(r.state.winner).toBe('p0');
    });

    it('demolishing a building that cut a third player\'s road gives that player the longest road', () => {
      let s = mainPhase(3, { roles: ['soldier', 'sage', 'sailor'] });
      s.vpToWin = 99;
      const topo = topologyOf(s.map);
      const path = findPath(s, 5);
      path.forEach((e) => putRoad(s, e, 'p2'));
      // p1's settlement sits on the middle corner of p2's road, which cuts it in two
      const between = [topo.edges[path[2]].a, topo.edges[path[2]].b].find((v) => topo.edges[path[3]].a === v || topo.edges[path[3]].b === v)!;
      putBuilding(s, between, 'p1');
      const far = vertexAwayFrom(s, [between]);
      putBuilding(s, far, 'p1');
      expect(longestRoadFor(s, 'p2')).toBeLessThan(5);
      give(s, 'p0', hand({ ore: 2, wool: 1, grain: 1 }));
      s = act(s, 'p0', demolish('settlement', between));
      expect(longestRoadFor(s, 'p2')).toBe(5);
      expect(s.longestRoad).toEqual({ holder: 'p2', length: 5 });
    });

    it('a demolition that only takes points from a rival never wins the game for the Soldier', () => {
      let { s, spread } = war();
      s.vpToWin = 1;
      s = act(s, 'p0', demolish('city', spread[2]));
      expect(s.phase).toBe('main');
      expect(s.winner).toBeNull();
    });
  });
});

describe('every role completes basic turns', () => {
  it.each(ROLE_LIST.map((r) => r.id))('%s can start a game and take turns', (role) => {
    const others = ROLE_LIST.map((r) => r.id).filter((r) => r !== role);
    const s = mainPhase(2, { roles: [role, others[0]] });
    const r = applyAction(s, 'p0', { type: 'endTurn' }, mulberry32(1));
    expect(r.ok).toBe(true);
  });
});
