import {
  applyAction, createGame, legalMovesFor, viewFor, type GameMode, type GameState, type GameView, type LegalMoves,
} from '@ada/game-core';
import { chooseWeighted, moves } from '../../game-core/sim/bot';
import { mulberry32 } from '../../game-core/sim/rng';

const ROLES = ['soldier', 'sage', 'sailor', 'diplomat', 'harvester'];

export interface Moment {
  state: GameState;
  /** this player's view and options */
  of: (pid: string) => { view: GameView; legal: LegalMoves };
}

const moment = (state: GameState): Moment => ({
  state,
  of: (pid) => ({ view: viewFor(state, pid), legal: legalMovesFor(state, pid) }),
});

/** A fresh game of `n` players, roles in the usual order. */
export function newGame(n: number, mode: GameMode = 'short', seed = 1): GameState {
  const created = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, role: ROLES[i] })), mode }, mulberry32(seed));
  if (!created.ok) throw new Error('createGame');
  return created.state;
}

/**
 * Plays random legal moves, seed after seed, until `wanted` holds for the
 * state; returns that moment. Fails loudly when it never does, so a test
 * cannot pass by quietly not reaching the situation it is about.
 */
export function reach(wanted: (s: GameState) => boolean, opts: { n?: number; mode?: GameMode; seeds?: number } = {}): Moment {
  const n = opts.n ?? 3;
  for (let seed = 1; seed <= (opts.seeds ?? 60); seed++) {
    const rng = mulberry32(seed * 101);
    let s = newGame(n, opts.mode ?? 'short', seed);
    let actions = 0;
    let turn = s.turn;
    for (let step = 0; step < 4000 && s.phase !== 'finished'; step++) {
      if (wanted(s)) return moment(s);
      const m = chooseWeighted(moves(s, rng, actions), rng);
      const r = applyAction(s, m.pid, m.action, rng);
      if (!r.ok) throw new Error('bot move refused');
      s = r.state;
      if (s.turn !== turn) {
        turn = s.turn;
        actions = 0;
      } else actions++;
    }
  }
  throw new Error('the situation was never reached');
}
