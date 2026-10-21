import { afterAll, expect, it } from 'vitest';
import { mulberry32 } from '../../game-core/sim/rng';
import { assertNoLeak, playOut, setup, type Inspection } from './gameplay';

/**
 * Secret-information sweep. The server's rng is injected (seeded), so every
 * game is reproducible from its seed; the bots play from the same seed.
 */
const serverRng = (seed: number) => mulberry32(seed * 31 + 1);
const playersFor = (seed: number) => 2 + (seed % 4);

export async function game(seed: number, inspect?: (i: Inspection) => void) {
  const n = playersFor(seed);
  const { server, players, code } = await setup(n, 'short', serverRng(seed));
  await players[0].emit('lobby:start');
  for (const p of players) await p.until('game:snapshot');
  const result = await playOut(server, code, players, seed, { inspect });
  for (const p of players) p.socket.close();
  await server.close();
  return result;
}

/** Registers a test that plays seeds [from, from + count) and leak-checks every message of every game. */
export function leakSweep(from: number, count: number) {
  let exhausted = 0;
  let finished = 0;
  it(`seeds ${from}-${from + count - 1}: no secret leaves the server`, async () => {
    for (let seed = from; seed < from + count; seed++) {
      const r = await game(seed, (i) => {
        assertNoLeak(i);
        if (i.after.devDeck.length === 0) exhausted++;
      });
      expect(r.final.phase, `seed ${seed} did not finish`).toBe('finished');
      finished++;
    }
  }, 900_000);
  afterAll(() => {
    // the sweep must have run decks empty (the case the old check got wrong) and finished every game
    expect(exhausted, 'no game ran the deck empty').toBeGreaterThan(0);
    expect(finished).toBe(count);
  });
}
