import { TONES, type SoundName } from './tones';
import type { PrefsStore } from './preferences';

/** the bits of the Web Audio API that are used, so a test can stand in for it */
export interface AudioCtx {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(n: unknown): unknown;
    start(t: number): void;
    stop(t: number): void;
  };
  createGain(): {
    gain: { setValueAtTime(v: number, t: number): unknown; linearRampToValueAtTime(v: number, t: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown };
    connect(n: unknown): unknown;
  };
}

export interface AudioDeps {
  /** makes the context, or null where there is no Web Audio */
  create: () => AudioCtx | null;
  prefs: PrefsStore;
  isHidden: () => boolean;
}

const ATTACK = 0.008;

/**
 * Plays the effects. A browser only lets a page make sound after a tap, so the context is made
 * (and resumed) by `unlock()` on the first tap, and `play()` does nothing until it exists.
 * With the effects off, in a hidden tab, or at volume 0, no audio call is made at all.
 */
export function createAudio({ create, prefs, isHidden }: AudioDeps) {
  let ctx: AudioCtx | null = null;

  return {
    /** call from a user gesture; does nothing while the effects are off (turning them on, then tapping again, unlocks) */
    unlock(): void {
      if (!prefs.get().sfx) return;
      try {
        ctx ??= create();
        if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      } catch {
        ctx = null; // no Web Audio: carry on without sound
      }
    },
    play(name: SoundName): void {
      const { sfx, volume } = prefs.get();
      if (!sfx || volume === 0 || isHidden() || !ctx || ctx.state !== 'running') return;
      try {
        const t0 = ctx.currentTime;
        for (const n of TONES[name]) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          const peak = Math.max(0.0002, n.gain * (volume / 100));
          const start = t0 + n.at;
          osc.type = n.type;
          osc.frequency.value = n.freq;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.linearRampToValueAtTime(peak, start + ATTACK);
          g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + n.dur);
        }
      } catch {
        /* a sound is never worth an error */
      }
    },
  };
}

export type Audio = ReturnType<typeof createAudio>;
