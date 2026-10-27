import { useEffect, useRef } from 'react';
import type { GameEvent } from '@ada/protocol';
import type { LogEntry, Notice, RollRecord } from '../net/store';
import { audio, haptics } from './index';
import type { SoundName } from './tones';

export interface Reaction {
  sound?: SoundName;
  /** a short buzz when vibration is on */
  tap?: boolean;
}

/**
 * What a live event sounds like for this player. The dice are heard by everyone, whoever rolled;
 * everything else only answers what I did (or, for a turn, whose turn it now is).
 * The resource "pling" is not here: it follows the production flight (see `gainedFromRoll`).
 */
export function reactionFor(e: GameEvent, me: string): Reaction | null {
  switch (e.type) {
    case 'diceRolled':
      return { sound: 'dice' };
    case 'settlementBuilt':
    case 'roadBuilt':
    case 'cityBuilt':
      return e.player === me ? { sound: 'build', tap: true } : null;
    case 'demolished':
      return e.player === me ? { sound: 'build', tap: true } : null;
    case 'tradeAccepted':
      return e.from === me || e.to === me ? { sound: 'trade' } : null;
    case 'bankTraded':
      return e.player === me ? { sound: 'trade' } : null;
    case 'turnStarted':
      return e.player === me ? { sound: 'turn' } : null;
    default:
      return null;
  }
}

/** does this roll give me anything (production or a role bonus)? */
export function gainedFromRoll(roll: RollRecord | null, me: string): boolean {
  const g = roll?.gains[me];
  return !!g && Object.values(g).some((n) => n > 0);
}

/** Plays the sounds of events that arrive while the game screen is open; what was already in the log when it opened stays silent. */
export function useGameSounds(log: LogEntry[], me: string, roll: RollRecord | null, highlight: boolean): void {
  const last = useRef(log.length ? log[log.length - 1]!.id : 0);
  useEffect(() => {
    const fresh = log.filter((l) => l.id > last.current);
    if (fresh.length === 0) return;
    last.current = fresh[fresh.length - 1]!.id;
    const played = new Set<SoundName>();
    let tap = false;
    for (const { event } of fresh) {
      const r = reactionFor(event, me);
      if (!r) continue;
      if (r.sound && !played.has(r.sound)) {
        played.add(r.sound);
        audio.play(r.sound);
      }
      tap ||= !!r.tap;
    }
    if (tap) haptics.tap();
  }, [log, me]);

  /* the pling comes with the flight: when the roll's production starts to show */
  const plinged = useRef(roll?.seq ?? 0);
  useEffect(() => {
    if (!roll || !highlight || plinged.current === roll.seq) return;
    plinged.current = roll.seq;
    if (gainedFromRoll(roll, me)) audio.play('gain');
  }, [roll, highlight, me]);
}

/** a refusal from the server buzzes, wherever the player is */
export function useErrorSound(notice: Notice | null): void {
  const seen = useRef<number | null>(notice?.id ?? null);
  useEffect(() => {
    if (!notice || notice.id === seen.current) return;
    seen.current = notice.id;
    if (notice.kind === 'error') audio.play('error');
  }, [notice]);
}
