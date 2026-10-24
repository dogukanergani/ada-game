import { describe, expect, it } from 'vitest';
import { viewFor } from '@ada/game-core';
import { TestClient } from './harness';
import { assertNoLeak, playOut as play, setup, stateOf, type Setup } from './gameplay';

/** Whole games over real sockets; every move travels as a game:action message and every message is leak-checked. */
async function playOut(server: Setup['server'], code: string, players: TestClient[], seed: number, maxSteps = 6000) {
  const r = await play(server, code, players, seed, { maxSteps, inspect: assertNoLeak });
  return r.steps;
}

describe('whole games over real sockets (short mode)', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`${n} players play from the lobby to a winner, and nothing secret leaks on the way`, async () => {
      const { server, players, code } = await setup(n, 'short');
      expect(await players[0].emit('lobby:start')).toEqual({ ok: true });
      for (const p of players) await p.until('game:snapshot');

      const steps = await playOut(server, code, players, 1000 + n);
      const final = stateOf(server, code);
      expect(final.phase, `unfinished after ${steps} steps`).toBe('finished');
      expect(final.winners).toHaveLength(1);

      // everyone is told, and the finished game opens the hidden cards
      for (const p of players) {
        const upd = (await p.until('game:update', (u: any) => u.view.phase === 'finished')) as any;
        expect(upd.view.winners).toEqual(final.winners);
        expect(upd.events.some((e: any) => e.type === 'gameWon')).toBe(true);
        expect(upd.view.players.every((q: any) => q.hand !== null)).toBe(true);
        const lobby = await p.until('lobby:update', (l: any) => l.phase === 'finished');
        expect(lobby.phase).toBe('finished');
      }

      // the game is over: moves are refused, only the host may go back to the lobby
      const loser = players.find((p) => !final.winners.includes(p.playerId))!;
      expect((await loser.emit('game:action', { type: 'endTurn' })).error.key).toBe('notInGame');
      expect((await players[1].emit('lobby:reset')).error.key).toBe('notHost');
      const mark = players[1].mark();
      expect(await players[0].emit('lobby:reset')).toEqual({ ok: true });
      const lobby = await players[1].until('lobby:update', (l: any) => l.phase === 'lobby', mark);
      expect(lobby.players).toHaveLength(n);
      expect(lobby.players.every((q: any) => q.role)).toBe(true);
    }, 120_000);
  }

  it('a finished room can start a second game', async () => {
    const { server, players, code } = await setup(2, 'short');
    await players[0].emit('lobby:start');
    await playOut(server, code, players, 77);
    await players[0].emit('lobby:reset');
    const mark = players[1].mark();
    expect(await players[0].emit('lobby:start')).toEqual({ ok: true });
    const snap = await players[1].until('game:snapshot', () => true, mark);
    expect(snap.view.phase).toBe('setup');
    expect(snap.view.winners).toEqual([]);
  }, 120_000);

  it('a player who drops mid-game and returns can finish the game', async () => {
    const { server, url, players, code } = await setup(3, 'short');
    await players[0].emit('lobby:start');
    await playOut(server, code, players, 5, 30);
    const dropped = players[2];
    dropped.socket.close();
    const back = await TestClient.login(url, dropped.token);
    players[2] = back;
    const snap = await back.until('game:snapshot');
    expect(JSON.stringify(snap.view)).toBe(JSON.stringify(viewFor(stateOf(server, code), back.playerId)));
    await playOut(server, code, players, 6);
    expect(stateOf(server, code).phase).toBe('finished');
  }, 120_000);
});
