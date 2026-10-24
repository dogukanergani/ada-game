import { describe, expect, it } from 'vitest';
import { MemoryRoomStore } from '../src/rooms/memoryStore';
import { TestClient, settle, startServer } from './harness';
import { playOut, stateOf } from './gameplay';

const SEC = 1000;
const T0 = 5_000_000;
const TIMER = { turnSeconds: 60, gameSeconds: 1800 };
const errorKey = (r: any): string => r.error?.key;

/** A clock the test moves by hand; the server reads it for everything, so no real time passes. */
function fakeClock(start = T0) {
  const c = { t: start, now: () => c.t };
  return c;
}

type Started = Awaited<ReturnType<typeof timedRoom>>;

/** A room of `n` players with the timer on and the game started; `toMain` skips the setup by putting the game in its first main phase. */
async function timedRoom(
  url: string,
  server: Awaited<ReturnType<typeof startServer>>['server'],
  n: number,
  opts: { timer?: typeof TIMER | null; mode?: 'standard' | 'short' | 'custom'; targetScore?: number; toMain?: boolean; now?: number } = {},
) {
  const players: TestClient[] = [];
  for (let i = 0; i < n; i++) players.push(await TestClient.login(url));
  const { code } = await players[0].emit('room:create', { name: 'P0' });
  for (let i = 1; i < n; i++) await players[i].emit('room:join', { code, name: `P${i}` });
  expect(await players[0].emit('lobby:setMode', { mode: opts.mode ?? 'short', ...(opts.targetScore !== undefined ? { targetScore: opts.targetScore } : {}) })).toMatchObject({ ok: true });
  const timer = opts.timer === undefined ? TIMER : opts.timer;
  if (timer) expect(await players[0].emit('lobby:setTimer', { timer })).toMatchObject({ ok: true });
  expect(await players[0].emit('lobby:start')).toEqual({ ok: true });
  if (opts.toMain !== false) {
    server.store.update(code, (r) => {
      const g = r.game!;
      g.phase = 'main';
      g.setup = null;
      g.turn = 1;
      g.current = g.players[0].id;
      if (g.timer) g.turnStartedAt = opts.now ?? T0;
    });
  }
  return { players, code };
}

