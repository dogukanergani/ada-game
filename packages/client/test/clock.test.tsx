import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { elapsedMinutes, msToNextMinute } from '../src/game/clock';
import { I18nProvider } from '../src/i18n/context';
import { initialState, reducer } from '../src/net/store';
import { GameClock } from '../src/ui/GameClock';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});

const MIN = 60_000;

describe('the elapsed time', () => {
  it('is the server\'s figure plus what passed since it arrived, in whole minutes', () => {
    const c = { elapsedMs: 11 * MIN + 30_000, running: true, at: 5_000 };
    expect(elapsedMinutes(c, 5_000)).toBe(11);
    expect(elapsedMinutes(c, 5_000 + 29_999)).toBe(11);
    expect(elapsedMinutes(c, 5_000 + 30_000)).toBe(12);
    expect(elapsedMinutes(c, 5_000 + 30 * MIN)).toBe(41);
  });
  it('never counts on once the game is over, and never goes backwards', () => {
    const c = { elapsedMs: 17 * MIN, running: false, at: 0 };
    expect(elapsedMinutes(c, 99 * MIN)).toBe(17);
    expect(elapsedMinutes({ ...c, running: true, at: 1_000 }, 0)).toBe(17);
  });
  it('wakes exactly when the minute changes', () => {
    const c = { elapsedMs: 11 * MIN + 30_000, running: true, at: 0 };
    expect(msToNextMinute(c, 0)).toBe(30_000);
    expect(msToNextMinute(c, 10_000)).toBe(20_000);
    expect(msToNextMinute({ ...c, elapsedMs: 0 }, 0)).toBe(MIN);
  });
});

describe('the clock in the store', () => {
  const payload = (elapsedMs: number, running = true) => ({ view: { me: 'a', phase: 'main' } as never, legal: {} as never, events: [], clock: { elapsedMs, running } });
  it('keeps the latest figure with the moment it arrived, and a reconnect snapshot replaces it', () => {
    let s = reducer(initialState, { t: 'game', kind: 'snapshot', payload: payload(12 * MIN), at: 400 });
    expect(s.clock).toEqual({ elapsedMs: 12 * MIN, running: true, at: 400 });
    s = reducer(s, { t: 'game', kind: 'update', payload: payload(13 * MIN, false), at: 900 });
    expect(s.clock).toEqual({ elapsedMs: 13 * MIN, running: false, at: 900 });
  });
  it('is gone when the player leaves or the lobby takes over', () => {
    const s = reducer(initialState, { t: 'game', kind: 'snapshot', payload: payload(MIN), at: 1 });
    expect(reducer(s, { t: 'leftRoom' }).clock).toBeNull();
    const lobby = { code: 'KMTP', me: 'a', hostId: 'a', mode: 'short', phase: 'lobby', minPlayers: 2, maxPlayers: 5, players: [] } as never;
    expect(reducer(s, { t: 'lobby', lobby }).clock).toBeNull();
  });
});

describe('GameClock', () => {
  const render = (el: React.ReactElement) => renderToStaticMarkup(<I18nProvider>{el}</I18nProvider>);
  it('shows minutes, and hours and minutes after the first hour', () => {
    expect(render(<GameClock clock={{ elapsedMs: 12 * MIN, running: false, at: 0 }} />)).toContain('>12 min<');
    expect(render(<GameClock clock={{ elapsedMs: 65 * MIN, running: false, at: 0 }} />)).toContain('>1 h 5 min<');
    expect(render(<GameClock clock={{ elapsedMs: 0, running: false, at: 0 }} />)).toContain('>0 min<');
  });
  it('shows nothing before the server has said anything', () => {
    expect(render(<GameClock clock={null} />)).toBe('');
  });
});
