import { describe, expect, it } from 'vitest';
import {
  CLASSIC_19, LARGE_30, MAPS, SHORT_14, bankStockFor, generateHarbors, generateTiles, mapFor, topologyOf, validateMap,
} from '../src';
import { mulberry32 } from './helpers';

const allMaps = [CLASSIC_19, LARGE_30, SHORT_14];

describe('map data', () => {
  it.each(allMaps)('$id is a valid map definition', (m) => {
    expect(validateMap(m)).toEqual([]);
  });

  it('classic board has the documented geometry', () => {
    const t = topologyOf(CLASSIC_19);
    expect(t.tiles).toHaveLength(19);
    expect(t.vertices).toHaveLength(54);
    expect(t.edges).toHaveLength(72);
    expect(t.coastEdges).toHaveLength(30);
  });

  it('tile counts of the other maps', () => {
    expect(LARGE_30.tiles).toHaveLength(30);
    expect(SHORT_14.tiles).toHaveLength(14);
    expect(LARGE_30.harborSlots).toHaveLength(11);
    expect(SHORT_14.harborSlots).toHaveLength(7);
    expect(CLASSIC_19.harborSlots).toHaveLength(9);
  });

  it('vertex and edge ids are deterministic across fresh builds', () => {
    const copy = structuredClone(CLASSIC_19);
    copy.id = 'copy';
    const a = topologyOf(CLASSIC_19);
    const b = topologyOf({ ...copy, tiles: copy.tiles.map((t) => ({ ...t })) });
    expect(b.vertices.map((v) => [v.x, v.y])).toEqual(a.vertices.map((v) => [v.x, v.y]));
    expect(b.edges.map((e) => [e.a, e.b])).toEqual(a.edges.map((e) => [e.a, e.b]));
  });

  it('harbors never share a vertex', () => {
    for (const m of allMaps) {
      const topo = topologyOf(m);
      const harbors = generateHarbors(m, mulberry32(1));
      const vs = harbors.flatMap((h) => [topo.edges[h.edge].a, topo.edges[h.edge].b]);
      expect(new Set(vs).size).toBe(vs.length);
    }
  });

  it('rejects broken map data', () => {
    expect(validateMap({ ...CLASSIC_19, numbers: [2, 3] })).toContain('numberCountMismatch');
    expect(validateMap({ ...CLASSIC_19, harborSlots: [{ tile: 9, side: 0 }], harborPool: ['any'] })).toContain('harborNotOnCoast');
  });
});

describe('board generation', () => {
  it.each(allMaps)('$id: terrain/number counts, desert robber, no adjacent 6/8 over 300 seeds', (m) => {
    const topo = topologyOf(m);
    for (let seed = 1; seed <= 300; seed++) {
      const { tiles, robber } = generateTiles(m, mulberry32(seed));
      expect(tiles).toHaveLength(m.tiles.length);
      if (tiles[robber].kind !== 'desert') throw new Error('robber not on desert');
      if (tiles.findIndex((t) => t.kind === 'desert') !== robber) throw new Error('robber not on first desert');
      const nums = tiles.filter((t) => t.number !== null).map((t) => t.number as number);
      expect([...nums].sort((a, b) => a - b)).toEqual([...m.numbers].sort((a, b) => a - b));
      for (const [i, t] of tiles.entries()) {
        if ((t.number === 6 || t.number === 8) && topo.tiles[i].neighbors.some((n) => [6, 8].includes(tiles[n].number ?? 0))) {
          throw new Error(`adjacent hot numbers, seed ${seed}`);
        }
      }
    }
  });

  it('same seed gives the same board', () => {
    expect(generateTiles(CLASSIC_19, mulberry32(5))).toEqual(generateTiles(CLASSIC_19, mulberry32(5)));
  });

  it('harbor types are a shuffle of the pool', () => {
    const h = generateHarbors(CLASSIC_19, mulberry32(3));
    expect(h.filter((x) => x.type === 'any')).toHaveLength(4);
    expect(h.filter((x) => x.type !== 'any').map((x) => x.type).sort()).toEqual(['brick', 'grain', 'lumber', 'ore', 'wool']);
  });
});

describe('map choice and bank stock', () => {
  it('picks a map by mode and player count', () => {
    expect(mapFor('standard', 2).id).toBe('classic19');
    expect(mapFor('standard', 4).id).toBe('classic19');
    expect(mapFor('standard', 5).id).toBe('large30');
    expect(mapFor('short', 3).id).toBe('short14');
    expect(mapFor('short', 5).id).toBe('classic19');
    expect(Object.keys(MAPS)).toHaveLength(3);
  });

  it('bank stock depends on mode and player count', () => {
    expect(bankStockFor('standard', 3)).toBe(19);
    expect(bankStockFor('standard', 5)).toBe(24);
    expect(bankStockFor('short', 2)).toBe(14);
    expect(bankStockFor('short', 5)).toBe(19);
  });
});
