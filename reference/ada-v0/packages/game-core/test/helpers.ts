import {
  applyAction, createGame, legalRoadEdges, legalSettlementVertices,
  type Action, type GameState, type RoleId, type Rng,
} from '../src';

/** Deterministic PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG that yields the given dice faces first, then falls back to a seeded stream. */
export function rigged(faces: number[], seed = 1): Rng {
  const rest = mulberry32(seed);
  let i = 0;
  return () => (i < faces.length ? (faces[i++] - 1 + 0.5) / 6 : rest());
}

export const ROLE_SET: RoleId[] = ['merchant', 'architect', 'farmer', 'miner'];

export function newGame(n = 3, seed = 7, roles: RoleId[] = ROLE_SET): GameState {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Oyuncu${i}`, role: roles[i % roles.length] }));
  return createGame(players, mulberry32(seed));
}

export function act(s: GameState, pid: string, a: Action, rng: Rng = mulberry32(99)): GameState {
  const r = applyAction(s, pid, a, rng);
  if (!r.ok) throw new Error(`${a.type} failed: ${r.error}`);
  return r.state;
}

/** Plays the whole setup phase by always taking the first legal spot. */
export function autoSetup(s: GameState): GameState {
  while (s.phase === 'setup') {
    const pid = s.current;
    if (s.setup!.step === 'settlement') {
      s = act(s, pid, { type: 'placeSettlement', vertex: legalSettlementVertices(s, pid)[0] });
    } else {
      s = act(s, pid, { type: 'placeRoad', edge: legalRoadEdges(s, pid)[0] });
    }
  }
  return s;
}
