import type { Rng } from '@ada/game-core';
import { ROOM_CODE_LENGTH } from '@ada/protocol';

/** Letters that are easy to mix up (I/L, O/Q) are left out. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPRSTUVWXYZ';

export function randomCode(rng: Rng): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return out;
}

/** A code no existing room uses. */
export function freshCode(rng: Rng, taken: (code: string) => boolean, attempts = 50): string {
  for (let i = 0; i < attempts; i++) {
    const c = randomCode(rng);
    if (!taken(c)) return c;
  }
  throw new Error('no free room code');
}

/** Normalises user input to a code, or null when it cannot be one. */
export function parseCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const c = input.trim().toUpperCase();
  return c.length === ROOM_CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}
