import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createGame, tickTimers, viewFor, type GameState, type GameView } from '@ada/game-core';
import type { GamePayload, LobbyView } from '@ada/protocol';
import { gameProgress, isUrgent, minutesLeft, mmss, msToNextSecond, remainingMs, URGENT_MS } from '../src/game/timer';
import { dictionaries } from '../src/i18n';
import { I18nProvider } from '../src/i18n/context';
import { formatEvent } from '../src/i18n/format';
import { AppProvider } from '../src/net/app';
import { initialState, reducer } from '../src/net/store';
import { Lobby, targetOf } from '../src/screens/Lobby';
import { GameOverSheet, endedByTime } from '../src/screens/sheets/GameOverSheet';
import { TimerBar } from '../src/ui/TimerBar';
import { mulberry32 } from '../../game-core/sim/rng';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});

const en = dictionaries.en;
const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <I18nProvider>
      <AppProvider>{el}</AppProvider>
    </I18nProvider>,
  );

const SEC = 1000;
const T0 = 1_000_000;

describe('the countdown arithmetic', () => {
  it('counts down from what the server said and the time since it arrived, and never below zero', () => {
    const clock = { at: 5_000 };
    expect(remainingMs(60 * SEC, clock, 5_000)).toBe(60 * SEC);
    expect(remainingMs(60 * SEC, clock, 5_000 + 12_345)).toBe(60 * SEC - 12_345);
    expect(remainingMs(60 * SEC, clock, 5_000 + 70 * SEC)).toBe(0);
    expect(remainingMs(60 * SEC, clock, 0)).toBe(60 * SEC); // a clock that jumped back adds nothing
  });

  it('shows minutes and seconds, rounding up so 0:00 means the time is really out', () => {
    expect(mmss(90 * SEC)).toBe('1:30');
    expect(mmss(65_000)).toBe('1:05');
    expect(mmss(9_001)).toBe('0:10');
    expect(mmss(1)).toBe('0:01');
    expect(mmss(0)).toBe('0:00');
    expect(mmss(-5)).toBe('0:00');
    expect(minutesLeft(60_001)).toBe(2);
    expect(minutesLeft(0)).toBe(0);
  });

  it('turns urgent in the last 10 seconds of the turn, and not before', () => {
    expect(URGENT_MS).toBe(10_000);
    expect(isUrgent(10_001)).toBe(false);
    expect(isUrgent(10_000)).toBe(true);
    expect(isUrgent(0)).toBe(true);
  });

  it('measures how far through the game time we are, and wakes at the next whole second', () => {
    expect(gameProgress(1800, 1800 * SEC)).toBe(0);
    expect(gameProgress(1800, 900 * SEC)).toBe(0.5);
    expect(gameProgress(1800, 0)).toBe(1);
    expect(gameProgress(1800, 5000 * SEC)).toBe(0);
    expect(msToNextSecond(4_250)).toBe(250);
    expect(msToNextSecond(4_000)).toBe(1000);
  });
});

function timedState(): GameState {
  const created = createGame(
    { players: [0, 1, 2].map((i) => ({ id: `p${i}`, name: `Player${i}`, role: ['soldier', 'sage', 'sailor'][i] })), mode: 'short', timer: { turnSeconds: 60, gameSeconds: 1800 } },
    mulberry32(3),
    T0,
  );
  if (!created.ok) throw new Error('createGame');
  const s = created.state;
  s.phase = 'main';
  s.setup = null;
  s.turn = 1;
  s.current = 'p0';
  s.turnStartedAt = T0;
  return s;
}

