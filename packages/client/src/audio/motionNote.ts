import type { createStorage } from '../net/storage';

type Store = Pick<ReturnType<typeof createStorage>, 'get'>;

/**
 * The one place that asks the system about reduced motion, and only to decide whether to *mention* the Settings switch.
 * It never turns anything off by itself (GDD v0.9).
 */
export function systemReducesMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A single, dismissible note: the system asks for less motion, the player has chosen nothing yet and has not closed the note before. */
export function shouldShowMotionNote(store: Store, systemReduces: boolean): boolean {
  return systemReduces && store.get('animations') === null && store.get('motionNote') === null;
}
