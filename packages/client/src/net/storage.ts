/**
 * Small persistent storage that never throws: when the browser blocks storage
 * (private mode, policy) or it is full, values live in memory for this visit
 * and the app carries on.
 */
const PREFIX = 'ada.';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function createStorage(backend: () => KeyValueStore | null) {
  const memory = new Map<string, string>();
  const safe = <T>(fn: (s: KeyValueStore) => T): T | undefined => {
    try {
      const s = backend();
      return s ? fn(s) : undefined;
    } catch {
      return undefined; // blocked, or quota exceeded
    }
  };
  return {
    get(key: string): string | null {
      const fromDisk = safe((s) => s.getItem(PREFIX + key));
      return fromDisk ?? memory.get(key) ?? null;
    },
    set(key: string, value: string): void {
      memory.set(key, value);
      safe((s) => s.setItem(PREFIX + key, value));
    },
    remove(key: string): void {
      memory.delete(key);
      safe((s) => s.removeItem(PREFIX + key));
    },
  };
}

/** Forgets who this device is (the player token and the saved name); the language choice stays. */
export function forgetIdentity(store: Pick<ReturnType<typeof createStorage>, 'remove'>): void {
  store.remove('token');
  store.remove('name');
}

export const storage = createStorage(() => (typeof localStorage === 'undefined' ? null : localStorage));
