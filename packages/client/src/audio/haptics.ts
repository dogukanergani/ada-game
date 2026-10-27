import type { PrefsStore } from './preferences';

type Nav = { vibrate?: (p: number) => boolean };

/** the vibration API is there (Android Chrome yes, iOS Safari no) */
export const canVibrate = (nav: Nav | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean => typeof nav?.vibrate === 'function';

export const TAP_MS = 30;

/** a short buzz for a move confirmed by touch, only when the player turned vibration on */
export function createHaptics(prefs: PrefsStore, nav: Nav | undefined = typeof navigator === 'undefined' ? undefined : navigator) {
  return {
    tap(): void {
      if (!prefs.get().vibrate || !canVibrate(nav)) return;
      try {
        nav!.vibrate!(TAP_MS);
      } catch {
        /* ignore */
      }
    },
  };
}
