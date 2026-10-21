import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { RESOURCES, type Hand } from '@ada/game-core';
import type { LogEntry, RollRecord } from '../net/store';

/**
 * How a live dice roll is presented. This is only a picture of what already
 * happened: the result, the hand, the buttons and the legal moves all come from
 * the server's payload and never wait for it. Anything newer (another update, a
 * tap on the board) ends it at once.
 *
 * rolling (tumble, result hidden) -> hold (result large in the middle) -> dock (moving to the corner) -> still
 */
export type RollStage = 'rolling' | 'hold' | 'dock' | 'still';

/** milliseconds; tumble + hold + dock stay within 1.5 s */
export const ROLL_TIMING = { tumble: 800, hold: 500, dock: 200 } as const;
/** how long the producing tiles stay marked, counted from the moment the big dice leave the middle of the board (they would cover the tiles before that) */
export const HIGHLIGHT_MS = 1100;

/** The faces shown while tumbling: a fixed sequence that has nothing to do with the result. */
export const TUMBLE_FACES: readonly number[] = [1, 4, 2, 6, 3, 5];
export const TUMBLE_STEP_MS = 90;

export interface RollPresentation {
  stage: RollStage;
  /** the dice are still tumbling: the result and what it brought must not be shown yet */
  rolling: boolean;
  /** the live roll being presented (null until one arrives in this session) */
  roll: RollRecord | null;
  /** the producing tiles are marked now, and my gain shows as "+n" */
  highlight: boolean;
  /** ends the presentation now (a tap on the board) */
  skip: () => void;
}

/** `(prefers-reduced-motion: reduce)` as a live value */
export function useReducedMotion(): boolean {
  const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null);
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const q = query();
    if (!q) return;
    const on = () => setReduced(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export interface Run {
  roll: RollRecord;
  startRev: number;
  stage: RollStage;
  highlight: boolean;
}

export type RollAction =
  | { t: 'arrive'; roll: RollRecord; rev: number; reduced: boolean }
  | { t: 'stage'; seq: number; stage: RollStage; highlight?: boolean }
  | { t: 'highlightOff'; seq: number }
  | { t: 'rev'; rev: number }
  | { t: 'skip' };

/**
 * The stages as a pure state machine (the hook below only adds timers). A roll
 * is replaced by a newer one; any later payload or a skip ends it at once; with
 * reduced motion it starts at rest, with the result showing.
 */
export function rollMachine(run: Run | null, a: RollAction): Run | null {
  switch (a.t) {
    case 'arrive':
      return { roll: a.roll, startRev: a.rev, stage: a.reduced ? 'still' : 'rolling', highlight: a.reduced };
    case 'stage':
      return run && run.roll.seq === a.seq ? { ...run, stage: a.stage, highlight: a.highlight ?? run.highlight } : run;
    case 'highlightOff':
      return run && run.roll.seq === a.seq ? { ...run, highlight: false } : run;
    case 'rev':
      return run && run.startRev !== a.rev ? { ...run, stage: 'still', highlight: false, startRev: a.rev } : run;
    case 'skip':
      // a tap sends the dice to the corner now; the tiles they would have covered get marked from this moment
      return run && (run.stage !== 'still' || run.highlight) ? { ...run, stage: 'still', highlight: true } : run;
  }
}

/**
 * Drives the machine from the store. A roll that is already there when the
 * screen opens (a reload, a late join, a reconnect) is never replayed: the dice
 * simply stand still in the corner.
 */
export function useRollPresentation(lastRoll: RollRecord | null, rev: number, reduced: boolean): RollPresentation {
  const seen = useRef(lastRoll?.seq ?? 0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [run, dispatch] = useReducer(rollMachine, null);

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => {
    if (!lastRoll || lastRoll.seq === seen.current) return;
    seen.current = lastRoll.seq;
    clear();
    const seq = lastRoll.seq;
    const later = (ms: number, fn: () => void) => void timers.current.push(setTimeout(fn, ms));
    const { tumble, hold, dock } = ROLL_TIMING;
    dispatch({ t: 'arrive', roll: lastRoll, rev, reduced });
    if (reduced) {
      later(HIGHLIGHT_MS, () => dispatch({ t: 'highlightOff', seq }));
      return;
    }
    later(tumble, () => dispatch({ t: 'stage', seq, stage: 'hold' }));
    later(tumble + hold, () => dispatch({ t: 'stage', seq, stage: 'dock', highlight: true }));
    later(tumble + hold + dock, () => dispatch({ t: 'stage', seq, stage: 'still' }));
    later(tumble + hold + HIGHLIGHT_MS, () => dispatch({ t: 'highlightOff', seq }));
  }, [lastRoll, rev, reduced, clear]);

  /** any payload newer than the one the roll came in ends the presentation: the game does not wait for a picture */
  useEffect(() => {
    dispatch({ t: 'rev', rev });
  }, [rev]);
  useEffect(() => {
    if (run && run.stage === 'still' && !run.highlight) clear();
  }, [run, clear]);
  useEffect(() => clear, [clear]);

  const skip = useCallback(() => {
    if (!run || (run.stage === 'still' && !run.highlight)) return;
    clear();
    dispatch({ t: 'skip' });
    const seq = run.roll.seq;
    timers.current.push(setTimeout(() => dispatch({ t: 'highlightOff', seq }), HIGHLIGHT_MS));
  }, [clear, run]);

  return { stage: run?.stage ?? 'still', rolling: run?.stage === 'rolling', roll: run?.roll ?? null, highlight: run?.highlight ?? false, skip };
}

/** The log as it may be shown now: while the dice tumble, the roll and everything after it stay out of sight. */
export function visibleLog(log: LogEntry[], p: Pick<RollPresentation, 'rolling' | 'roll'>): LogEntry[] {
  return p.rolling && p.roll ? log.filter((l) => l.id < p.roll!.logId) : log;
}

/**
 * What each count is held back by, while the dice tumble, so a changing number does not give the result away.
 * Purely visual: the real counts are in the view and are what everything else uses.
 */
export function heldBack(p: Pick<RollPresentation, 'rolling' | 'roll'>, playerId: string): Hand | null {
  return p.rolling && p.roll ? (p.roll.gains[playerId] ?? null) : null;
}

export const heldTotal = (h: Hand | null): number => (h ? RESOURCES.reduce((n, r) => n + h[r], 0) : 0);
