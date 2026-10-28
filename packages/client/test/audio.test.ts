import { describe, expect, it, vi } from 'vitest';
import { createAudio, type AudioCtx } from '../src/audio/engine';
import { canVibrate, createHaptics, TAP_MS } from '../src/audio/haptics';
import { installUnlock } from '../src/audio';
import { canFullscreen } from '../src/audio/fullscreen';
import { createPrefs, DEFAULT_PREFS, loadPrefs } from '../src/audio/preferences';
import { gainedFromRoll, reactionFor } from '../src/audio/reactions';
import { FREQ_RANGE, MAX_SOUND_MS, soundMs, TONES, type SoundName } from '../src/audio/tones';
import { createStorage } from '../src/net/storage';

const names = Object.keys(TONES) as SoundName[];

function memoryBackend() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

function mockCtx(state = 'running') {
  const oscs: { type: string; frequency: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }[] = [];
  const gains: { gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    currentTime: 10,
    state,
    destination: {},
    resume: vi.fn(async () => undefined),
    createOscillator: vi.fn(() => {
      const o = { type: '', frequency: { value: 0 }, start: vi.fn(), stop: vi.fn(), connect: vi.fn() };
      oscs.push(o);
      return o;
    }),
    createGain: vi.fn(() => {
      const g = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
      gains.push(g);
      return g;
    }),
  };
  return { ctx: ctx as unknown as AudioCtx & typeof ctx, oscs, gains };
}

function setup(opts: { hidden?: boolean; state?: string; prefs?: Partial<typeof DEFAULT_PREFS> } = {}) {
  const prefs = createPrefs(createStorage(() => memoryBackend()));
  if (opts.prefs) prefs.set(opts.prefs);
  const m = mockCtx(opts.state);
  const create = vi.fn(() => m.ctx);
  const audio = createAudio({ create, prefs, isHidden: () => opts.hidden ?? false });
  return { prefs, audio, create, ...m };
}

describe('the tones', () => {
  it('are short (300 ms at most), within an audible, plain range, and quiet', () => {
    for (const n of names) {
      expect(soundMs(n), n).toBeLessThanOrEqual(MAX_SOUND_MS);
      for (const note of TONES[n]) {
        expect(note.freq).toBeGreaterThanOrEqual(FREQ_RANGE.min);
        expect(note.freq).toBeLessThanOrEqual(FREQ_RANGE.max);
        expect(note.gain).toBeGreaterThan(0);
        expect(note.gain).toBeLessThanOrEqual(0.2);
      }
    }
  });
  it('dice are two beeps, a trade is two notes, the others one', () => {
    expect(TONES.dice).toHaveLength(2);
    expect(TONES.trade).toHaveLength(2);
    expect(TONES.trade[1]!.freq).toBeGreaterThan(TONES.trade[0]!.freq);
    for (const n of ['build', 'gain', 'error', 'turn'] as const) expect(TONES[n]).toHaveLength(1);
    expect(TONES.error[0]!.freq).toBeLessThan(200); // the low buzz
  });
});

