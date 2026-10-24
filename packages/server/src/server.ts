import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { eventsFor, legalMovesFor, viewFor, type GameEvent, type Rng } from '@ada/game-core';
import {
  CLIENT_EVENTS, PROTOCOL_VERSION, type Ack, type ClientToServerEvents, type PresenceNotice, type ServerError, type ServerToClientEvents,
} from '@ada/protocol';
import type { ServerConfig } from './config';
import { AnonymousIdentity, type PlayerIdentity } from './identity';
import { TokenBucket } from './rateLimit';
import { cryptoRng } from './rng';
import { defaultTimerChoices, lobbyViewFor } from './rooms/lobby';
import { MemoryRoomStore } from './rooms/memoryStore';
import { clockFor, isActive, timerClockFor, type Room } from './rooms/room';
import type { RoomStore } from './rooms/store';
import { RoomService, type Out } from './service';
import { createStaticHandler } from './static';
import { parseAction, parseHello, parseJoin, parseMode, parseNameOnly, parseRole, parseTimer, type Parsed } from './validate';

export const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;

export interface AdaServerOptions {
  config: ServerConfig;
  identity?: PlayerIdentity;
  store?: RoomStore;
  rng?: Rng;
  now?: () => number;
  /** per connection: burst size and refill per second */
  rateLimit?: { capacity: number; perSecond: number };
  /** per address: rooms that may be created in a burst, and the refill per second */
  createLimit?: { capacity: number; perSecond: number };
  /** a connection that keeps hitting the limit this many times in a row is dropped */
  dropAfterLimited?: number;
  /** how often to look for rooms to delete; 0 = never (tests call sweep themselves) */
  sweepIntervalMs?: number;
  roomIdleMs?: number;
  /** how often the timed mode's clocks are looked at; 0 = never (tests call `tick` themselves) */
  timerTickMs?: number;
}

type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { playerId?: string }>;
type ClientEvent = (typeof CLIENT_EVENTS)[number];
/** What a handler hands back: the ack now, and pushes to run once the ack is out. */
interface Outcome {
  ack: Ack<Record<string, unknown>>;
  after?: () => void;
}

const err = (key: ServerError['key'], detail: Record<string, unknown> = {}): { ok: false; error: ServerError } => ({
  ok: false,
  error: { ...detail, key },
});