describe('choosing the mode and the timer in the lobby', () => {
  it('starts untimed in the standard mode, with a custom target of 10 waiting', async () => {
    const { url } = await startServer();
    const host = await TestClient.login(url);
    const { code } = await host.emit('room:create', { name: 'H' });
    const lobby = await host.until('lobby:update');
    expect(lobby).toMatchObject({ code, mode: 'standard', targetScore: 10, timer: null });
    // the lists of the rules, in seconds: the client offers exactly these
    expect(lobby.timerChoices).toEqual({ turnSeconds: [60, 90, 120, 150, 180], gameSeconds: [1800, 3600, 5400] });
  });

  it('takes a custom target from 5 to 15 only with the custom mode, and only from the host', async () => {
    const { url } = await startServer();
    const host = await TestClient.login(url);
    const guest = await TestClient.login(url);
    const { code } = await host.emit('room:create', { name: 'H' });
    await guest.emit('room:join', { code, name: 'G' });
    for (const targetScore of [5, 9, 15]) {
      expect(await host.emit('lobby:setMode', { mode: 'custom', targetScore })).toEqual({ ok: true });
      expect(await host.until('lobby:update', (l: any) => l.mode === 'custom' && l.targetScore === targetScore)).toBeTruthy();
    }
    for (const bad of [4, 16, 7.5, 0, -3]) expect(errorKey(await host.emit('lobby:setMode', { mode: 'custom', targetScore: bad })), String(bad)).toBe('badTarget');
    expect(errorKey(await host.emit('lobby:setMode', { mode: 'custom' }))).toBe('badTarget');
    expect(errorKey(await host.emit('lobby:setMode', { mode: 'standard', targetScore: 8 }))).toBe('badTarget');
    expect(errorKey(await host.emit('lobby:setMode', { mode: 'custom', targetScore: '8' }))).toBe('badPayload');
    expect(errorKey(await host.emit('lobby:setMode', { mode: 'huge' }))).toBe('badPayload');
    expect(errorKey(await guest.emit('lobby:setMode', { mode: 'custom', targetScore: 8 }))).toBe('notHost');
    // the number is remembered when the host goes back to a fixed mode
    expect(await host.emit('lobby:setMode', { mode: 'short' })).toEqual({ ok: true });
    expect(await host.until('lobby:update', (l: any) => l.mode === 'short' && l.targetScore === 15)).toBeTruthy();
  });

  it('turns the timer on from the fixed lists only, off again with null, and only for the host', async () => {
    const { url } = await startServer();
    const host = await TestClient.login(url);
    const guest = await TestClient.login(url);
    const { code } = await host.emit('room:create', { name: 'H' });
    await guest.emit('room:join', { code, name: 'G' });
    for (const turnSeconds of [60, 90, 120, 150, 180]) {
      for (const minutes of [30, 60, 90]) {
        expect(await host.emit('lobby:setTimer', { timer: { turnSeconds, gameSeconds: minutes * 60 } })).toEqual({ ok: true });
      }
    }
    expect((await host.until('lobby:update', (l: any) => l.timer?.turnSeconds === 180 && l.timer?.gameSeconds === 5400)).timer).toEqual({ turnSeconds: 180, gameSeconds: 5400 });
    for (const timer of [{ turnSeconds: 45, gameSeconds: 1800 }, { turnSeconds: 60, gameSeconds: 1500 }, { turnSeconds: 1, gameSeconds: 1 }]) {
      expect(errorKey(await host.emit('lobby:setTimer', { timer })), JSON.stringify(timer)).toBe('badTimer');
    }
    for (const bad of [{}, { timer: 5 }, { timer: { turnSeconds: 60 } }, { timer: { turnSeconds: '60', gameSeconds: 1800 } }, { timer: { turnSeconds: 60.5, gameSeconds: 1800 } }]) {
      expect(errorKey(await host.emit('lobby:setTimer', bad)), JSON.stringify(bad)).toBe('badPayload');
    }
    expect(errorKey(await guest.emit('lobby:setTimer', { timer: TIMER }))).toBe('notHost');
    expect(await host.emit('lobby:setTimer', { timer: null })).toEqual({ ok: true });
    expect(await host.until('lobby:update', (l: any) => l.timer === null)).toBeTruthy();
  });

  it('refuses limits outside the lists even from a test server, unless the test config adds them (NODE_ENV=test only)', async () => {
    const { configFromEnv } = await import('../src/config');
    expect(configFromEnv({ NODE_ENV: 'test', ADA_TEST_TURN_SECONDS: '3', ADA_TEST_GAME_SECONDS: '20' })).toMatchObject({ testTurnSeconds: 3, testGameSeconds: 20 });
    expect(configFromEnv({ NODE_ENV: 'production', ADA_TEST_TURN_SECONDS: '3', ADA_TEST_GAME_SECONDS: '20' })).toMatchObject({ testTurnSeconds: null, testGameSeconds: null });
    expect(() => configFromEnv({ NODE_ENV: 'test', ADA_TEST_TURN_SECONDS: '0' })).toThrow();

    const base = { port: 0, corsOrigins: ['*'], secret: 's', clientDir: null, testVp: null, testSeed: null, testResources: null, testCreateLimit: null };
    const { url } = await startServer({ config: { ...base, testTurnSeconds: 3, testGameSeconds: 20 } });
    const host = await TestClient.login(url);
    await host.emit('room:create', { name: 'H' });
    expect(await host.emit('lobby:setTimer', { timer: { turnSeconds: 3, gameSeconds: 20 } })).toEqual({ ok: true });
    expect(errorKey(await host.emit('lobby:setTimer', { timer: { turnSeconds: 4, gameSeconds: 20 } }))).toBe('badTimer');
  });

  it('cannot be changed once the game has started', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    const { players } = await timedRoom(url, server, 2, { toMain: false });
    expect(errorKey(await players[0].emit('lobby:setTimer', { timer: null }))).toBe('notInLobby');
    expect(errorKey(await players[0].emit('lobby:setMode', { mode: 'standard' }))).toBe('notInLobby');
  });

  it('starts the game with the chosen target and limits, and keeps them for the next game in the room', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    const { players, code } = await timedRoom(url, server, 3, { mode: 'custom', targetScore: 6, toMain: false });
    const g = stateOf(server, code);
    expect(g).toMatchObject({ mode: 'custom', vpToWin: 6, timer: TIMER, gameStartedAt: T0, turnStartedAt: null });
    const snap = await players[1].until('game:snapshot');
    expect(snap.view).toMatchObject({ vpToWin: 6, timer: TIMER, winners: [] });
    expect(snap.timerClock).toEqual({ turnRemainingMs: null, gameRemainingMs: 1800 * SEC });
    expect(snap.view.turnStartedAt).toBeUndefined();
  });
});

