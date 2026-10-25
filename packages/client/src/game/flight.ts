import { topologyOf, type GameView, type Hand, type Resource } from '@ada/game-core';

/**
 * Where a roll's production came from, for the flight of the cards from the tiles to the seats.
 * Only a picture: what each player received is the server's (`gains`), and these flights never
 * exceed it. Everything used here is public: the board, who owns which building, the numbers.
 */
export interface Flight {
  player: string;
  tile: number;
  resource: Resource;
  /** how many cards fly from this tile to this player */
  count: number;
}

/**
 * A building on a corner of a hit tile asks for 1 card (a settlement) or 2 (a city) of the tile's
 * resource, as in the core's production. The bank may have been short, so for each player and
 * resource the flights are cut down to what the server says the player received.
 */
export function flightsFor(view: Pick<GameView, 'map' | 'tiles' | 'buildings'>, hitTiles: number[], gains: Record<string, Hand>): Flight[] {
  const topo = topologyOf(view.map);
  const left: Record<string, Hand> = {};
  for (const [id, h] of Object.entries(gains)) left[id] = { ...h };
  const out: Flight[] = [];
  for (const tile of [...hitTiles].sort((a, b) => a - b)) {
    const kind = view.tiles[tile].kind;
    if (kind === 'desert') continue;
    const resource: Resource = kind;
    const asked = new Map<string, number>();
    for (const v of topo.tiles[tile].corners) {
      const b = view.buildings[v];
      if (b) asked.set(b.owner, (asked.get(b.owner) ?? 0) + (b.kind === 'city' ? 2 : 1));
    }
    for (const [player, n] of asked) {
      const have = left[player]?.[resource] ?? 0;
      const count = Math.min(n, have);
      if (count <= 0) continue;
      left[player][resource] -= count;
      out.push({ player, tile, resource, count });
    }
  }
  return out;
}