describe('the audio engine', () => {
  it('makes one oscillator and one gain node per note, wired to the output and scheduled by the note', () => {
    const { audio, ctx, oscs, gains } = setup();
    audio.unlock();
    audio.play('trade');
    expect(oscs).toHaveLength(2);
    expect(gains).toHaveLength(2);
    expect(oscs[0]!.frequency.value).toBe(523);
    expect(oscs[1]!.frequency.value).toBe(659);
    expect(oscs[1]!.start).toHaveBeenCalledWith(10 + 0.11);
    expect(oscs[1]!.stop).toHaveBeenCalledWith(10 + 0.11 + 0.1);
    expect(oscs[0]!.connect).toHaveBeenCalledWith(gains[0]);
    expect(gains[0]!.connect).toHaveBeenCalledWith(ctx.destination);
    expect(gains[0]!.gain.exponentialRampToValueAtTime).toHaveBeenCalled();
  });
  it('scales the level by the volume', () => {
    const loud = setup({ prefs: { volume: 100 } });
    loud.audio.unlock();
    loud.audio.play('gain');
    const quiet = setup({ prefs: { volume: 25 } });
    quiet.audio.unlock();
    quiet.audio.play('gain');
    const peak = (s: typeof loud) => s.gains[0]!.gain.linearRampToValueAtTime.mock.calls[0]![0] as number;
    expect(peak(quiet)).toBeCloseTo(peak(loud) / 4);
  });
  it('makes no audio call at all with the effects off, at volume 0, or in a hidden tab', () => {
    for (const o of [{ prefs: { sfx: false } }, { prefs: { volume: 0 } }, { hidden: true }]) {
      const s = setup(o);
      s.audio.unlock();
      s.audio.play('dice');
      expect(s.ctx.createOscillator).not.toHaveBeenCalled();
      expect(s.ctx.createGain).not.toHaveBeenCalled();
    }
    const off = setup({ prefs: { sfx: false } });
    off.audio.unlock();
    expect(off.create).not.toHaveBeenCalled(); // not even a context
  });
  it('is silent before the first tap, and unlocks (creates and resumes the context) on it', () => {
    const s = setup({ state: 'suspended' });
    s.audio.play('dice');
    expect(s.create).not.toHaveBeenCalled();
    s.audio.unlock();
    s.audio.unlock();
    expect(s.create).toHaveBeenCalledTimes(1);
    expect(s.ctx.resume).toHaveBeenCalled();
    s.audio.play('dice'); // still suspended: no sound, no error
    expect(s.ctx.createOscillator).not.toHaveBeenCalled();
  });
  it('turning the effects off later silences it at once; on again plays', () => {
    const s = setup();
    s.audio.unlock();
    s.prefs.set({ sfx: false });
    s.audio.play('turn');
    expect(s.ctx.createOscillator).not.toHaveBeenCalled();
    s.prefs.set({ sfx: true });
    s.audio.play('turn');
    expect(s.ctx.createOscillator).toHaveBeenCalledTimes(1);
  });
  it('carries on without sound where there is no Web Audio, or it throws', () => {
    const prefs = createPrefs(createStorage(() => memoryBackend()));
    const a = createAudio({ create: () => null, prefs, isHidden: () => false });
    expect(() => (a.unlock(), a.play('dice'))).not.toThrow();
    const b = createAudio({ create: () => { throw new Error('no'); }, prefs, isHidden: () => false });
    expect(() => (b.unlock(), b.play('dice'))).not.toThrow();
  });
  it('the unlock listener is on the first tap or key, and can be removed', () => {
    const handlers = new Map<string, () => void>();
    const target = { addEventListener: vi.fn((e: string, h: () => void) => void handlers.set(e, h)), removeEventListener: vi.fn() };
    const unlock = vi.fn();
    const off = installUnlock(target as never, { unlock });
    expect([...handlers.keys()].sort()).toEqual(['keydown', 'pointerdown']);
    handlers.get('pointerdown')!();
    expect(unlock).toHaveBeenCalledTimes(1);
    off();
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
  });
});

