import { getRandomValues } from 'node:crypto';
import type { Rng } from '@ada/game-core';

/** TEST ONLY (see ServerConfig.testSeed): a reproducible rng. Never used unless NODE_ENV is "test". */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Server-side rng for dice and the development deck: crypto-backed, never Math.random. */
export function cryptoRng(): Rng {
  const pool = new Uint32Array(256);
  let i = pool.length;
  return () => {
    if (i >= pool.length) {
      getRandomValues(pool);
      i = 0;
    }
    return pool[i++] / 4294967296;
  };
}
