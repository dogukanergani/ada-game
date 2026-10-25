import { describe, expect, it } from 'vitest';
import { RESOURCES, topologyOf, viewFor, type Hand } from '@ada/game-core';
import { flightsFor } from '../src/game/flight';
import { newGame } from './fixtures';

const hand = (h: Partial<Hand>): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...h });

/** a game in which p0 has a settlement and p1 a city on two corners of one producing tile, and nothing else is built */
function setup() {
  const s = newGame(2);
  s.buildings = {};
  const tile = s.tiles.findIndex((t) => t.kind !== 'desert');
  const [a, b] = topologyOf(s.map).tiles[tile].corners;
  s.buildings[a] = { owner: 'p0', kind: 'settlement' };
  s.buildings[b] = { owner: 'p1', kind: 'city' };
  const resource = s.tiles[tile].kind as keyof Hand;
  return { view: viewFor(s, 'p0'), tile, resource };
}

describe('flightsFor: where the cards of a roll come from', () => {
  it('a settlement sends 1 card and a city 2, from the tile that produced them, to their owners', () => {
    const { view, tile, resource } = setup();
    const gains = { p0: hand({ [resource]: 1 }), p1: hand({ [resource]: 2 }) };
    const flights = flightsFor(view, [tile], gains);
    expect(flights).toHaveLength(2);
    expect(flights.find((f) => f.player === 'p0')).toEqual({ player: 'p0', tile, resource, count: 1 });
    expect(flights.find((f) => f.player === 'p1')).toEqual({ player: 'p1', tile, resource, count: 2 });
  });

  it('never sends more than the server says the player received (a short bank), and nothing for a player who got nothing', () => {
    const { view, tile, resource } = setup();
    const flights = flightsFor(view, [tile], { p0: hand({}), p1: hand({ [resource]: 1 }) });
    expect(flights).toEqual([{ player: 'p1', tile, resource, count: 1 }]);
    expect(flightsFor(view, [tile], {})).toEqual([]);
  });

  it('a tile that did not hit sends nothing, and a role bonus (more in gains than the tiles gave) is not drawn', () => {
    const { view, tile, resource } = setup();
    expect(flightsFor(view, [], { p0: hand({ [resource]: 1 }) })).toEqual([]);
    const flights = flightsFor(view, [tile], { p0: hand({ [resource]: 5 }), p1: hand({ [resource]: 5 }) });
    expect(flights.reduce((n, f) => n + f.count, 0)).toBe(3);
    for (const r of RESOURCES) if (r !== resource) expect(flights.every((f) => f.resource !== r)).toBe(true);
  });
});
