import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@ada/protocol';
import { MemoryRoomStore } from '../src/rooms/memoryStore';
import { TestClient, settle, startServer } from './harness';

/** Two logged-in players, `a` hosting a room. */
async function lobbyOf(n = 2, opts: Parameters<typeof startServer>[0] = {}) {
  const { server, url } = await startServer(opts);
  const players: TestClient[] = [];
  for (let i = 0; i < n; i++) players.push(await TestClient.login(url));
  const created = await players[0].emit('room:create', { name: 'Ada' });
  expect(created).toMatchObject({ ok: true });
  const code: string = created.code;
  for (let i = 1; i < n; i++) expect(await players[i].emit('room:join', { code, name: `P${i}` })).toMatchObject({ ok: true, code });
  return { server, url, players, code };
}

const errorKey = (r: any) => r?.error?.key;

describe('identity', () => {
  it('issues an id and token; the same token brings the same player back; a forged one gets a new identity', async () => {
    const { url } = await startServer();
    const a = await TestClient.login(url);
    expect(a.playerId).toMatch(/^[0-9a-f-]{36}$/);
    const again = await TestClient.login(url, a.token);
    expect(again.playerId).toBe(a.playerId);
    const forged = await TestClient.login(url, `${a.playerId}.forged`);
    expect(forged.playerId).not.toBe(a.playerId);
  });

  it('refuses room messages before hello', async () => {
    const { url } = await startServer();
    const c = await TestClient.open(url);
    expect(errorKey(await c.emit('room:create', { name: 'X' }))).toBe('noIdentity');
    expect(errorKey(await c.emit('game:action', { type: 'roll' }))).toBe('noIdentity');
  });

  it('a second connection with the same identity replaces the first', async () => {
    const { url } = await startServer();
    const a = await TestClient.login(url);
    const a2 = await TestClient.login(url, a.token);
    await a.until('replaced');
    await a.closed();
    expect(await a2.emit('room:create', { name: 'A' })).toMatchObject({ ok: true });
  });
});

describe('rooms and lobby', () => {
  it('creates a room, others join with the code, everyone sees the lobby', async () => {
    const { players, code } = await lobbyOf(3);
    expect(code).toMatch(/^[A-Z]{4}$/);
    const lobby = await players[2].until('lobby:update', (l: any) => l.players.length === 3);
    expect(lobby).toMatchObject({ code, me: players[2].playerId, hostId: players[0].playerId, mode: 'standard', phase: 'lobby' });
    expect(lobby.players.map((p: any) => p.name)).toEqual(['Ada', 'P1', 'P2']);
    expect(lobby.players.filter((p: any) => p.host)).toHaveLength(1);
    const first = await players[0].until('lobby:update', (l: any) => l.players.length === 3);
    expect(first.me).toBe(players[0].playerId);
  });

  it('join is case-insensitive; unknown and malformed codes are refused', async () => {
    const { url } = await startServer();
    const host = await TestClient.login(url);
    const { code } = await host.emit('room:create', { name: 'H' });
    const other = await TestClient.login(url);
    expect(errorKey(await other.emit('room:join', { code: 'ZZZZ', name: 'X' }))).toBe('roomNotFound');
    expect(errorKey(await other.emit('room:join', { code: 'abc', name: 'X' }))).toBe('roomNotFound');
    expect(errorKey(await other.emit('room:join', { code, name: '' }))).toBe('badName');
    expect(await other.emit('room:join', { code: code.toLowerCase(), name: 'X' })).toMatchObject({ ok: true, code });
  });

  it('a sixth player is refused; one player cannot be in two rooms', async () => {
    const { url, players, code } = await lobbyOf(5);
    const sixth = await TestClient.login(url);
    expect(errorKey(await sixth.emit('room:join', { code, name: 'Six' }))).toBe('roomFull');
    expect(errorKey(await players[1].emit('room:create', { name: 'again' }))).toBe('alreadyInRoom');
  });

  it('two players cannot hold the same role; a taken role frees up when its owner changes', async () => {
    const { players } = await lobbyOf(2);
    const [a, b] = players;
    expect(await a.emit('lobby:setRole', { role: 'sage' })).toMatchObject({ ok: true });
    expect(errorKey(await b.emit('lobby:setRole', { role: 'sage' }))).toBe('roleTaken');
    expect(errorKey(await b.emit('lobby:setRole', { role: 'nope' }))).toBe('unknownRole');
    expect(await a.emit('lobby:setRole', { role: 'sailor' })).toMatchObject({ ok: true });
    expect(await b.emit('lobby:setRole', { role: 'sage' })).toMatchObject({ ok: true });
    const lobby = await a.until('lobby:update', (l: any) => l.players.find((p: any) => p.role === 'sage')?.name === 'P1');
    expect(lobby.players.map((p: any) => p.role)).toEqual(['sailor', 'sage']);
  });

  it('only the host sets the mode, starts or resets', async () => {
    const { players } = await lobbyOf(2);
    const [host, guest] = players;
    expect(errorKey(await guest.emit('lobby:setMode', { mode: 'short' }))).toBe('notHost');
    expect(errorKey(await guest.emit('lobby:start'))).toBe('notHost');
    expect(errorKey(await guest.emit('lobby:reset'))).toBe('notHost');
    expect(await host.emit('lobby:setMode', { mode: 'short' })).toMatchObject({ ok: true });
    const l = await guest.until('lobby:update', (x: any) => x.mode === 'short');
    expect(l.mode).toBe('short');
    expect(errorKey(await host.emit('lobby:reset'))).toBe('gameNotFinished');
  });

  it('cannot start alone', async () => {
    const { url } = await startServer();
    const host = await TestClient.login(url);
    await host.emit('room:create', { name: 'H' });
    expect(errorKey(await host.emit('lobby:start'))).toBe('needMorePlayers');
  });

  it('the host role passes on when the host leaves, and when the host drops', async () => {
    const { players } = await lobbyOf(3);
    const [a, b, c] = players;
    const mark = b.mark();
    expect(await a.emit('room:leave')).toMatchObject({ ok: true });
    const l = await b.until('lobby:update', (x: any) => x.players.length === 2, mark);
    expect(l.hostId).toBe(b.playerId);
    const mark2 = c.mark();
    b.socket.close();
    const l2 = await c.until('lobby:update', (x: any) => x.hostId === c.playerId, mark2);
    expect(l2.players.find((p: any) => p.id === b.playerId).connected).toBe(false);
  });
});

