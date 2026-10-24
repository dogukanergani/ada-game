/** The timed mode's countdowns as shown: the server's figure for what is left, minus the time since it arrived. */
export interface ServerTimerClock {
  turnRemainingMs: number | null;
  gameRemainingMs: number;
  /** monotonic ms (performance.now) at which the server's figures arrived */
  at: number;
}

/** In the last seconds of a turn the countdown turns urgent. */
export const URGENT_MS = 10_000;

/** What is left of a figure the server gave at `clock.at`, at monotonic time `nowMs`; never below 0. Only a duration comes from this device. */
export function remainingMs(baseMs: number, clock: Pick<ServerTimerClock, 'at'>, nowMs: number): number {
  return Math.max(0, baseMs - Math.max(0, nowMs - clock.at));
}

/** "1:05": the seconds are rounded up, so the display reaches 0:00 only when the time is really out. */
export function mmss(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The turn countdown is urgent in its last 10 seconds (and at 0 until the server moves the game on). */
export const isUrgent = (ms: number): boolean => ms <= URGENT_MS;

/** Whole minutes left, rounded up (0 only when nothing is left). */
export const minutesLeft = (ms: number): number => Math.ceil(Math.max(0, ms) / 60_000);

/** How much of the game time has passed, from 0 to 1. */
export function gameProgress(gameSeconds: number, remaining: number): number {
  const total = gameSeconds * 1000;
  return total <= 0 ? 1 : Math.min(1, Math.max(0, 1 - remaining / total));
}

/** ms until the shown figure changes (the next whole second), so a timer wakes only then. */
export const msToNextSecond = (ms: number): number => {
  const rest = ms % 1000;
  return rest === 0 ? 1000 : rest;
};
