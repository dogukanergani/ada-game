import { useSyncExternalStore } from 'react';
import { storage } from '../net/storage';
import { createAudio, type AudioCtx } from './engine';
import { createHaptics } from './haptics';
import { createPrefs, type Prefs } from './preferences';

export const prefs = createPrefs(storage);

export const audio = createAudio({
  create: () => {
    const Ctor = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    return Ctor ? (new Ctor() as unknown as AudioCtx) : null;
  },
  prefs,
  isHidden: () => typeof document !== 'undefined' && document.hidden,
});

export const haptics = createHaptics(prefs);

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
}

/** Whether motion is on: the player's own choice in Settings (on by default), independent of the system's reduced-motion setting. */
export function useAnimationsEnabled(): boolean {
  return usePrefs().animations;
}

/** Mirrors the choice onto <html data-motion="off"> so the stylesheet can switch every animation and transition off. */
export function applyMotionAttribute(on: boolean, root: Pick<HTMLElement, 'removeAttribute' | 'setAttribute'> = document.documentElement): void {
  if (on) root.removeAttribute('data-motion');
  else root.setAttribute('data-motion', 'off');
}

/** The first tap or key press unlocks the audio context (a browser refuses sound before that). Taps while the effects are off don't make one. */
export function installUnlock(target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document, a: Pick<typeof audio, 'unlock'> = audio): () => void {
  const events = ['pointerdown', 'keydown'] as const;
  const on = () => a.unlock();
  for (const e of events) target.addEventListener(e, on, true);
  return () => events.forEach((e) => target.removeEventListener(e, on, true));
}