describe('the timer in the store', () => {
  const payload = (timerClock: GamePayload['timerClock']): GamePayload => ({
    view: { me: 'a', phase: 'main' } as never,
    legal: {} as never,
    events: [],
    clock: { elapsedMs: 0, running: true },
    timerClock,
  });

  it('keeps the latest figures with the moment they arrived, and drops them when the game is untimed or over', () => {
    let s = reducer(initialState, { t: 'game', kind: 'snapshot', payload: payload({ turnRemainingMs: 40 * SEC, gameRemainingMs: 1700 * SEC }), at: 700 });
    expect(s.timerClock).toEqual({ turnRemainingMs: 40 * SEC, gameRemainingMs: 1700 * SEC, at: 700 });
    s = reducer(s, { t: 'game', kind: 'update', payload: payload({ turnRemainingMs: 60 * SEC, gameRemainingMs: 1680 * SEC }), at: 900 });
    expect(s.timerClock).toEqual({ turnRemainingMs: 60 * SEC, gameRemainingMs: 1680 * SEC, at: 900 });
    s = reducer(s, { t: 'game', kind: 'update', payload: payload(null), at: 1000 });
    expect(s.timerClock).toBeNull();
  });

  it('is gone when the player leaves', () => {
    const s = reducer(initialState, { t: 'game', kind: 'snapshot', payload: payload({ turnRemainingMs: 1, gameRemainingMs: 2 }), at: 1 });
    expect(reducer(s, { t: 'leftRoom' }).timerClock).toBeNull();
  });
});

describe('TimerBar', () => {
  const bar = (view: GameView, clock: { turnRemainingMs: number | null; gameRemainingMs: number } | null, at = performance.now()) =>
    render(<TimerBar view={view} clock={clock ? { ...clock, at } : null} />);

  it('is not drawn at all in an untimed game, without figures, or once the game is over', () => {
    const untimed = timedState();
    untimed.timer = null;
    expect(bar(viewFor(untimed, 'p0'), { turnRemainingMs: 5000, gameRemainingMs: 5000 })).toBe('');
    expect(bar(viewFor(timedState(), 'p0'), null)).toBe('');
    const over = timedState();
    over.phase = 'finished';
    expect(bar(viewFor(over, 'p0'), { turnRemainingMs: 5000, gameRemainingMs: 5000 })).toBe('');
  });

  it('shows the turn time as m:ss and the game time in minutes with a progress bar', () => {
    const html = bar(viewFor(timedState(), 'p1'), { turnRemainingMs: 83 * SEC, gameRemainingMs: 1500 * SEC });
    expect(html).toContain('1:23');
    expect(html).toContain('data-urgent="false"');
    expect(html).toContain(en['timer.gameLeft'].replace('{n}', '25'));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="17"');
    expect(html).toContain('data-mine="false"');
    expect(bar(viewFor(timedState(), 'p0'), { turnRemainingMs: 83 * SEC, gameRemainingMs: 1500 * SEC })).toContain('data-mine="true"');
  });

  it('turns urgent in the last 10 seconds and says so in words, not only in colour', () => {
    const calm = bar(viewFor(timedState(), 'p0'), { turnRemainingMs: 10_001, gameRemainingMs: 1500 * SEC });
    expect(calm).toContain('data-urgent="false"');
    expect(calm).not.toContain(en['timer.hurry']);
    const urgent = bar(viewFor(timedState(), 'p0'), { turnRemainingMs: 9_000, gameRemainingMs: 1500 * SEC });
    expect(urgent).toContain('data-urgent="true"');
    expect(urgent).toContain('0:09');
    expect(urgent).toContain(en['timer.hurry']);
  });

  it('counts the time since the figures arrived, and shows seconds for the game time under a minute', () => {
    const html = bar(viewFor(timedState(), 'p0'), { turnRemainingMs: 30 * SEC, gameRemainingMs: 50 * SEC }, performance.now() - 5 * SEC);
    expect(html).toMatch(/0:2[45]/);
    expect(html).toContain(en['timer.gameLeft.sec'].replace('{n}', html.match(/data-game-left="(\d+)"/)![1]));
  });

  it('says there is no limit during setup', () => {
    expect(bar(viewFor(timedState(), 'p0'), { turnRemainingMs: null, gameRemainingMs: 1700 * SEC })).toContain(en['timer.setup']);
  });
});

