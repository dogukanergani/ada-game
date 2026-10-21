import {
  ROLE_LIST, RESOURCES, applyAction, createGame, legalRoadEdges, legalSettlementVertices, topologyOf,
  type Action, type DevCardKind, type GameMode, type GameState, type Hand, type Resource, type Rng,
} from '../src';

export { mulberry32 } from '../sim/rng';
import { mulberry32 } from '../sim/rng';

/** An rng that first plays back `values`, then continues with a seeded rng. */
export function scripted(values: number[], seed = 1): Rng {
  const rest = mulberry32(seed);
  let i = 0;
  return () => (i < values.length ? values[i++] : rest());
}

/** rng values that make `roll` produce exactly these two dice. */
export const dice = (d1: number, d2: number): number[] => [(d1 - 0.5) / 6, (d2 - 0.5) / 6];

export const hand = (h: Partial<Hand> = {}): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...h });

export function newGame(n: number, opts: { seed?: number; mode?: GameMode; roles?: string[] } = {}): GameState {
  const roleIds = opts.roles ?? ROLE_LIST.map((r) => r.id);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, role: roleIds[i % roleIds.length] }));
  const r = createGame({ players, mode: opts.mode ?? 'standard' }, mulberry32(opts.seed ?? 1));
  if (!r.ok) throw new Error(`createGame failed: ${JSON.stringify(r.error)}`);
  // tests refer to players by id, so fix the seating order to p0, p1, ...
  const st = r.state;
  st.players.sort((a, b) => a.id.localeCompare(b.id));
  st.players.forEach((p, i) => (p.seat = i));
  const ids = st.players.map((p) => p.id);
  st.setup!.order = [...ids, ...[...ids].reverse()];
  st.current = ids[0];
  return st;
}

/** Applies an action that must succeed. */
export function act(s: GameState, pid: string, action: Action, rng: Rng = mulberry32(99)): GameState {
  const r = applyAction(s, pid, action, rng);
  if (!r.ok) throw new Error(`${action.type} refused: ${JSON.stringify(r.error)}`);
  return r.state;
}

export function pickRandom<T>(a: T[], rng: Rng): T {
  return a[Math.floor(rng() * a.length)];
}

/** Plays the snake setup with random legal placements. */
export function autoSetup(s: GameState, rng: Rng = mulberry32(5)): GameState {
  while (s.phase === 'setup') {
    const pid = s.current;
    if (s.setup!.step === 'settlement') s = act(s, pid, { type: 'placeSettlement', vertex: pickRandom(legalSettlementVertices(s, pid), rng) }, rng);
    else s = act(s, pid, { type: 'placeRoad', edge: pickRandom(legalRoadEdges(s, pid), rng) }, rng);
  }
  return s;
}

/** Test-only mutation: moves cards from the bank to a player (keeps conservation). */
export function give(s: GameState, pid: string, h: Partial<Hand>): GameState {
  const p = s.players.find((x) => x.id === pid)!;
  for (const r of RESOURCES) {
    const n = h[r] ?? 0;
    if (s.bank[r] < n) throw new Error('test bank too small');
    s.bank[r] -= n;
    p.hand[r] += n;
  }
  return s;
}

/** Test-only mutation: empties a player's hand into the bank. */
export function clearHand(s: GameState, pid: string): GameState {
  const p = s.players.find((x) => x.id === pid)!;
  for (const r of RESOURCES) {
    s.bank[r] += p.hand[r];
    p.hand[r] = 0;
  }
  return s;
}

export function putBuilding(s: GameState, v: number, owner: string, kind: 'settlement' | 'city' = 'settlement'): GameState {
  s.buildings[v] = { owner, kind };
  return s;
}

export function putRoad(s: GameState, e: number, owner: string): GameState {
  s.roads[e] = owner;
  return s;
}

export function setTile(s: GameState, id: number, kind: Resource | 'desert', number: number | null): GameState {
  s.tiles[id] = { kind, number };
  return s;
}

/** A game in the main phase of p0's turn with nothing built and empty hands. */
export function mainPhase(n = 3, opts: { seed?: number; mode?: GameMode; roles?: string[] } = {}): GameState {
  const s = newGame(n, opts);
  s.phase = 'main';
  s.setup = null;
  s.turn = 1;
  s.current = s.players[0].id;
  return s;
}

/** A simple path of `len` edges (no branching) as edge ids, found on the map. */
export function findPath(s: GameState, len: number, from = 0): number[] {
  const topo = topologyOf(s.map);
  const dfs = (v: number, used: number[], seen: Set<number>): number[] | null => {
    if (used.length === len) return used;
    for (const e of topo.vertices[v].edges) {
      const edge = topo.edges[e];
      const w = edge.a === v ? edge.b : edge.a;
      if (seen.has(w)) continue;
      seen.add(w);
      const r = dfs(w, [...used, e], seen);
      if (r) return r;
      seen.delete(w);
    }
    return null;
  };
  const r = dfs(from, [], new Set([from]));
  if (!r) throw new Error('no path');
  return r;
}

/** Two vertices that are not adjacent and share no neighbour (so both can hold settlements). */
export function farVertices(s: GameState, count: number): number[] {
  const topo = topologyOf(s.map);
  const out: number[] = [];
  for (const v of topo.vertices) {
    if (out.every((o) => o !== v.id && !topo.vertices[o].neighbors.includes(v.id))) out.push(v.id);
    if (out.length === count) return out;
  }
  throw new Error('not enough far vertices');
}

/** A vertex that is not in vs and has no neighbour in vs (a legal settlement spot with respect to them). */
export function vertexAwayFrom(s: GameState, vs: number[]): number {
  const topo = topologyOf(s.map);
  const v = topo.vertices.find((x) => !vs.includes(x.id) && x.neighbors.every((n) => !vs.includes(n)));
  if (!v) throw new Error('no vertex away from');
  return v.id;
}

/** Test-only mutation: moves a card of `kind` from the deck into a player's hand. */
export function giveCard(s: GameState, pid: string, kind: DevCardKind, boughtTurn = 0): GameState {
  const i = s.devDeck.lastIndexOf(kind);
  if (i < 0) throw new Error(`no ${kind} left in the deck`);
  s.devDeck.splice(i, 1);
  s.players.find((p) => p.id === pid)!.devCards.push({ kind, boughtTurn });
  return s;
}

/** Test-only mutation: puts a card of `kind` on top of the deck (the next one bought). */
export function stackDeck(s: GameState, kind: DevCardKind): GameState {
  const i = s.devDeck.indexOf(kind);
  if (i < 0) throw new Error(`no ${kind} left in the deck`);
  s.devDeck.splice(i, 1);
  s.devDeck.push(kind);
  return s;
}
