/** The game's running time, as shown: whole minutes, counted from what the server said and the time since it arrived. */
export interface ServerClock {
  elapsedMs: number;
  running: boolean;
  /** monotonic ms (performance.now) at which the server's figure arrived */
  at: number;
}

const MINUTE = 60_000;

/** Whole minutes played at monotonic time `nowMs`. Only the time passed since arrival comes from this device (a duration, never a date). */
export function elapsedMinutes(clock: ServerClock, nowMs: number): number {
  const sinceArrival = clock.running ? Math.max(0, nowMs - clock.at) : 0;
  return Math.floor((clock.elapsedMs + sinceArrival) / MINUTE);
}

/** ms until the shown minute changes (so a timer wakes only then) */
export function msToNextMinute(clock: ServerClock, nowMs: number): number {
  const sinceArrival = clock.running ? Math.max(0, nowMs - clock.at) : 0;
  return MINUTE - ((clock.elapsedMs + sinceArrival) % MINUTE);
}
