/**
 * The sound effects as data: a few short notes each, made by oscillators (no files).
 * Quiet and plain on purpose; no sound lasts longer than `MAX_SOUND_MS`.
 */
export type SoundName = 'dice' | 'build' | 'gain' | 'trade' | 'error' | 'turn';

export interface Note {
  /** Hz */
  freq: number;
  /** seconds from the start of the sound */
  at: number;
  /** seconds */
  dur: number;
  type: OscillatorType;
  /** peak gain at full volume, 0..1 */
  gain: number;
}

export const MAX_SOUND_MS = 300;
export const FREQ_RANGE = { min: 80, max: 1200 } as const;

export const TONES: Record<SoundName, Note[]> = {
  dice: [
    { freq: 440, at: 0, dur: 0.06, type: 'sine', gain: 0.12 },
    { freq: 520, at: 0.09, dur: 0.06, type: 'sine', gain: 0.12 },
  ],
  build: [{ freq: 220, at: 0, dur: 0.05, type: 'sine', gain: 0.16 }],
  gain: [{ freq: 880, at: 0, dur: 0.12, type: 'sine', gain: 0.1 }],
  trade: [
    { freq: 523, at: 0, dur: 0.1, type: 'sine', gain: 0.12 },
    { freq: 659, at: 0.11, dur: 0.1, type: 'sine', gain: 0.12 },
  ],
  error: [{ freq: 110, at: 0, dur: 0.12, type: 'sawtooth', gain: 0.07 }],
  turn: [{ freq: 392, at: 0, dur: 0.15, type: 'sine', gain: 0.1 }],
};

/** milliseconds from the start until the last note has ended */
export function soundMs(name: SoundName): number {
  return Math.round(Math.max(...TONES[name].map((n) => n.at + n.dur)) * 1000);
}