describe('the clock of a timed game', () => {
  it('ends a turn on its own when the time is up, tells everyone, and starts the next turn\'s clock', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    const { players, code } = await timedRoom(url, server, 3, {});
    const first = stateOf(server, code).current;
    const mark = players.map((p) => p.mark());

    clock.t = T0 + 59_999;
    server.tick();
    expect(stateOf(server, code).current).toBe(first);

    clock.t = T0 + 60 * SEC;
    server.tick();
    const after = stateOf(server, code);
    expect(after.current).not.toBe(first);
    expect(after.turnStartedAt).toBe(T0 + 60 * SEC);
    for (let i = 0; i < players.length; i++) {
      const upd = await players[i].until('game:update', (u: any) => u.events.some((e: any) => e.type === 'turnTimedOut'), mark[i]);
      expect(upd.events[0]).toEqual({ type: 'turnTimedOut', player: first });
      expect(upd.view.current).toBe(after.current);
      expect(upd.timerClock).toEqual({ turnRemainingMs: 60 * SEC, gameRemainingMs: (1800 - 60) * SEC });
    }
    // ticking again at the same moment does nothing more
    server.tick();
    expect(stateOf(server, code).turn).toBe(after.turn);
  });

  it('gives the figures of the server\'s clock to a player who comes back, whatever their own clock says', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    const { players } = await timedRoom(url, server, 2, {});
    clock.t = T0 + 25 * SEC;
    const again = await TestClient.login(url, players[1].token);
    const snap = await again.until('game:snapshot');
    expect(snap.timerClock).toEqual({ turnRemainingMs: 35 * SEC, gameRemainingMs: (1800 - 25) * SEC });
  });

  it('ends the game when the game time is up: everyone level on the top score wins together', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    const { players, code } = await timedRoom(url, server, 3, {});
    const mark = players.map((p) => p.mark());
    server.store.update(code, (r) => {
      // p0 and p1 each own a settlement: level at the top; p2 has nothing
      const g = r.game!;
      g.buildings[0] = { owner: g.players[0].id, kind: 'settlement' };
      g.buildings[20] = { owner: g.players[1].id, kind: 'settlement' };
    });
    clock.t = T0 + 1800 * SEC;
    server.tick();
    const g = stateOf(server, code);
    expect(g.phase).toBe('finished');
    expect(g.winners).toEqual([g.players[0].id, g.players[1].id]);
    expect(server.store.get(code)!.phase).toBe('finished');
    expect(server.store.get(code)!.endedAt).toBe(clock.t);
    for (let i = 0; i < players.length; i++) {
      const upd = await players[i].until('game:update', (u: any) => u.view.phase === 'finished', mark[i]);
      expect(upd.view.winners).toEqual(g.winners);
      expect(upd.events).toEqual([{ type: 'gameWon', players: g.winners, points: 1, reason: 'time' }]);
      expect(upd.timerClock).toBeNull();
      expect((await players[i].until('lobby:update', (l: any) => l.phase === 'finished', mark[i])).phase).toBe('finished');
    }
    // a game that is over stays over, whatever time it is
    clock.t += 10_000 * SEC;
    server.tick();
    expect(stateOf(server, code).winners).toEqual(g.winners);
  });

  it('leaves an untimed game completely alone, however late it gets', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    const { code } = await timedRoom(url, server, 3, { timer: null });
    const before = JSON.stringify(stateOf(server, code));
    expect(stateOf(server, code)).toMatchObject({ timer: null, gameStartedAt: null, turnStartedAt: null });
    expect(server.service.timedRoomCount()).toBe(0);
    clock.t += 100_000 * SEC;
    server.tick();
    expect(JSON.stringify(stateOf(server, code))).toBe(before);
  });
});