describe('the lobby: custom target and timer', () => {
  const choices = { turnSeconds: [60, 90, 120, 150, 180], gameSeconds: [1800, 3600, 5400] };
  const lobby = (over: Partial<LobbyView> = {}): LobbyView => ({
    code: 'KMTP',
    me: 'a',
    hostId: 'a',
    mode: 'standard',
    targetScore: 10,
    timer: null,
    timerChoices: choices,
    teamMode: false,
    phase: 'lobby',
    minPlayers: 2,
    maxPlayers: 5,
    players: [
      { id: 'a', name: 'Ada', role: null, connected: true, host: true, team: null },
      { id: 'b', name: 'Bora', role: null, connected: true, host: false, team: null },
    ],
    ...over,
  });

  it('offers three modes, and the target picker only in the custom mode', () => {
    const std = render(<Lobby lobby={lobby()} />);
    for (const m of ['standard', 'short', 'custom']) expect(std).toContain(`data-mode="${m}"`);
    expect(std).not.toContain('class="target-picker"');
    const custom = render(<Lobby lobby={lobby({ mode: 'custom', targetScore: 8 })} />);
    expect(custom).toContain('class="target-picker"');
    expect(custom).toContain('data-target="8"');
    expect(custom).toContain(en['lobby.target.value'].replace('{n}', '8'));
  });

  it('stops the target at 5 and at 15, and gives it to the host only', () => {
    const tag = (html: string, label: string) => (html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`)) ?? [''])[0];
    const low = render(<Lobby lobby={lobby({ mode: 'custom', targetScore: 5 })} />);
    expect(tag(low, en['lobby.target.dec'])).toContain('disabled');
    expect(tag(low, en['lobby.target.inc'])).not.toContain('disabled');
    const high = render(<Lobby lobby={lobby({ mode: 'custom', targetScore: 15 })} />);
    expect(tag(high, en['lobby.target.inc'])).toContain('disabled');
    const guest = render(<Lobby lobby={lobby({ me: 'b', mode: 'custom', targetScore: 9 })} />);
    expect(tag(guest, en['lobby.target.dec'])).toContain('disabled');
    expect(tag(guest, en['lobby.target.inc'])).toContain('disabled');
  });

  it('has the timer off by default, with no limits shown; on, it lists exactly the limits the server offers', () => {
    const off = render(<Lobby lobby={lobby()} />);
    expect(off).toContain('data-timer="off"');
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain('data-limit="turn"');
    const on = render(<Lobby lobby={lobby({ timer: { turnSeconds: 120, gameSeconds: 3600 } })} />);
    expect(on).toContain('data-timer="on"');
    const turn = on.slice(on.indexOf('data-limit="turn"'), on.indexOf('data-limit="game"'));
    expect([...turn.matchAll(/data-seconds="(\d+)"/g)].map((m) => Number(m[1]))).toEqual(choices.turnSeconds);
    const game = on.slice(on.indexOf('data-limit="game"'));
    expect([...game.matchAll(/data-seconds="(\d+)"/g)].map((m) => Number(m[1]))).toEqual(choices.gameSeconds);
    expect(turn).toContain(en['lobby.timer.seconds'].replace('{n}', '90'));
    expect(game).toContain(en['lobby.timer.minutes'].replace('{n}', '60'));
    // the chosen ones are marked
    expect(turn).toMatch(/aria-checked="true"[^>]*data-seconds="120"/);
    expect(game).toMatch(/aria-checked="true"[^>]*data-seconds="3600"/);
  });

  it('keeps the timer to the host: a guest sees the switch and the limits but cannot touch them', () => {
    const html = render(<Lobby lobby={lobby({ me: 'b', timer: { turnSeconds: 90, gameSeconds: 1800 } })} />);
    expect(html).toContain(en['lobby.timer.hostOnly']);
    const switchTag = html.match(/<button[^>]*role="switch"[^>]*>/)![0];
    expect(switchTag).toContain('disabled');
    for (const m of html.matchAll(/<button[^>]*data-seconds="\d+"[^>]*>/g)) expect(m[0]).toContain('disabled');
  });

  it('knows the target of the room: the number for a custom game, the mode\'s own otherwise', () => {
    expect(targetOf({ mode: 'standard', targetScore: 12 })).toBe(10);
    expect(targetOf({ mode: 'short', targetScore: 12 })).toBe(7);
    expect(targetOf({ mode: 'custom', targetScore: 12 })).toBe(12);
  });
});

describe('the game over sheet with several winners', () => {
  const finished = (winners: string[], tweak?: (s: GameState) => void): GameView => {
    const s = timedState();
    tweak?.(s);
    s.phase = 'finished';
    s.winners = winners;
    return viewFor(s, 'p0');
  };
  const sheet = (view: GameView, byTime = false) =>
    render(<GameOverSheet view={view} byTime={byTime} isHost onClose={() => undefined} onLobby={() => undefined} onLeave={() => undefined} />);

  it('names a single winner as before', () => {
    const html = sheet(finished(['p1']));
    expect(html).toContain('Player1 won!');
    expect(html).not.toContain('won together');
    expect(html).toContain('data-winner="true" data-player="p1"');
    expect(html).toContain('data-winner="false" data-player="p0"');
  });

  it('names two or three winners together, each marked in the score list', () => {
    const two = sheet(finished(['p0', 'p2']));
    const seated = finished(['p0', 'p2']).players.filter((p) => ['p0', 'p2'].includes(p.id)).map((p) => p.name);
    expect(two).toContain(`${seated[0]} and ${seated[1]} won together!`);
    expect(two).toContain('data-winner="true" data-player="p0"');
    expect(two).toContain('data-winner="true" data-player="p2"');
    expect(two).toContain('data-winner="false" data-player="p1"');
    // the names come in seating order (the seats are shuffled when a game is created)
    const all = finished(['p0', 'p1', 'p2']);
    const [a, b, c] = all.players.map((p) => p.name);
    expect(sheet(all)).toContain(`${a}, ${b} and ${c} won together!`);
  });

  it('says the time ran out when it did', () => {
    expect(sheet(finished(['p0', 'p1']), true)).toContain(en['over.timeUp']);
    expect(sheet(finished(['p0']), false)).not.toContain(en['over.timeUp']);
  });
});

describe('telling a win by time from a win by points', () => {
  it('trusts the event when the client saw it', () => {
    const view = viewFor(timedState(), 'p0');
    expect(endedByTime(view, [{ event: { type: 'gameWon', players: ['p0'], points: 7, reason: 'target' } }])).toBe(false);
    expect(endedByTime(view, [{ event: { type: 'gameWon', players: ['p0', 'p1'], points: 2, reason: 'time' } }])).toBe(true);
  });

  it('after a reconnect (no events) reads it from the scores: a timed game that ended under the target ended on the clock', () => {
    const level = viewFor(
      (() => {
        const s = timedState();
        s.phase = 'finished';
        s.winners = ['p0', 'p1', 'p2'];
        return s;
      })(),
      'p0',
    );
    expect(endedByTime(level, [])).toBe(true);
    const untimed = timedState();
    untimed.timer = null;
    untimed.phase = 'finished';
    untimed.winners = ['p0'];
    expect(endedByTime(viewFor(untimed, 'p0'), [])).toBe(false);
  });

  it('a real game: the clock ends it level and the view says who won', () => {
    const s = timedState();
    const r = tickTimers(s, mulberry32(1), T0 + 1800 * SEC);
    if (!r.ok) throw new Error('tick');
    const view = viewFor(r.state, 'p0');
    expect([...view.winners].sort()).toEqual(['p0', 'p1', 'p2']);
    expect(endedByTime(view, [])).toBe(true);
    expect(formatEvent(r.events[0], { t: (k, p) => String(k) + JSON.stringify(p), name: (id) => id, me: 'p0' })).toContain('event.gameWon.tie');
  });
});
