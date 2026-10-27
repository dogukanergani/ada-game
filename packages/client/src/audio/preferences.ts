import type { createStorage } from '../net/storage';

/** The device's sound and haptics choices. Each one is stored on its own, through the same memory-backed storage as everything else. */
export interface Prefs {
  /** sound effects on or off */
  sfx: boolean;
  /** 0..100 */
  volume: number;
  vibrate: boolean;
}

/** sound on (GDD), a middling level; vibration off until the player turns it on (see DECISIONS) */
export const DEFAULT_PREFS: Prefs = { sfx: true, volume: 60, vibrate: false };

type Store = Pick<ReturnType<typeof createStorage>, 'get' | 'set'>;

export const clampVolume = (v: number): number => (Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : DEFAULT_PREFS.volume);

function readBool(store: Store, key: string, fallback: boolean): boolean {
  const v = store.get(key);
  return v === '1' ? true : v === '0' ? false : fallback;
}

export function loadPrefs(store: Store): Prefs {
  const raw = store.get('volume');
  const volume = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return {
    sfx: readBool(store, 'sfx', DEFAULT_PREFS.sfx),
    volume: clampVolume(volume),
    vibrate: readBool(store, 'vibrate', DEFAULT_PREFS.vibrate),
  };
}

/** The current choices with change notification (for `useSyncExternalStore`). `get` returns the same object until something changes. */
export function createPrefs(store: Store) {
  let current = loadPrefs(store);
  const listeners = new Set<() => void>();
  return {
    get: (): Prefs => current,
    set(patch: Partial<Prefs>): void {
      const next = { ...current, ...patch };
      next.volume = clampVolume(next.volume);
      if (patch.sfx !== undefined) store.set('sfx', next.sfx ? '1' : '0');
      if (patch.volume !== undefined) store.set('volume', String(next.volume));
      if (patch.vibrate !== undefined) store.set('vibrate', next.vibrate ? '1' : '0');
      current = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

export type PrefsStore = ReturnType<typeof createPrefs>;