describe('starting and the game', () => {
  it('start deals each player their own snapshot; roles not chosen are filled in', async () => {
    const { players } = await lobbyOf(3);
    const [a, b, c] = players;
    await a.emit('lobby:setRole', { role: 'sage' });
    expect(await a.emit('lobby:setMode', { mode: 'short' })).toMatchObject({ ok: true });
    expect(await a.emit('lobby:start')).toMatchObject({ ok: true });
    for (const p of players) {
      const snap = await p.until('game:snapshot');
      expect(snap.view.me).toBe(p.playerId);
      expect(snap.view.mode).toBe('short');
      expect(snap.view.players).toHaveLength(3);
      expect(snap.events).toEqual([]);
    }
    const view = (await b.until('game:snapshot')).view;
    const roles = view.players.map((p: any) => p.role);
    expect(new Set(roles).size).toBe(3);
    expect(view.players.find((p: any) => p.id === a.playerId).role).toBe('sage');
    const lobby = await c.until('lobby:update', (l: any) => l.phase === 'playing');
    expect(lobby.players.every((p: any) => p.role)).toBe(true);
  });

  it('a new player cannot join once the game started, and lobby settings are closed', async () => {
    const { url, players, code } = await lobbyOf(2);
    await players[0].emit('lobby:start');
    const late = await TestClient.login(url);
    expect(errorKey(await late.emit('room:join', { code, name: 'Late' }))).toBe('gameStarted');
    expect(errorKey(await players[0].emit('lobby:setMode', { mode: 'short' }))).toBe('notInLobby');
    expect(errorKey(await players[1].emit('lobby:setRole', { role: 'sage' }))).toBe('notInLobby');
    expect(errorKey(await players[0].emit('lobby:start'))).toBe('notInLobby');
  });

  it('refusals from the core come back as a key and values, never text', async () => {
    const { players } = await lobbyOf(2);
    await players[0].emit('lobby:start');
    const snap = await players[0].until('game:snapshot');
    const notMine = snap.view.players.find((p: any) => p.id !== snap.view.current).id;
    const wrong = players.find((p) => p.playerId === notMine)!;
    const r = await wrong.emit('game:action', { type: 'roll' });
    expect(r).toMatchObject({ ok: false, error: { key: 'game', error: { type: 'notYourTurn' } } });
    const r2 = await players[0].emit('game:action', { type: 'placeSettlement', vertex: 99999 });
    expect(r2.ok).toBe(false);
    expect(r2.error.key).toBe('game');
    expect(typeof r2.error.error.type).toBe('string');
  });

  it('game:action outside a game is refused', async () => {
    const { players } = await lobbyOf(2);
    expect(errorKey(await players[0].emit('game:action', { type: 'roll' }))).toBe('notInGame');
    const { url } = await startServer();
    const lone = await TestClient.login(url);
    expect(errorKey(await lone.emit('game:action', { type: 'roll' }))).toBe('notInRoom');
  });
});

