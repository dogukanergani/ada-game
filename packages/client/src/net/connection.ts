import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, type Ack, type GamePayload, type LobbyView, type PresenceNotice, type ServerError } from '@ada/protocol';
import { storage } from './storage';
import type { Msg } from './store';

export type AckResult = Ack<Record<string, unknown>>;

const ACK_TIMEOUT_MS = 8000;

/**
 * The socket, kept apart from React: it says hello with the saved identity on
 * every (re)connection, turns what the server sends into store messages, and
 * gives the UI one function to send requests with a timeout.
 */
export class Connection {
  private socket: Socket;
  private stopped = false;

  constructor(
    private readonly dispatch: (m: Msg) => void,
    url?: string,
    private readonly protocolVersion: number = PROTOCOL_VERSION,
  ) {
    this.socket = io(url ?? undefined, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      autoConnect: false,
    });

    this.socket.on('connect', () => void this.hello());
    this.socket.on('disconnect', () => {
      if (!this.stopped) dispatch({ t: 'conn', status: 'reconnecting', attempt: 0 });
    });
    this.socket.on('connect_error', () => {
      if (!this.stopped) dispatch({ t: 'conn', status: 'reconnecting', attempt: 0 });
    });
    this.socket.io.on('reconnect_attempt', (n: number) => {
      if (!this.stopped) dispatch({ t: 'conn', status: 'reconnecting', attempt: n });
    });
    this.socket.on('lobby:update', (lobby: LobbyView) => dispatch({ t: 'lobby', lobby }));
    this.socket.on('game:snapshot', (payload: GamePayload) => dispatch({ t: 'game', kind: 'snapshot', payload }));
    this.socket.on('game:update', (payload: GamePayload) => dispatch({ t: 'game', kind: 'update', payload }));
    this.socket.on('presence', (notice: PresenceNotice) => dispatch({ t: 'presence', notice }));
    this.socket.on('replaced', () => {
      // another tab took this identity; do not fight for it by reconnecting
      this.stopped = true;
      dispatch({ t: 'conn', status: 'replaced' });
      this.socket.disconnect();
    });
  }

  /** The browser says the network is gone (or back): a half-dead socket would take a minute to notice, so react now. */
  private readonly onOffline = () => {
    if (this.stopped) return;
    this.dispatch({ t: 'conn', status: 'reconnecting', attempt: 0 });
    this.socket.disconnect();
    this.waitingForNetwork = true;
  };
  private readonly onOnline = () => {
    if (this.stopped || !this.waitingForNetwork) return;
    this.waitingForNetwork = false;
    this.socket.connect();
  };
  private waitingForNetwork = false;

  start() {
    this.stopped = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', this.onOffline);
      window.addEventListener('online', this.onOnline);
    }
    this.dispatch({ t: 'conn', status: 'connecting' });
    this.socket.connect();
  }

  /** after `replaced`: take the identity back */
  takeBack() {
    this.start();
  }

  /** try right now instead of waiting for the next scheduled attempt */
  retryNow() {
    if (!this.socket.connected) this.socket.connect();
  }

  close() {
    this.stopped = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', this.onOffline);
      window.removeEventListener('online', this.onOnline);
    }
    this.socket.disconnect();
  }

  private async hello() {
    const r = await this.emit('identity:hello', { token: storage.get('token') ?? undefined, protocolVersion: this.protocolVersion });
    if (r.ok) {
      storage.set('token', r.token as string);
      this.dispatch({ t: 'hello', playerId: r.playerId as string });
      this.dispatch({ t: 'conn', status: 'online' });
    } else if (r.error.key === 'incompatibleVersion') {
      this.stopped = true;
      this.dispatch({ t: 'conn', status: 'incompatible' });
      this.socket.disconnect();
    } else {
      this.dispatch({ t: 'error', error: r.error });
    }
  }

  /** Sends a request and waits for the answer; no answer in time is reported as an error, never a hang. */
  emit(event: string, payload?: unknown): Promise<AckResult> {
    return new Promise((resolve) => {
      const timeout: ServerError = { key: 'internal', timeout: true };
      const timer = setTimeout(() => resolve({ ok: false, error: timeout }), ACK_TIMEOUT_MS);
      const done = (r: AckResult) => {
        clearTimeout(timer);
        resolve(r);
      };
      if (!this.socket.connected) return done({ ok: false, error: timeout });
      if (payload === undefined) this.socket.emit(event, done);
      else this.socket.emit(event, payload, done);
    });
  }
}
