import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Action, GameView, LobbyInfo, RoleId } from '@ada/game-core';

/** Set VITE_SERVER_URL when the client is not served by the game server (e.g. a Capacitor build). */
const SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined;
const opts = { transports: ['websocket', 'polling'] };
export const socket: Socket = SERVER_URL ? io(SERVER_URL, opts) : io(opts);

/* ---- identity & session (storage wrapped: it can be blocked or full) ---- */

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

let memoryId: string | null = null;
export function getPlayerId(): string {
  const saved = store.get('ada:pid');
  if (saved) return saved;
  if (!memoryId) {
    // crypto.randomUUID needs a secure context; getRandomValues does not (LAN testing over http).
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    memoryId = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  store.set('ada:pid', memoryId);
  return memoryId;
}

export const savedName = () => store.get('ada:name') ?? '';
const saveSession = (code: string, name: string) => {
  store.set('ada:room', code);
  store.set('ada:name', name);
};
const clearSession = () => store.del('ada:room');

type Res = { ok: boolean; error?: string; code?: string };
const call = (ev: string, payload?: unknown) =>
  new Promise<Res>((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'Sunucuya bağlı değilsin.' });
    socket.timeout(8000).emit(ev, payload, (err: Error | null, res: Res) => resolve(err ? { ok: false, error: 'Sunucu yanıt vermedi.' } : res));
  });

export function useNet() {
  const [connected, setConnected] = useState(socket.connected);
  const [lobby, setLobby] = useState<LobbyInfo | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejoining, setRejoining] = useState(() => !!store.get('ada:room'));
  const errTimer = useRef<number>();

  const showError = useCallback((msg: string | undefined) => {
    if (!msg) return;
    setError(msg);
    window.clearTimeout(errTimer.current);
    errTimer.current = window.setTimeout(() => setError(null), 3500);
  }, []);

  useEffect(() => {
    const onConnect = async () => {
      setConnected(true);
      const code = store.get('ada:room');
      if (code) {
        const res = await call('room:join', { code, name: savedName(), playerId: getPlayerId() });
        if (!res.ok) {
          clearSession();
          setLobby(null);
          setGame(null);
        }
      }
      setRejoining(false);
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('lobby:update', setLobby);
    socket.on('game:state', setGame);
    if (socket.connected) void onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('lobby:update', setLobby);
      socket.off('game:state', setGame);
    };
  }, []);

  const enter = async (ev: 'room:create' | 'room:join', payload: Record<string, unknown>, name: string) => {
    const res = await call(ev, { ...payload, name, playerId: getPlayerId() });
    if (res.ok && res.code) saveSession(res.code, name);
    else showError(res.error);
    return res.ok;
  };

  return {
    connected,
    rejoining,
    lobby,
    game,
    error,
    create: (name: string) => enter('room:create', {}, name),
    join: (code: string, name: string) => enter('room:join', { code }, name),
    leave: async () => {
      await call('room:leave');
      clearSession();
      setLobby(null);
      setGame(null);
    },
    setRole: async (role: RoleId | null) => {
      const r = await call('lobby:setRole', { role });
      if (!r.ok) showError(r.error);
    },
    start: async () => {
      const r = await call('lobby:start');
      if (!r.ok) showError(r.error);
    },
    reset: async () => {
      const r = await call('lobby:reset');
      if (!r.ok) showError(r.error);
    },
    /** Resolves true if the server accepted the move. */
    act: async (a: Action) => {
      const r = await call('game:action', a);
      if (!r.ok) showError(r.error);
      return r.ok;
    },
  };
}

export type Net = ReturnType<typeof useNet>;