describe('reconnecting', () => {
  it('a dropped player is reported, the game goes on, and the same identity brings them back with a fresh snapshot', async () => {
    const { url, players, code } = await lobbyOf(2);
    const [a, b] = players;
    await a.emit('lobby:start');
    await b.until('game:snapshot');
    const mark = a.mark();
    b.socket.close();
    const gone = await a.until('presence', (n: any) => n.type === 'playerDisconnected', mark);
    expect(gone.player).toBe(b.playerId);
    const l = await a.until('lobby:update', (x: any) => x.players.find((p: any) => p.id === b.playerId)?.connected === false, mark);
    expect(l.phase).toBe('playing');

    // page refresh: new socket, same token
    const mark2 = a.mark();
    const b2 = await TestClient.login(url, b.token);
    expect(b2.playerId).toBe(b.playerId);
    const snap = await b2.until('game:snapshot');
    expect(snap.view.me).toBe(b.playerId);
    const back = await a.until('presence', (n: any) => n.type === 'playerReconnected', mark2);
    expect(back.player).toBe(b.playerId);
    const lobby = await b2.until('lobby:update');
    expect(lobby.code).toBe(code);
    // and they can act again
    const act = await b2.emit('game:action', { type: 'roll' });
    expect(act.ok === true || act.error.key === 'game').toBe(true);
  });

  it('hello tells a returning player which room they belong to', async () => {
    const { url, players, code } = await lobbyOf(2);
    players[1].socket.close();
    await settle();
    const again = await TestClient.open(url);
    const r = await again.emit('identity:hello', { token: players[1].token, protocolVersion: PROTOCOL_VERSION });
    expect(r).toMatchObject({ ok: true, playerId: players[1].playerId, room: code });
  });

  it('leaving a started game keeps the seat; the player can come back with the code and may join other rooms meanwhile', async () => {
    const { url, players, code } = await lobbyOf(2);
    await players[0].emit('lobby:start');
    expect(await players[1].emit('room:leave')).toMatchObject({ ok: true });
    const other = await TestClient.login(url, players[1].token).catch(() => players[1]);
    expect(await other.emit('room:create', { name: 'Elsewhere' })).toMatchObject({ ok: true });
    expect(errorKey(await other.emit('room:join', { code, name: 'Back' }))).toBe('alreadyInRoom');
    await other.emit('room:leave');
    expect(await other.emit('room:join', { code, name: 'Back' })).toMatchObject({ ok: true, code });
    await other.until('game:snapshot');
  });
});

describe('room lifetime', () => {
  it('a room is deleted 3 hours after everyone left, not before, and returning resets the clock', async () => {
    let now = 1_000_000;
    const store = new MemoryRoomStore();
    const { server, url } = await startServer({ now: () => now, store });
    const a = await TestClient.login(url);
    const { code } = await a.emit('room:create', { name: 'A' });
    a.socket.close();
    await settle();
    expect(store.get(code)!.emptySince).toBe(now);
    now += 3 * 3600_000 - 1;
    expect(server.sweep()).toEqual([]);
    const a2 = await TestClient.login(url, a.token);
    await settle();
    expect(store.get(code)!.emptySince).toBeNull();
    a2.socket.close();
    await settle();
    now += 10;
    expect(server.sweep()).toEqual([]);
    now += 3 * 3600_000;
    expect(server.sweep()).toEqual([code]);
    expect(store.has(code)).toBe(false);
    const c = await TestClient.login(url);
    expect(errorKey(await c.emit('room:join', { code, name: 'X' }))).toBe('roomNotFound');
  });
});