describe('what each event sounds like', () => {
  const me = 'a';
  it('the dice are heard by everyone, whoever rolled', () => {
    const roll = (player: string) => ({ type: 'diceRolled', player, dice: [1, 2], total: 3, hitTiles: [], robbedTile: null }) as never;
    expect(reactionFor(roll('a'), me)?.sound).toBe('dice');
    expect(reactionFor(roll('b'), me)?.sound).toBe('dice');
  });
  it('building, demolishing, trading and the turn answer only my own actions', () => {
    const ev = (e: object) => e as never;
    expect(reactionFor(ev({ type: 'roadBuilt', player: 'a' }), me)).toEqual({ sound: 'build', tap: true });
    expect(reactionFor(ev({ type: 'roadBuilt', player: 'b' }), me)).toBeNull();
    expect(reactionFor(ev({ type: 'cityBuilt', player: 'b' }), me)).toBeNull();
    expect(reactionFor(ev({ type: 'demolished', player: 'a', from: 'b' }), me)).toEqual({ sound: 'build', tap: true });
    expect(reactionFor(ev({ type: 'demolished', player: 'b', from: 'a' }), me)).toBeNull();
    expect(reactionFor(ev({ type: 'tradeAccepted', from: 'a', to: 'b' }), me)?.sound).toBe('trade');
    expect(reactionFor(ev({ type: 'tradeAccepted', from: 'b', to: 'c' }), me)).toBeNull();
    expect(reactionFor(ev({ type: 'bankTraded', player: 'b' }), me)).toBeNull();
    expect(reactionFor(ev({ type: 'turnStarted', player: 'a' }), me)?.sound).toBe('turn');
    expect(reactionFor(ev({ type: 'turnStarted', player: 'b' }), me)).toBeNull();
    expect(reactionFor(ev({ type: 'produced', player: 'a' }), me)).toBeNull(); // the pling follows the flight instead
  });
  it('the pling is only for a roll that gave me something', () => {
    const hand = (n: number) => ({ lumber: n, brick: 0, wool: 0, grain: 0, ore: 0 });
    const roll = { gains: { a: hand(1), b: hand(0) } } as never;
    expect(gainedFromRoll(roll, 'a')).toBe(true);
    expect(gainedFromRoll(roll, 'b')).toBe(false);
    expect(gainedFromRoll(roll, 'c')).toBe(false);
    expect(gainedFromRoll(null, 'a')).toBe(false);
  });
});

describe('preferences', () => {
  it('start at sound on, a middling volume, vibration off and animations on', () => {
    expect(DEFAULT_PREFS).toEqual({ sfx: true, volume: 60, vibrate: false, animations: true });
    expect(loadPrefs(createStorage(() => memoryBackend()))).toEqual(DEFAULT_PREFS);
  });
  it('persist in storage and come back; a bad value falls back', () => {
    const backend = memoryBackend();
    const p = createPrefs(createStorage(() => backend));
    p.set({ sfx: false, volume: 35, vibrate: true, animations: false });
    expect([backend.m.get('ada.sfx'), backend.m.get('ada.volume'), backend.m.get('ada.vibrate'), backend.m.get('ada.animations')]).toEqual(['0', '35', '1', '0']);
    expect(loadPrefs(createStorage(() => backend))).toEqual({ sfx: false, volume: 35, vibrate: true, animations: false });
    backend.m.set('ada.volume', 'loud');
    backend.m.set('ada.sfx', 'x');
    backend.m.set('ada.animations', 'maybe');
    expect(loadPrefs(createStorage(() => backend))).toMatchObject({ sfx: true, volume: 60, animations: true });
    p.set({ volume: 400 });
    expect(p.get().volume).toBe(100);
  });
  it('carry on in memory when storage is blocked', () => {
    const blocked = createStorage(() => { throw new Error('blocked'); });
    const p = createPrefs(blocked);
    p.set({ sfx: false });
    expect(p.get().sfx).toBe(false);
    expect(loadPrefs(blocked).sfx).toBe(false);
  });
  it('tell listeners about a change', () => {
    const p = createPrefs(createStorage(() => memoryBackend()));
    const l = vi.fn();
    const off = p.subscribe(l);
    p.set({ vibrate: true });
    expect(l).toHaveBeenCalledTimes(1);
    off();
    p.set({ vibrate: false });
    expect(l).toHaveBeenCalledTimes(1);
  });
});

describe('haptics and full screen', () => {
  it('buzz for 30 ms only when vibration is on and supported', () => {
    const vibrate = vi.fn(() => true);
    const prefs = createPrefs(createStorage(() => memoryBackend()));
    const h = createHaptics(prefs, { vibrate });
    h.tap();
    expect(vibrate).not.toHaveBeenCalled(); // off by default
    prefs.set({ vibrate: true });
    h.tap();
    expect(vibrate).toHaveBeenCalledWith(TAP_MS);
    const none = createHaptics(prefs, {});
    expect(() => none.tap()).not.toThrow();
  });
  it('support checks', () => {
    expect(canVibrate({ vibrate: () => true })).toBe(true);
    expect(canVibrate({})).toBe(false);
    expect(canFullscreen({ fullscreenEnabled: true })).toBe(true);
    expect(canFullscreen({ fullscreenEnabled: false })).toBe(false);
    expect(canFullscreen(undefined)).toBe(false);
  });
});
