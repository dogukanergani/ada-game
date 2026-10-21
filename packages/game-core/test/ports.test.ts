import { describe, expect, it } from 'vitest';
import { RESOURCES, bankRatioFor, legalBankTrades, portRatio, topologyOf, validate } from '../src';
import { act, give, hand, mainPhase, newGame, putBuilding } from './helpers';

const sum = (s: ReturnType<typeof mainPhase>, r: (typeof RESOURCES)[number]) =>
  s.bank[r] + s.players.reduce((a, p) => a + p.hand[r], 0);

describe('harbors on the generated board', () => {
  it('9 of the 30 coastal edges, 4 generic and 5 specific (one per resource)', () => {
    const s = newGame(3);
    const topo = topologyOf(s.map);
    expect(s.harbors).toHaveLength(9);
    for (const h of s.harbors) expect(topo.coastEdges).toContain(h.edge);
    expect(s.harbors.filter((h) => h.type === 'any')).toHaveLength(4);
    expect(s.harbors.filter((h) => h.type !== 'any').map((h) => h.type).sort()).toEqual(['brick', 'grain', 'lumber', 'ore', 'wool']);
  });

  it('harbor types differ between seeds', () => {
    const seen = new Set(Array.from({ length: 6 }, (_, i) => newGame(3, { seed: i + 1 }).harbors.map((h) => h.type).join()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('bank ratio', () => {
  function setup(types: ('any' | 'ore' | 'wool' | 'lumber')[]) {
    const s = mainPhase(2);
    const topo = topologyOf(s.map);
    s.harbors = s.harbors.slice(0, types.length).map((h, i) => ({ edge: h.edge, type: types[i] }));
    return { s, topo };
  }

  it('is 4 without a harbor', () => {
    const { s } = setup(['any']);
    for (const r of RESOURCES) expect(portRatio(s, 'p0', r)).toBe(4);
    expect(bankRatioFor(s, 'p0', 'ore')).toBe(4);
  });

  it('a generic harbor gives 3 for everything, via either end of its edge, settlement or city', () => {
    const { s, topo } = setup(['any']);
    const e = topo.edges[s.harbors[0].edge];
    putBuilding(s, e.b, 'p0', 'city');
    for (const r of RESOURCES) expect(bankRatioFor(s, 'p0', r)).toBe(3);
    expect(bankRatioFor(s, 'p1', 'ore')).toBe(4);
  });

  it('a specific harbor gives 2 only for its resource', () => {
    const { s, topo } = setup(['ore']);
    putBuilding(s, topo.edges[s.harbors[0].edge].a, 'p0');
    expect(bankRatioFor(s, 'p0', 'ore')).toBe(2);
    expect(bankRatioFor(s, 'p0', 'wool')).toBe(4);
  });

  it('the best of several harbors applies', () => {
    const { s, topo } = setup(['any', 'ore']);
    putBuilding(s, topo.edges[s.harbors[0].edge].a, 'p0');
    putBuilding(s, topo.edges[s.harbors[1].edge].a, 'p0');
    expect(bankRatioFor(s, 'p0', 'ore')).toBe(2);
    expect(bankRatioFor(s, 'p0', 'grain')).toBe(3);
  });

  it('a harbor next to someone else\'s building does nothing for you', () => {
    const { s, topo } = setup(['ore']);
    putBuilding(s, topo.edges[s.harbors[0].edge].a, 'p1');
    expect(bankRatioFor(s, 'p0', 'ore')).toBe(4);
  });
});

describe('bank trade', () => {
  it('pays the ratio into the bank and takes one card out; stock is conserved', () => {
    let s = mainPhase(2);
    give(s, 'p0', hand({ lumber: 4 }));
    s = act(s, 'p0', { type: 'bankTrade', give: 'lumber', get: 'ore' });
    expect(s.players[0].hand).toEqual(hand({ ore: 1 }));
    for (const r of RESOURCES) expect(sum(s, r)).toBe(19);
  });

  it('needs enough cards, a different resource and a bank that has the card', () => {
    const s = mainPhase(2);
    give(s, 'p0', hand({ lumber: 3 }));
    expect(validate(s, 'p0', { type: 'bankTrade', give: 'lumber', get: 'ore' })).toMatchObject({ type: 'cannotAfford', ratio: 4 });
    give(s, 'p0', hand({ lumber: 1 }));
    expect(validate(s, 'p0', { type: 'bankTrade', give: 'lumber', get: 'lumber' })).toMatchObject({ type: 'invalidTrade' });
    s.bank.ore = 0;
    expect(validate(s, 'p0', { type: 'bankTrade', give: 'lumber', get: 'ore' })).toMatchObject({ type: 'bankLacks', resource: 'ore' });
    expect(validate(s, 'p0', { type: 'bankTrade', give: 'lumber', get: 'wool' })).toBeNull();
  });

  it('the legal trade list matches the validator', () => {
    const s = mainPhase(2);
    give(s, 'p0', hand({ lumber: 4, ore: 4 }));
    s.bank.brick = 0;
    const legal = legalBankTrades(s, 'p0');
    expect(legal).toHaveLength(6); // lumber and ore each to 3 resources that the bank still has
    expect(legal.some((t) => t.get === 'brick')).toBe(false);
    for (const t of legal) expect(validate(s, 'p0', { type: 'bankTrade', ...t })).toBeNull();
  });

  it('uses the harbor ratio', () => {
    let s = mainPhase(2);
    const topo = topologyOf(s.map);
    s.harbors[0] = { edge: s.harbors[0].edge, type: 'wool' };
    putBuilding(s, topo.edges[s.harbors[0].edge].a, 'p0');
    give(s, 'p0', hand({ wool: 2 }));
    s = act(s, 'p0', { type: 'bankTrade', give: 'wool', get: 'grain' });
    expect(s.players[0].hand).toEqual(hand({ grain: 1 }));
  });
});