describe('several timed rooms at once', () => {
  it('keeps their clocks apart: a room whose time is up moves, the other does not', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    const a = await timedRoom(url, server, 2, { now: T0 });
    clock.t = T0 + 30 * SEC;
    const b = await timedRoom(url, server, 2, { now: T0 + 30 * SEC });
    expect(server.service.timedRoomCount()).toBe(2);
    const aBefore = stateOf(server, a.code).current;
    const bBefore = stateOf(server, b.code).current;

    clock.t = T0 + 60 * SEC; // A's turn is up (60 s), B has had 30 s
    server.tick();
    expect(stateOf(server, a.code).current).not.toBe(aBefore);
    expect(stateOf(server, b.code).current).toBe(bBefore);
    expect(stateOf(server, a.code).turnStartedAt).toBe(T0 + 60 * SEC);
    expect(stateOf(server, b.code).turnStartedAt).toBe(T0 + 30 * SEC);

    clock.t = T0 + 90 * SEC; // now B's turn is up, and A (reset at 60 s) has had 30 s
    const aTurn = stateOf(server, a.code).turn;
    server.tick();
    expect(stateOf(server, b.code).current).not.toBe(bBefore);
    expect(stateOf(server, a.code).turn).toBe(aTurn);
    // players of one room never hear about the other room's timeout
    expect(a.players[0].messages('game:update').some((u: any) => u.events.some((e: any) => e.type === 'turnTimedOut' && e.player === bBefore))).toBe(false);
  });

  it('lets one room finish by time while the other goes on', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    const a = await timedRoom(url, server, 2, { timer: { turnSeconds: 180, gameSeconds: 1800 }, now: T0 });
    clock.t = T0 + 1000 * SEC;
    const b = await timedRoom(url, server, 2, { timer: { turnSeconds: 180, gameSeconds: 1800 }, now: T0 + 1000 * SEC });
    clock.t = T0 + 1800 * SEC;
    server.tick();
    expect(stateOf(server, a.code).phase).toBe('finished');
    expect(stateOf(server, b.code).phase).not.toBe('finished'); // (its own turn limit ran out meanwhile, which only passes the turn on)
    expect(server.service.timedRoomCount()).toBe(1);
    clock.t = T0 + 2800 * SEC;
    server.tick();
    expect(stateOf(server, b.code).phase).toBe('finished');
    expect(server.service.timedRoomCount()).toBe(0);
  });
});

describe('the timer\'s watch over rooms does not leak', () => {
  it('drops a room when its game ends by the time limit', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now });
    await timedRoom(url, server, 2, {});
    expect(server.service.timedRoomCount()).toBe(1);
    clock.t = T0 + 1800 * SEC;
    server.tick();
    expect(server.service.timedRoomCount()).toBe(0);
  });

  it('drops a room when its game ends the normal way, by a player reaching the target', async () => {
    const clock = fakeClock();
    // a low target so the bots finish quickly; the clock never moves, so nothing times out on the way
    const base = { port: 0, corsOrigins: ['*'], secret: 's', clientDir: null, testSeed: null, testResources: null, testCreateLimit: null, testTurnSeconds: null, testGameSeconds: null };
    const { server, url } = await startServer({ now: clock.now, config: { ...base, testVp: 3 } });
    const { players, code } = await timedRoom(url, server, 3, { toMain: false });
    expect(server.service.timedRoomCount()).toBe(1);
    await playOut(server, code, players, 21, { maxSteps: 6000 });
    const g = stateOf(server, code);
    expect(g.phase).toBe('finished');
    expect(g.winners).toHaveLength(1);
    expect(g.timer).toEqual(TIMER);
    expect(server.store.get(code)!.phase).toBe('finished');
    // the room left the timer's watch the moment the game ended, not at the next look
    expect(server.service.timedRoomCount()).toBe(0);
    // and a later tick, even long after the limits, changes nothing
    const frozen = JSON.stringify(g);
    clock.t += 100_000 * SEC;
    server.tick();
    expect(JSON.stringify(stateOf(server, code))).toBe(frozen);
    expect(server.service.timedRoomCount()).toBe(0);
  });

  it('drops a room that is swept away once everyone has left', async () => {
    const clock = fakeClock();
    const store = new MemoryRoomStore();
    const { server, url } = await startServer({ now: clock.now, store, roomIdleMs: 1000 });
    const { players, code } = await timedRoom(url, server, 2, {});
    expect(server.service.timedRoomCount()).toBe(1);
    for (const p of players) p.socket.close();
    await settle();
    clock.t += 5 * SEC;
    expect(server.sweep()).toEqual([code]);
    expect(store.has(code)).toBe(false);
    expect(server.service.timedRoomCount()).toBe(0);
    server.tick(); // a watch over a vanished room must not throw
  });

  it('stops looking when the server closes: the real interval fires while open and not after', async () => {
    const clock = fakeClock();
    const { server, url } = await startServer({ now: clock.now, timerTickMs: 10 });
    const { code } = await timedRoom(url, server, 2, {});
    const first = stateOf(server, code).current;
    clock.t = T0 + 60 * SEC;
    await settle(120); // the interval, with nobody calling tick, finds the turn is up
    expect(stateOf(server, code).current).not.toBe(first);

    const turn = stateOf(server, code).turn;
    const room = server.store.get(code)!;
    await server.close();
    clock.t += 1000 * SEC;
    await settle(120);
    expect(room.game!.turn).toBe(turn);
  });
});
