import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLE_LIST, applyAction, createGame, tickTimers, type GameMode, type GameState } from '../src';
import { mulberry32 } from './helpers';
import { chooseWeighted, moves } from '../sim/bot';

/**
 * Regression guard for the team mode: with the team mode off, a seeded bot game must replay exactly as it did before the mode
 * existed. Every state and event list is hashed in a chain. The fields the team mode added (`team`, `teamMode`, `teamTarget`) are
 * left out of the hash, so only a change in the old behaviour breaks it. Refresh the fixture only for a deliberate rule change
 * (UPDATE_GOLDEN=1).
 */
const FILE = fileURLToPath(new URL('./golden.json', import.meta.url));
const TEAM_KEYS = new Set(['team', 'teamMode', 'teamTarget']);
const T0 = 1_700_000_000_000;

function digestGame(seed: number, n: number, mode: GameMode, timed: boolean): string {
  const rng = mulberry32(seed * 104729 + n);
  const roles = ROLE_LIST.map((r) => r.id);
  const created = createGame(
    {
      players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, role: roles[(seed + i) % roles.length] })),
      mode,
      ...(mode === 'custom' ? { targetScore: 8 } : {}),
      ...(timed ? { timer: { turnSeconds: 60, gameSeconds: 1500 } } : {}),
    },
    rng,
    T0,
  );
  if (!created.ok) throw new Error('createGame failed');
  let s: GameState = created.state;
  const h = createHash('sha256');
  const feed = (x: unknown) => h.update(JSON.stringify(x, (k, v) => (TEAM_KEYS.has(k) ? undefined : v)));
  feed(s);
  let now = T0;
  let actions = 0;
  for (let step = 0; step < 3000 && s.phase !== 'finished'; step++) {
    if (timed) {
      now += Math.floor(rng() * 40_000);
      const t = tickTimers(s, rng, now);
      if (t.ok && t.events.length) {
        s = t.state;
        feed([s, t.events]);
        if (s.phase === 'finished') break;
      }
    }
    const ms = moves(s, rng, actions);
    const m = chooseWeighted(ms, rng);
    const r = applyAction(s, m.pid, m.action, rng, now);
    if (!r.ok) throw new Error('listed move refused');
    if (r.state.turn !== s.turn) actions = 0;
    else actions++;
    s = r.state;
    feed([m, s, r.events]);
  }
  return h.digest('hex');
}

const CASES: [number, number, GameMode, boolean][] = [];
for (let n = 2; n <= 5; n++) {
  CASES.push([n, n, 'standard', false], [n + 10, n, 'short', false], [n + 20, n, 'custom', false], [n + 30, n, 'standard', true]);
}

describe('team mode off: games replay exactly as before', () => {
  it('matches the golden digests', () => {
    const got = Object.fromEntries(CASES.map(([seed, n, mode, timed]) => [`${seed}/${n}/${mode}/${timed}`, digestGame(seed, n, mode, timed)]));
    if (process.env.UPDATE_GOLDEN || !existsSync(FILE)) writeFileSync(FILE, JSON.stringify(got, null, 1) + '\n');
    expect(got).toEqual(JSON.parse(readFileSync(FILE, 'utf8')));
  }, 120_000);
});
