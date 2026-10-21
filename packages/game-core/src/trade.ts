import { BASE_BANK_RATIO, GENERIC_PORT_RATIO, MIN_BANK_RATIO, SPECIFIC_PORT_RATIO } from './constants';
import { roleOf } from './roles/registry';
import { topoOf } from './state';
import type { GameState, Resource } from './types';

/** Ratio from the player's harbors alone: 4, or 3 with a generic harbor, or 2 with that resource's harbor. */
export function portRatio(s: GameState, pid: string, give: Resource): number {
  const topo = topoOf(s);
  let best = BASE_BANK_RATIO;
  for (const h of s.harbors) {
    const e = topo.edges[h.edge];
    const mine = [e.a, e.b].some((v) => s.buildings[v]?.owner === pid);
    if (!mine) continue;
    if (h.type === 'any') best = Math.min(best, GENERIC_PORT_RATIO);
    else if (h.type === give) best = Math.min(best, SPECIFIC_PORT_RATIO);
  }
  return best;
}

/** Bank ratio for a player: best harbor, then the role hook, never below the global floor. */
export function bankRatioFor(s: GameState, pid: string, give: Resource): number {
  const ratio = portRatio(s, pid, give);
  const adjusted = roleOf(s, pid).bankRatio?.(ratio, give) ?? ratio;
  return Math.max(MIN_BANK_RATIO, adjusted);
}
