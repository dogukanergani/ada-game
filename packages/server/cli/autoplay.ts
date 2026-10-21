import type { Action, GameView, LegalMoves, Rng } from '@ada/game-core';
import type { Ack } from '@ada/protocol';
import { fallbackAction, greedyAction, seeOfView } from '../../game-core/sim/greedy';

/** Anything that can send an event and wait for its ack (a socket wrapper, or a test client). */
export interface Sender {
  emit(event: string, payload?: unknown): Promise<Ack<Record<string, unknown>>>;
}

export type AutoResult = { kind: 'idle' } | { kind: 'acted'; action: Action } | { kind: 'refused'; action: Action; error: unknown };

/**
 * One autoplay step for the player behind `sender`: ask the server what is
 * legal, let the greedy bot choose (or the forced fallback), and send it.
 * Idle when it is not this player's moment to act.
 */
export async function autoStep(sender: Sender, view: GameView, rng: Rng): Promise<AutoResult> {
  if (view.phase === 'finished' || !view.mine) return { kind: 'idle' };
  const asked = await sender.emit('game:legal', {});
  if (!asked.ok) return { kind: 'idle' };
  const legal = asked.legal as LegalMoves;
  const see = seeOfView(view);
  const action = greedyAction(see, legal, rng) ?? fallbackAction(see, legal, rng);
  if (!action) return { kind: 'idle' };
  const r = await sender.emit('game:action', action);
  return r.ok ? { kind: 'acted', action } : { kind: 'refused', action, error: r.error };
}
