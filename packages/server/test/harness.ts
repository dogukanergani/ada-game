import { io as connect, type Socket } from 'socket.io-client';
import { afterEach } from 'vitest';
import { PROTOCOL_VERSION } from '@ada/protocol';
import { createAdaServer, type AdaServerOptions } from '../src/server';

type Server = ReturnType<typeof createAdaServer>;

const servers: Server[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.close();
  for (const s of servers.splice(0)) await s.close();
});

export async function startServer(opts: Partial<AdaServerOptions> = {}): Promise<{ server: Server; url: string }> {
  const server = createAdaServer({
    config: { port: 0, corsOrigins: ['*'], secret: 'test-secret', clientDir: null, testVp: null, testSeed: null, testResources: null },
    // generous by default; the tests about limits ask for small ones
    rateLimit: { capacity: 10_000, perSecond: 10_000 },
    createLimit: { capacity: 10_000, perSecond: 10_000 },
    sweepIntervalMs: 0,
    ...opts,
  });
  servers.push(server);
  const port = await server.listen(0);
  return { server, url: `http://127.0.0.1:${port}` };
}

export interface Logged {
  event: string;
  args: unknown[];
}

/** A socket.io client that remembers every message it receives. */
export class TestClient {
  readonly log: Logged[] = [];
  private waiters: (() => void)[] = [];
  playerId = '';
  token = '';

  constructor(readonly socket: Socket) {
    socket.onAny((event, ...args) => {
      this.log.push({ event, args });
      for (const w of [...this.waiters]) w();
    });
  }

  static async open(url: string): Promise<TestClient> {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    const c = new TestClient(socket);
    clients.push(c);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return c;
  }

  /** Opens a connection and says hello (with a token to come back as the same player). */
  static async login(url: string, token?: string): Promise<TestClient> {
    const c = await TestClient.open(url);
    const r = await c.emit('identity:hello', token === undefined ? { protocolVersion: PROTOCOL_VERSION } : { token, protocolVersion: PROTOCOL_VERSION });
    if (!r.ok) throw new Error(`hello failed: ${JSON.stringify(r)}`);
    c.playerId = r.playerId;
    c.token = r.token;
    return c;
  }

  emit(event: string, payload?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no ack for ${event}`)), 3000);
      const done = (r: unknown) => {
        clearTimeout(t);
        resolve(r);
      };
      if (payload === undefined) this.socket.emit(event, done);
      else this.socket.emit(event, payload, done);
    });
  }

  /** Position in the log; later `until` calls can ask for messages after it. */
  mark(): number {
    return this.log.length;
  }

  messages(event: string): any[] {
    return this.log.filter((l) => l.event === event).map((l) => l.args[0]);
  }

  /** Resolves with the first message of this event, at or after `since`, that satisfies `pred`. */
  until<T = any>(event: string, pred: (m: T) => boolean = () => true, since = 0, timeoutMs = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const look = () => {
        for (let i = since; i < this.log.length; i++) {
          const l = this.log[i];
          if (l.event === event && pred(l.args[0] as T)) return { v: l.args[0] as T };
        }
        return undefined;
      };
      const first = look();
      if (first) return resolve(first.v);
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== check);
        reject(new Error(`timed out waiting for ${event}`));
      }, timeoutMs);
      const check = () => {
        const m = look();
        if (!m) return;
        clearTimeout(t);
        this.waiters = this.waiters.filter((w) => w !== check);
        resolve(m.v);
      };
      this.waiters.push(check);
    });
  }

  closed(): Promise<void> {
    return this.socket.disconnected ? Promise.resolve() : new Promise((r) => this.socket.once('disconnect', () => r()));
  }
}

/** Lets pending socket traffic arrive; for asserting that something did NOT happen. */
export const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