export function createAdaServer(opts: AdaServerOptions) {
  const now = opts.now ?? Date.now;
  const identity = opts.identity ?? new AnonymousIdentity(opts.config.secret);
  const store = opts.store ?? new MemoryRoomStore();
  const timerChoices = defaultTimerChoices({
    turnSeconds: opts.config.testTurnSeconds ? [opts.config.testTurnSeconds] : [],
    gameSeconds: opts.config.testGameSeconds ? [opts.config.testGameSeconds] : [],
  });
  const service = new RoomService(store, opts.rng ?? cryptoRng(), now, opts.config.testVp ?? null, opts.config.testResources ?? null, timerChoices);
  const rate = opts.rateLimit ?? { capacity: 20, perSecond: 10 };
  const testCreate = opts.config.testCreateLimit ?? null;
  const createRate = opts.createLimit ?? (testCreate ? { capacity: testCreate, perSecond: testCreate } : { capacity: 10, perSecond: 10 / 60 });
  const dropAfter = opts.dropAfterLimited ?? 100;
  const idleMs = opts.roomIdleMs ?? ROOM_IDLE_MS;

  const staticHandler = opts.config.clientDir ? createStaticHandler(opts.config.clientDir) : null;
  const http = createServer(
    staticHandler ??
      ((_req, res) => {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
      }),
  );
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { playerId?: string }>(http, {
    transports: ['websocket'],
    maxHttpBufferSize: 16 * 1024,
    // a dropped phone is noticed within about 20 seconds (the default is 45), so the others learn of it sooner
    pingInterval: 10_000,
    pingTimeout: 10_000,
    cors: { origin: opts.config.corsOrigins.includes('*') ? true : opts.config.corsOrigins },
  });

  /** the live connection of each player */
  const sockets = new Map<string, Sock>();
  const createBuckets = new Map<string, TokenBucket>();

  /* ---------------- pushing state out ---------------- */

  const connectedSockets = (room: Room) =>
    room.seats.filter(isActive).flatMap((s) => {
      const sock = sockets.get(s.playerId);
      return sock ? [{ pid: s.playerId, sock }] : [];
    });

  function pushLobby(room: Room) {
    for (const { pid, sock } of connectedSockets(room)) sock.emit('lobby:update', lobbyViewFor(room, pid));
  }

  /** Each player gets their own view and the events as they may see them; nobody else's. */
  function pushGame(room: Room, events: GameEvent[], kind: 'game:update' | 'game:snapshot') {
    if (!room.game) return;
    for (const { pid, sock } of connectedSockets(room)) sock.emit(kind, { view: viewFor(room.game, pid), events: eventsFor(events, pid), legal: legalMovesFor(room.game, pid), clock: clockFor(room, now()), timerClock: timerClockFor(room.game, now()) });
  }

  function pushPresence(room: Room, notice: PresenceNotice, except: string) {
    for (const { pid, sock } of connectedSockets(room)) if (pid !== except) sock.emit('presence', notice);
  }

  /** A player (re)attached: they get everything, the others learn about it. */
  function announceArrival(room: Room, pid: string) {
    const sock = sockets.get(pid);
    if (sock && room.game) sock.emit('game:snapshot', { view: viewFor(room.game, pid), events: [], legal: legalMovesFor(room.game, pid), clock: clockFor(room, now()), timerClock: timerClockFor(room.game, now()) });
    pushLobby(room);
    if (room.phase !== 'lobby') pushPresence(room, { type: 'playerReconnected', player: pid }, pid);
  }

  function announceDeparture(room: Room, pid: string) {
    pushLobby(room);
    if (room.phase !== 'lobby') pushPresence(room, { type: 'playerDisconnected', player: pid }, pid);
  }

  /* ---------------- one message ---------------- */

  function createAllowed(sock: Sock): boolean {
    const ip = sock.handshake.address;
    let b = createBuckets.get(ip);
    if (!b) {
      if (createBuckets.size > 10_000) createBuckets.clear();
      b = new TokenBucket(createRate.capacity, createRate.perSecond, now);
      createBuckets.set(ip, b);
    }
    return b.take();
  }

  const isOk = <T>(p: Parsed<T>): p is { ok: true; value: T } => p.ok;
  const asAck = (r: Out<object>): Ack<Record<string, unknown>> => r as Ack<Record<string, unknown>>;

  /** For results that name a room: the ack is the bare success, then `after` runs on the room as it is by then. */
  function inRoom(r: Out<{ code: string }>, after: (room: Room) => void): Outcome {
    if (!r.ok) return { ack: asAck(r) };
    return { ack: { ok: true }, after: () => after(service.get(r.code)!) };
  }

  function handle(sock: Sock, event: ClientEvent, payload: unknown): Outcome {
    if (event === 'identity:hello') {
      const p = parseHello(payload);
      if (!isOk(p)) return { ack: err('badPayload') };
      if (p.value.protocolVersion !== PROTOCOL_VERSION) return { ack: err('incompatibleVersion', { serverVersion: PROTOCOL_VERSION, clientVersion: p.value.protocolVersion }) };
      // a missing or unusable token (for example after a server restart) simply gets a new identity
      const known = p.value.token === undefined ? null : identity.verify(p.value.token);
      const issued = known ? { playerId: known, token: p.value.token! } : identity.issue();
      const pid = issued.playerId;
      const old = sockets.get(pid);
      if (old && old !== sock) {
        sockets.delete(pid);
        old.emit('replaced');
        old.disconnect(true);
      }
      sock.data.playerId = pid;
      sockets.set(pid, sock);
      const room = service.connect(pid);
      return {
        ack: { ok: true, playerId: pid, token: issued.token, room: room?.code ?? null, protocolVersion: PROTOCOL_VERSION },
        after: room ? () => announceArrival(service.get(room.code)!, pid) : undefined,
      };
    }

    const pid = sock.data.playerId;
    if (!pid) return { ack: err('noIdentity') };

    switch (event) {
      case 'room:create': {
        const p = parseNameOnly(payload);
        if (!isOk(p)) return { ack: err('badPayload') };
        if (!createAllowed(sock)) return { ack: err('rateLimited') };
        const r = service.createRoom(pid, p.value.name);
        if (!r.ok) return { ack: asAck(r) };
        return { ack: { ok: true, code: r.code }, after: () => pushLobby(service.get(r.code)!) };
      }
      case 'room:join': {
        const p = parseJoin(payload);
        if (!isOk(p)) return { ack: err('badPayload') };
        const r = service.joinRoom(pid, p.value.code, p.value.name);
        if (!r.ok) return { ack: asAck(r) };
        return { ack: { ok: true, code: r.code }, after: () => announceArrival(service.get(r.code)!, pid) };
      }
      case 'room:leave':
        return inRoom(service.leaveRoom(pid), (room) => announceDeparture(room, pid));
      case 'lobby:setName': {
        const p = parseNameOnly(payload);
        return isOk(p) ? inRoom(service.setName(pid, p.value.name), pushLobby) : { ack: err('badPayload') };
      }
      case 'lobby:setRole': {
        const p = parseRole(payload);
        return isOk(p) ? inRoom(service.setRole(pid, p.value.role), pushLobby) : { ack: err('badPayload') };
      }
      case 'lobby:setMode': {
        const p = parseMode(payload);
        return isOk(p) ? inRoom(service.setMode(pid, p.value.mode, p.value.targetScore), pushLobby) : { ack: err('badPayload') };
      }
      case 'lobby:setTimer': {
        const p = parseTimer(payload);
        return isOk(p) ? inRoom(service.setTimer(pid, p.value.timer), pushLobby) : { ack: err('badPayload') };
      }
      case 'lobby:start':
        return inRoom(service.start(pid), (room) => {
          pushLobby(room);
          pushGame(room, [], 'game:snapshot');
        });
      case 'lobby:reset':
        return inRoom(service.reset(pid), pushLobby);
      case 'game:action': {
        const p = parseAction(payload);
        if (!isOk(p)) return { ack: err('badPayload') };
        const r = service.act(pid, p.value);
        if (!r.ok) return { ack: asAck(r) };
        return {
          ack: { ok: true },
          after: () => {
            const room = service.get(r.code)!;
            pushGame(room, r.events, 'game:update');
            if (room.phase === 'finished') pushLobby(room);
          },
        };
      }
      case 'game:legal': {
        const r = service.legal(pid);
        return { ack: asAck(r) };
      }
      case 'game:preview': {
        const p = parseAction(payload);
        if (!isOk(p)) return { ack: err('badPayload') };
        return { ack: asAck(service.preview(pid, p.value)) };
      }
      default:
        return { ack: err('unknownEvent') };
    }
  }

  /* ---------------- connections ---------------- */

  io.on('connection', (sock) => {
    const bucket = new TokenBucket(rate.capacity, rate.perSecond, now);
    let limitedInARow = 0;
    const ackOf = (args: unknown[]): ((r: unknown) => void) | null => {
      const last = args[args.length - 1];
      return typeof last === 'function' ? (last as (r: unknown) => void) : null;
    };

    // every incoming packet passes here first: unknown events and flooding are answered without reaching a handler
    sock.use(([event, ...args], next) => {
      const ack = ackOf(args);
      const reply = (key: ServerError['key']) => {
        try {
          ack?.(err(key));
        } catch {
          /* a broken ack must not hurt the server */
        }
      };
      if (!bucket.take()) {
        if (++limitedInARow >= dropAfter) sock.disconnect(true);
        reply('rateLimited');
        return;
      }
      limitedInARow = 0;
      if (!(CLIENT_EVENTS as readonly string[]).includes(event)) {
        reply('unknownEvent');
        return;
      }
      next();
    });

    for (const event of CLIENT_EVENTS) {
      (sock as Socket).on(event, (...args: unknown[]) => {
        const ack = ackOf(args);
        const payload = args[0] === ack ? undefined : args[0];
        let out: Outcome;
        try {
          out = handle(sock, event, payload);
        } catch (e) {
          console.error('handler failed', event, e);
          out = { ack: err('internal') };
        }
        try {
          ack?.(out.ack);
        } catch {
          /* ignore a broken ack */
        }
        try {
          out.after?.();
        } catch (e) {
          console.error('push failed', event, e);
        }
      });
    }

    sock.on('disconnect', () => {
      const pid = sock.data.playerId;
      // a newer connection of the same player may already own the seat
      if (!pid || sockets.get(pid) !== sock) return;
      sockets.delete(pid);
      const room = service.disconnect(pid);
      if (room) announceDeparture(room, pid);
    });
  });

  /* ---------------- life cycle ---------------- */

  const sweep = () => service.sweep(idleMs);
  const sweepEvery = opts.sweepIntervalMs ?? 60_000;
  const interval = sweepEvery > 0 ? setInterval(sweep, sweepEvery) : null;
  interval?.unref();

  /**
   * One look at the timed games: those whose time is up move on and everyone in them is told. Driven by the interval below in
   * production and called directly in tests, with the injected clock moved on by hand.
   */
  const tick = () => {
    for (const { code, events } of service.tickTimers()) {
      const room = service.get(code);
      if (!room) continue;
      pushGame(room, events, 'game:update');
      if (room.phase === 'finished') pushLobby(room);
    }
  };
  const tickEvery = opts.timerTickMs ?? 1000;
  const timerInterval =
    tickEvery > 0
      ? setInterval(() => {
          try {
            tick();
          } catch (e) {
            console.error('timer tick failed', e);
          }
        }, tickEvery)
      : null;
  timerInterval?.unref();

  return {
    io,
    store,
    service,
    sweep,
    tick,
    listen: (port: number) => new Promise<number>((resolve) => http.listen(port, () => resolve((http.address() as { port: number }).port))),
    close: () =>
      new Promise<void>((resolve) => {
        if (interval) clearInterval(interval);
        if (timerInterval) clearInterval(timerInterval);
        void io.close(() => resolve());
      }),
  };
}
