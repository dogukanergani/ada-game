import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RESOURCES, ROLE_LIST, applyAction, bankRatioFor, createGame, legalRoleActions, longestRoadFor, publicPoints, topologyOf, validate,
  type Action, type GameState,
} from '../src';
import { act, dice, findPath, give, hand, mainPhase, mulberry32, putBuilding, putRoad, scripted, setTile } from './helpers';

const sum = (s: GameState, r: (typeof RESOURCES)[number]) => s.bank[r] + s.players.reduce((a, p) => a + p.hand[r], 0);
const capture = (kind: string, id: number): Action => ({ type: 'roleAction', name: 'capture', params: { kind, id } });

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
    expect(validate(s, 'p0', capture('road', 0))).toMatchObject({ type: 'unknownRoleAction' });
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

describe('soldier: capture', () => {
  function war(opts: { cityLimit?: boolean } = {}) {
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

  it('lists exactly what it accepts', () => {
    const { s } = war();
    const acts = legalRoleActions(s, 'p0');
    expect(acts.length).toBeGreaterThan(0);
    for (const a of acts) expect(validate(s, 'p0', a)).toBeNull();
    // 5 ore, 3 wool, 3 grain: everything is affordable once; without resources the list shrinks
    const poor = structuredClone(s);
    poor.players[0].hand = hand({ ore: 2, wool: 2 });
    const lessActs = legalRoleActions(poor, 'p0');
    expect(lessActs.every((a) => a.type === 'roleAction' && (a.params as { kind: string }).kind === 'road')).toBe(true);
    expect(legalRoleActions(poor, 'p0', { ignoreCost: true }).length).toBe(acts.length);
  });

  it('captures a road for 2 ore + 2 wool and the road changes owner', () => {
    let { s, road } = war();
    s = act(s, 'p0', capture('road', road));
    expect(s.roads[road]).toBe('p0');
    expect(s.players[0].hand).toEqual(hand({ ore: 3, wool: 1, grain: 3 }));
    for (const r of RESOURCES) expect(sum(s, r)).toBe(19);
  });

  it('captures a settlement (3 ore, 2 wool, 2 grain): 1 point moves', () => {
    let { s, spread } = war();
    s = act(s, 'p0', capture('settlement', spread[0]));
    expect(s.buildings[spread[0]]).toEqual({ owner: 'p0', kind: 'settlement' });
    expect(s.players[0].hand).toEqual(hand({ ore: 2, wool: 1, grain: 1 }));
    expect(publicPoints(s, 'p0')).toBe(1);
    expect(publicPoints(s, 'p1')).toBe(3);
  });

  it('captures a city (5 ore, 3 wool, 3 grain): 2 points move, it stays a city', () => {
    let { s, spread } = war();
    s = act(s, 'p0', capture('city', spread[2]));
    expect(s.buildings[spread[2]]).toEqual({ owner: 'p0', kind: 'city' });
    expect(s.players[0].hand).toEqual(hand());
    expect(publicPoints(s, 'p0')).toBe(2);
  });

  it('one capture per turn; the allowance returns next turn', () => {
    let { s, spread, road } = war();
    s.players[0].hand = hand();
    give(s, 'p0', hand({ ore: 10, wool: 6, grain: 6 }));
    s = act(s, 'p0', capture('road', road));
    expect(validate(s, 'p0', capture('settlement', spread[0]))).toMatchObject({ type: 'roleActionRefused', reason: 'perTurnLimit' });
    expect(legalRoleActions(s, 'p0')).toEqual([]);
    s = act(s, 'p0', { type: 'endTurn' });
    expect(s.turnFlags.counters).toEqual({});
  });

  it('needs the main phase, the right target and the money', () => {
    const { s, spread, road } = war();
    const roll = structuredClone(s);
    roll.phase = 'roll';
    expect(validate(roll, 'p0', capture('road', road))).toMatchObject({ type: 'wrongPhase' });
    expect(validate(s, 'p1', capture('road', road))).toMatchObject({ type: 'unknownRoleAction' });
    expect(validate(s, 'p0', capture('settlement', spread[2]))).toMatchObject({ type: 'invalidTarget' }); // that is a city
    expect(validate(s, 'p0', capture('road', 9999))).toMatchObject({ type: 'invalidTarget' });
    expect(validate(s, 'p0', capture('castle', 0))).toMatchObject({ type: 'invalidTarget' });
    expect(validate(s, 'p0', { type: 'roleAction', name: 'capture', params: { kind: 'road' } })).toMatchObject({ type: 'invalidTarget' });
    const broke = structuredClone(s);
    broke.players[0].hand = hand({ ore: 4, wool: 3, grain: 3 });
    expect(validate(broke, 'p0', capture('city', spread[2]))).toMatchObject({ type: 'cannotAfford' });
    // own pieces cannot be captured
    putRoad(s, 40, 'p0');
    expect(validate(s, 'p0', capture('road', 40))).toMatchObject({ type: 'invalidTarget' });
  });

  it('respects the soldier\'s own piece limits', () => {
    const { s, spread } = war();
    const far = spread.slice(4); // independent of the four used by war()
    expect(far.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 5; i++) putBuilding(s, far[i], 'p0');
    expect(validate(s, 'p0', capture('settlement', spread[0]))).toMatchObject({ type: 'pieceLimit', piece: 'settlement' });
    expect(validate(s, 'p0', capture('city', spread[2]))).toBeNull();
    for (let i = 0; i < 4; i++) { s.buildings[far[i]].kind = 'city'; }
    expect(validate(s, 'p0', capture('city', spread[2]))).toMatchObject({ type: 'pieceLimit', piece: 'city' });
    const roadsFull = war();
    findPath(roadsFull.s, 15, 10).forEach((e) => { if (roadsFull.s.roads[e] === undefined) putRoad(roadsFull.s, e, 'p0'); });
    const mine = Object.values(roadsFull.s.roads).filter((o) => o === 'p0').length;
    if (mine >= 15) expect(validate(roadsFull.s, 'p0', capture('road', roadsFull.road))).toMatchObject({ type: 'pieceLimit', piece: 'road' });
  });

  it('a captured piece is protected for a full round', () => {
    let { s, spread } = war();
    s.players[0].hand = hand();
    give(s, 'p0', hand({ ore: 10, wool: 6, grain: 6 }));
    s = act(s, 'p0', capture('settlement', spread[0]));
    expect(s.protectedUntil.buildings[spread[0]]).toBe(s.turn + 3);
    s.current = 'p0';
    s.turnFlags.counters = {};
    // swap owner back to simulate a rival taking it, then try to capture it again within the round
    s.buildings[spread[0]].owner = 'p1';
    expect(validate(s, 'p0', capture('settlement', spread[0]))).toMatchObject({ type: 'roleActionRefused', reason: 'protected' });
    s.turn += 3;
    expect(validate(s, 'p0', capture('settlement', spread[0]))).toBeNull();
  });

  it('never takes a player\'s last settlement or city', () => {
    const { s, spread } = war();
    expect(validate(s, 'p0', capture('settlement', spread[3]))).toMatchObject({ type: 'roleActionRefused', reason: 'lastBuilding' });
  });

  it('recomputes the longest road when a road is captured', () => {
    let s = mainPhase(2, { roles: ['soldier', 'sage'] });
    s.vpToWin = 99;
    const topo = topologyOf(s.map);
    const path = findPath(s, 5);
    path.forEach((e) => putRoad(s, e, 'p1'));
    putBuilding(s, 40, 'p1');
    putBuilding(s, 41, 'p1');
    s.longestRoad = { holder: 'p1', length: 5 };
    give(s, 'p0', hand({ ore: 2, wool: 2 }));
    s = act(s, 'p0', capture('road', path[2]));
    expect(longestRoadFor(s, 'p1')).toBeLessThan(5);
    expect(s.longestRoad.holder).toBeNull();
    expect(topo.edges.length).toBeGreaterThan(0);
  });

  it('can win the game: points are checked after the capture', () => {
    let { s, spread } = war();
    s.vpToWin = 2;
    s = act(s, 'p0', capture('city', spread[2]));
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('p0');
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
