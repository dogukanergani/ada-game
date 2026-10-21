import { handCount, longestRoadFor, victoryPoints } from './rules';
import type { GameState, GameView } from './types';

/**
 * The only thing ever sent to a client. Opponents' hands are replaced by a
 * card count; everything else on the table is public.
 */
export function viewFor(state: GameState, playerId: string): GameView {
  return {
    ...state,
    me: playerId,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      role: p.role,
      resources: p.id === playerId ? { ...p.resources } : null,
      cardCount: handCount(p.resources),
      vp: victoryPoints(state, p.id),
      roadLength: longestRoadFor(state, p.id),
    })),
  };
}