describe('malformed and abusive input', () => {
  const junk: unknown[] = [undefined, null, 0, 'str', [], [1, 2], {}, { name: 5 }, { name: ['x'] }, { name: 'x'.repeat(5000) }, { code: {}, name: {} }];

  it('never takes the server down, and answers with a key', async () => {
    const { url, players } = await lobbyOf(2);
    const c = players[0];
    const events = ['room:create', 'room:join', 'lobby:setName', 'lobby:setRole', 'lobby:setMode', 'game:action', 'identity:hello'];
    for (const ev of events) {
      for (const j of junk) {
        const r = await c.emit(ev, j);
        if (r.ok === true) continue; // some junk is legitimately accepted (for example hello without a token)
        expect(typeof r.error.key).toBe('string');
      }
    }
    // still healthy
    const fresh = await TestClient.login(url);
    expect(await fresh.emit('room:create', { name: 'Still alive' })).toMatchObject({ ok: true });
  });

  it('rejects a table of broken actions with badPayload', async () => {
    const { players } = await lobbyOf(2);
    await players[0].emit('lobby:start');
    const bad: unknown[] = [
      { type: 'placeRoad' }, { type: 'placeRoad', edge: '3' }, { type: 'placeRoad', edge: -1 }, { type: 'placeRoad', edge: 1.5 },
      { type: 'bankTrade', give: 'gold', get: 'ore' }, { type: 'discard', resources: { ore: -1 } }, { type: 'discard', resources: { gold: 1 } },
      { type: 'discard', resources: [1] }, { type: 'steal', victim: 5 }, { type: 'nonsense' }, { type: 5 }, { type: 'roleAction' },
      { type: 'roleAction', name: 'capture', params: 'x' }, { type: 'roleAction', name: 'x'.repeat(100) }, { type: 'acceptTrade', offerId: 'a' },
    ];
    for (const a of bad) {
      const r = await players[0].emit('game:action', a);
      expect(errorKey(r), JSON.stringify(a)).toBe('badPayload');
    }
  });

  it('unknown events are answered, and events without an ack are survived', async () => {
    const { url, players } = await lobbyOf(2);
    const c = players[0];
    expect(errorKey(await c.emit('not:an:event', { a: 1 }))).toBe('unknownEvent');
    c.socket.emit('room:leave');
    c.socket.emit('game:action', { type: 'roll' });
    c.socket.emit('lobby:setMode');
    c.socket.emit('room:create', 'oops', 'extra', 'args');
    await settle();
    const fresh = await TestClient.login(url);
    expect(await fresh.emit('room:create', { name: 'ok' })).toMatchObject({ ok: true });
  });

  it('an oversized message drops that connection only', async () => {
    const { url, players } = await lobbyOf(2);
    players[0].socket.emit('lobby:setName', { name: 'x'.repeat(200_000) });
    await players[0].closed();
    const fresh = await TestClient.login(url);
    expect(await fresh.emit('room:create', { name: 'ok' })).toMatchObject({ ok: true });
    expect(players[1].socket.connected).toBe(true);
  });

  it('flooding a connection gets rateLimited, and persistent flooding gets it dropped', async () => {
    const { url } = await startServer({ rateLimit: { capacity: 5, perSecond: 0.0001 }, dropAfterLimited: 8 });
    const c = await TestClient.login(url);
    const results: any[] = [];
    for (let i = 0; i < 8; i++) results.push(await c.emit('lobby:setMode', { mode: 'short' }).catch(() => null));
    expect(results.filter((r) => errorKey(r) === 'rateLimited').length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 20; i++) c.socket.emit('lobby:setMode', { mode: 'short' });
    await c.closed();
    // another connection is unaffected
    const other = await TestClient.login(url);
    expect(other.playerId).toBeTruthy();
  });

  it('limits how fast one address can create rooms', async () => {
    const { url } = await startServer({ createLimit: { capacity: 2, perSecond: 0.0001 } });
    const keys: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await TestClient.login(url);
      const r = await c.emit('room:create', { name: `P${i}` });
      keys.push(r.ok ? 'ok' : errorKey(r));
    }
    expect(keys).toEqual(['ok', 'ok', 'rateLimited', 'rateLimited']);
  });
});

describe('game:legal', () => {
  it('tells a player their own options, only when a game runs, and matches the core', async () => {
    const { server, players, code } = await lobbyOf(2);
    expect(errorKey(await players[0].emit('game:legal'))).toBe('notInGame');
    await players[0].emit('lobby:start');
    const snap = await players[0].until('game:snapshot');
    const mover = players.find((p) => p.playerId === snap.view.current)!;
    const other = players.find((p) => p !== mover)!;
    const mine = await mover.emit('game:legal');
    expect(mine.ok).toBe(true);
    expect(mine.legal.phase).toBe('setup');
    expect(mine.legal.settlements.length).toBeGreaterThan(0);
    const theirs = await other.emit('game:legal');
    expect(theirs.legal.settlements).toEqual([]);
    expect(theirs.legal.canRoll).toBe(false);
    const { legalMovesFor } = await import('@ada/game-core');
    expect(mine.legal).toEqual(legalMovesFor(server.store.get(code)!.game!, mover.playerId));
    // a legal move is accepted
    const ok = await mover.emit('game:action', { type: 'placeSettlement', vertex: mine.legal.settlements[0] });
    expect(ok).toEqual({ ok: true });
    const { url } = await startServer();
    const stranger = await TestClient.login(url);
    expect(errorKey(await stranger.emit('game:legal'))).toBe('notInRoom');
  });
});
