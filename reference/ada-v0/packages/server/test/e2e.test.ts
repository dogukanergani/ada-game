import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { legalRoadEdges, legalSettlementVertices, type Action, type GameView, type LobbyInfo } from '@ada/game-core';
import { createAppServer } from '../src/server';

const app = createAppServer();
let url = '';

beforeAll(async () => {
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
});

class Client {
  socket: Socket;
  lobby: LobbyInfo | null = null;
  game: GameView | null = null;
  constructor(public id: string, public name: string) {
    this.socket = connect(url, { transports: ['websocket'], forceNew: true });
    this.socket.on('lobby:update', (l) => (this.lobby = l));
    this.socket.on('game:state', (g) => (this.game = g));
  }
  emit<T = any>(ev: string, payload?: unknown): Promise<{ ok: boolean; error?: string } & T> {
    return new Promise((res) => this.socket.emit(ev, payload, res));
  }
  create() { return this.emit<{ code: string }>('room:create', { name: this.name, playerId: this.id }); }
  join(code: string) { return this.emit('room:join', { code, name: this.name, playerId: this.id }); }
  act(a: Action) { return this.emit('game:action', a); }
  async settle() { await new Promise((r) => setTimeout(r, 60)); }
  close() { this.socket.close(); }
}

const id = (n: string) => `${n}-abcdefgh`;

describe('rooms and lobby', () => {
  it('creates, joins, picks unique roles and starts', async () => {
    const a = new Client(id('a'), 'Ada');
    const b = new Client(id('b'), 'Bora');
    const created = await a.create();
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^[A-Z]{4}$/);

    expect((await b.join('ZZZZ')).ok).toBe(false);
    expect((await b.join(created.code.toLowerCase())).ok).toBe(true);
    expect((await new Client(id('c'), 'Bora').join(created.code)).error).toContain('isim');

    expect((await a.emit('lobby:setRole', { role: 'merchant' })).ok).toBe(true);
    expect((await b.emit('lobby:setRole', { role: 'merchant' })).ok).toBe(false);
    expect((await b.emit('lobby:setRole', { role: 'nope' })).ok).toBe(false);
    expect((await b.emit('lobby:setRole', { role: 'hunter' })).ok).toBe(true);
    await a.settle();
    expect(a.lobby!.players.map((p) => p.role)).toEqual(['merchant', 'hunter']);

    expect((await b.emit('lobby:start')).error).toContain('sahibi');
    expect((await a.emit('lobby:start')).ok).toBe(true);
    await a.settle();
    expect(a.lobby!.started).toBe(true);
    expect(a.game!.phase).toBe('setup');
    a.close(); b.close();
  });

  it('rejects late joiners and a full room', async () => {
    const host = new Client(id('h'), 'Host');
    const { code } = await host.create();
    const others = [1, 2, 3].map((i) => new Client(id(`o${i}`), `P${i}`));
    for (const o of others) expect((await o.join(code)).ok).toBe(true);
    const extra = new Client(id('x'), 'Fazla');
    expect((await extra.join(code)).error).toBe('Oda dolu.');
    await host.emit('lobby:start');
    const late = new Client(id('late'), 'Geç');
    expect((await late.join(code)).ok).toBe(false);
    [host, extra, late, ...others].forEach((c) => c.close());
  });
});

describe('a game over the wire', () => {
  it('plays the setup phase, hides hands, enforces turns and survives a reconnect', async () => {
    const a = new Client(id('pa'), 'Ada');
    const b = new Client(id('pb'), 'Bora');
    const { code } = await a.create();
    await b.join(code);
    await a.emit('lobby:start');
    await a.settle();

    const byId = new Map([[a.id, a], [b.id, b]]);
    const turnOwner = () => byId.get(a.game!.current)!;
    const waiting = () => (turnOwner() === a ? b : a);

    // out-of-turn action is refused
    expect((await waiting().act({ type: 'placeSettlement', vertex: 0 })).ok).toBe(false);

    for (let guard = 0; guard < 20 && a.game!.phase === 'setup'; guard++) {
      const c = turnOwner();
      const g = c.game!;
      const action: Action =
        g.setup!.step === 'settlement'
          ? { type: 'placeSettlement', vertex: legalSettlementVertices(g, c.id)[0] }
          : { type: 'placeRoad', edge: legalRoadEdges(g, c.id)[0] };
      expect((await c.act(action)).ok).toBe(true);
      await a.settle();
    }
    expect(a.game!.phase).toBe('roll');

    // each client only sees its own hand
    const second = a.game!.players.find((p) => p.id === a.id)!;
    expect(second.resources).not.toBeNull();
    expect(a.game!.players.find((p) => p.id === b.id)!.resources).toBeNull();
    expect(b.game!.players.find((p) => p.id === a.id)!.resources).toBeNull();

    // roll, then someone reconnects mid-game with the same player id
    const roller = turnOwner();
    expect((await roller.act({ type: 'roll' })).ok).toBe(true);
    await a.settle();
    expect(['main', 'discard', 'robber']).toContain(a.game!.phase);

    b.close();
    const b2 = new Client(b.id, 'Bora');
    expect((await b2.join(code)).ok).toBe(true);
    await b2.settle();
    expect(b2.game!.phase).toBe(a.game!.phase);
    expect(b2.game!.players.find((p) => p.id === b.id)!.resources).not.toBeNull();
    a.close(); b2.close();
  });

  it('ignores garbage payloads without crashing', async () => {
    const a = new Client(id('ga'), 'Ada');
    const b = new Client(id('gb'), 'Bora');
    const { code } = await a.create();
    await b.join(code);
    await a.emit('lobby:start');
    for (const junk of [null, undefined, 5, 'x', {}, { type: 'nope' }, { type: 'placeSettlement', vertex: 'a' }, { type: 'discard', resources: 7 }]) {
      const res = await a.emit('game:action', junk);
      expect(res.ok).toBe(false);
    }
    expect((await a.emit('room:join', null)).ok).toBe(false);
    expect((await a.emit('lobby:setRole', null)).ok).toBe(false);
    a.close(); b.close();
  });
});
