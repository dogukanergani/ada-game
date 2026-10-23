import { describe, expect, it } from 'vitest';
import { TestClient, startServer } from './harness';
import { playOut, stateOf } from './gameplay';

const MIN = 60_000;

/** The game clock belongs to the server: the time comes from its own clock (injected here), and a client that reconnects is told the true figure. */
describe('the game clock', () => {
  it('counts from the start of the game on the server\'s clock, survives a reconnect, and stands still once the game is over', async () => {
    let t = 1_000_000;
    const { server, url } = await startServer({ now: () => t });
    const players: TestClient[] = [];
    for (let i = 0; i < 3; i++) players.push(await TestClient.login(url));
    const { code } = await players[0].emit('room:create', { name: 'P0' });
    for (let i = 1; i < 3; i++) await players[i].emit('room:join', { code, name: `P${i}` });
    await players[0].emit('lobby:setMode', { mode: 'short' });

    t += 30 * MIN; // time in the lobby does not count
    expect(await players[0].emit('lobby:start')).toEqual({ ok: true });
    const first = (await players[1].until('game:snapshot')) as any;
    expect(first.clock).toEqual({ elapsedMs: 0, running: true });

    // twelve minutes later a player comes back (a refresh): the snapshot carries the real figure, not a fresh start
    t += 12 * MIN + 20_000;
    const again = await TestClient.login(url, players[1].token);
    const snap = (await again.until('game:snapshot')) as any;
    expect(snap.clock).toEqual({ elapsedMs: 12 * MIN + 20_000, running: true });

    // play on to the end with time moving once, then check it stopped
    t += 5 * MIN;
    const bots = [players[0], again, players[2]];
    await playOut(server, code, bots, 77, { maxSteps: 6000 });
    expect(stateOf(server, code).phase).toBe('finished');
    const endedAt = server.store.get(code)!.endedAt!;
    expect(endedAt).toBe(t);

    t += 40 * MIN;
    const after = await TestClient.login(url, players[2].token);
    const done = (await after.until('game:snapshot')) as any;
    expect(done.clock).toEqual({ elapsedMs: endedAt - server.store.get(code)!.startedAt!, running: false });
    expect(done.clock.elapsedMs).toBe(17 * MIN + 20_000);
  }, 60_000);

  it('a new game in the same room starts from zero', async () => {
    let t = 5_000;
    const { server, url } = await startServer({ now: () => t });
    const players: TestClient[] = [];
    for (let i = 0; i < 2; i++) players.push(await TestClient.login(url));
    const { code } = await players[0].emit('room:create', { name: 'P0' });
    await players[1].emit('room:join', { code, name: 'P1' });
    await players[0].emit('lobby:setMode', { mode: 'short' });
    await players[0].emit('lobby:start');
    t += 9 * MIN;
    await playOut(server, code, players, 5, { maxSteps: 6000 });
    expect(await players[0].emit('lobby:reset')).toEqual({ ok: true });
    expect(server.store.get(code)!.startedAt).toBeNull();
    t += 3 * MIN;
    await players[0].emit('lobby:start');
    const snap = (await players[1].until('game:snapshot', (s: any) => s.clock.elapsedMs === 0)) as any;
    expect(snap.clock).toEqual({ elapsedMs: 0, running: true });
  }, 60_000);
});
