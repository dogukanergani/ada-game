import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROLE_LIST,
  applyAction,
  createGame,
  isRoleId,
  viewFor,
  type Ack,
  type Action,
  type GameState,
  type LobbyInfo,
  type RoleId,
} from '@ada/game-core';
import { staticHandler } from './static';

interface LobbyEntry {
  id: string;
  name: string;
  role: RoleId | null;
  socketId: string | null;
}

interface Room {
  code: string;
  host: string;
  players: LobbyEntry[];
  game: GameState | null;
  lastActive: number;
}

/** Server-side randomness: dice and decks must never be predictable by clients. */
const secureRng = () => randomBytes(4).readUInt32LE(0) / 0x100000000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;

const cleanName = (x: unknown) => (typeof x === 'string' ? x.trim().replace(/\s+/g, ' ').slice(0, 20) : '');
const cleanId = (x: unknown) => (typeof x === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(x) ? x : '');
const cleanCode = (x: unknown) => (typeof x === 'string' ? x.trim().toUpperCase().slice(0, 4) : '');

export function createAppServer() {
  const rooms = new Map<string, Room>();
  const httpServer = http.createServer(staticHandler);
  const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim());
  const io = new Server(httpServer, { cors: { origin: origins ?? '*' } });

  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(secureRng() * CODE_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
  };

  const lobbyFor = (room: Room, playerId: string): LobbyInfo => ({
    code: room.code,
    host: room.host,
    me: playerId,
    started: !!room.game,
    players: room.players.map((p) => ({ id: p.id, name: p.name, role: p.role, connected: p.socketId !== null })),
  });

  function broadcast(room: Room) {
    room.lastActive = Date.now();
    for (const p of room.players) {
      if (!p.socketId) continue;
      io.to(p.socketId).emit('lobby:update', lobbyFor(room, p.id));
      io.to(p.socketId).emit('game:state', room.game ? viewFor(room.game, p.id) : null);
    }
  }

  function bind(socket: Socket, room: Room, entry: LobbyEntry) {
    // Drop an older tab/connection of the same player
    if (entry.socketId && entry.socketId !== socket.id) {
      io.sockets.sockets.get(entry.socketId)?.disconnect(true);
    }
    entry.socketId = socket.id;
    socket.data.playerId = entry.id;
    socket.data.code = room.code;
  }

  const roomOf = (socket: Socket): Room | undefined => rooms.get(socket.data.code);

  function detach(socket: Socket) {
    const room = roomOf(socket);
    if (!room) return;
    const entry = room.players.find((p) => p.id === socket.data.playerId);
    if (entry && entry.socketId === socket.id) {
      entry.socketId = null;
      if (!room.game) {
        // In the lobby a disconnected host hands over to someone still here.
        if (room.host === entry.id) {
          const next = room.players.find((p) => p.socketId);
          if (next) room.host = next.id;
        }
      }
      broadcast(room);
    }
    socket.data.code = undefined;
  }

  io.on('connection', (socket) => {
    const reply = (ack: unknown, res: { ok: boolean; error?: string; code?: string }) => {
      if (typeof ack === 'function') (ack as (r: unknown) => void)(res);
    };

    socket.on('room:create', (p: { name?: unknown; playerId?: unknown }, ack: Ack<{ code: string }>) => {
      const name = cleanName(p?.name);
      const id = cleanId(p?.playerId);
      if (!name || !id) return reply(ack, { ok: false, error: 'Bir isim yazmalısın.' });
      detach(socket);
      const room: Room = { code: newCode(), host: id, players: [], game: null, lastActive: Date.now() };
      const entry: LobbyEntry = { id, name, role: null, socketId: null };
      room.players.push(entry);
      rooms.set(room.code, room);
      bind(socket, room, entry);
      broadcast(room);
      reply(ack, { ok: true, code: room.code });
    });

    socket.on('room:join', (p: { code?: unknown; name?: unknown; playerId?: unknown }, ack: Ack<{ code: string }>) => {
      const code = cleanCode(p?.code);
      const id = cleanId(p?.playerId);
      const room = rooms.get(code);
      if (!room || !id) return reply(ack, { ok: false, error: 'Oda bulunamadı.' });
      const existing = room.players.find((x) => x.id === id);
      if (existing) {
        if (socket.data.code && socket.data.code !== code) detach(socket);
        bind(socket, room, existing);
        broadcast(room);
        return reply(ack, { ok: true, code });
      }
      const name = cleanName(p?.name);
      if (!name) return reply(ack, { ok: false, error: 'Bir isim yazmalısın.' });
      if (room.game) return reply(ack, { ok: false, error: 'Bu oyun çoktan başladı.' });
      if (room.players.length >= MAX_PLAYERS) return reply(ack, { ok: false, error: 'Oda dolu.' });
      if (room.players.some((x) => x.name.toLowerCase() === name.toLowerCase()))
        return reply(ack, { ok: false, error: 'Bu isim odada kullanılıyor.' });
      detach(socket);
      const entry: LobbyEntry = { id, name, role: null, socketId: null };
      room.players.push(entry);
      bind(socket, room, entry);
      broadcast(room);
      reply(ack, { ok: true, code });
    });

    socket.on('room:leave', (_: unknown, ack: Ack) => {
      const room = roomOf(socket);
      if (room && !room.game) {
        room.players = room.players.filter((p) => p.id !== socket.data.playerId);
        if (!room.players.length) rooms.delete(room.code);
        else {
          if (room.host === socket.data.playerId) room.host = room.players[0].id;
          broadcast(room);
        }
        socket.data.code = undefined;
      } else {
        detach(socket);
      }
      reply(ack, { ok: true });
    });

    socket.on('lobby:setRole', (p: { role?: unknown }, ack: Ack) => {
      const room = roomOf(socket);
      if (!room || room.game) return reply(ack, { ok: false, error: 'Rol şimdi seçilemez.' });
      const entry = room.players.find((x) => x.id === socket.data.playerId)!;
      if (p?.role === null) entry.role = null;
      else if (isRoleId(p?.role)) {
        if (room.players.some((x) => x.id !== entry.id && x.role === p.role))
          return reply(ack, { ok: false, error: 'Bu rolü başka biri seçti.' });
        entry.role = p.role;
      } else return reply(ack, { ok: false, error: 'Geçersiz rol.' });
      broadcast(room);
      reply(ack, { ok: true });
    });

    socket.on('lobby:start', (_: unknown, ack: Ack) => {
      const room = roomOf(socket);
      if (!room || room.game) return reply(ack, { ok: false, error: 'Oyun başlatılamaz.' });
      if (room.host !== socket.data.playerId) return reply(ack, { ok: false, error: 'Oyunu sadece oda sahibi başlatır.' });
      if (room.players.length < MIN_PLAYERS) return reply(ack, { ok: false, error: `En az ${MIN_PLAYERS} oyuncu gerekir.` });
      // Players who didn't pick get a random role that nobody else holds.
      const taken = new Set(room.players.map((p) => p.role).filter(Boolean));
      const free = ROLE_LIST.map((r) => r.id).filter((r) => !taken.has(r));
      for (let i = free.length - 1; i > 0; i--) {
        const j = Math.floor(secureRng() * (i + 1));
        [free[i], free[j]] = [free[j], free[i]];
      }
      for (const p of room.players) if (!p.role) p.role = free.pop()!;
      room.game = createGame(
        room.players.map((p) => ({ id: p.id, name: p.name, role: p.role! })),
        secureRng,
      );
      broadcast(room);
      reply(ack, { ok: true });
    });

    socket.on('lobby:reset', (_: unknown, ack: Ack) => {
      const room = roomOf(socket);
      if (!room?.game) return reply(ack, { ok: false, error: 'Sıfırlanacak oyun yok.' });
      if (room.host !== socket.data.playerId) return reply(ack, { ok: false, error: 'Sadece oda sahibi.' });
      if (room.game.phase !== 'finished') return reply(ack, { ok: false, error: 'Oyun henüz bitmedi.' });
      room.game = null;
      for (const p of room.players) p.role = null;
      broadcast(room);
      reply(ack, { ok: true });
    });

    socket.on('game:action', (action: Action, ack: Ack) => {
      const room = roomOf(socket);
      if (!room?.game) return reply(ack, { ok: false, error: 'Oyun yok.' });
      try {
        const res = applyAction(room.game, socket.data.playerId, action, secureRng);
        if (!res.ok) return reply(ack, { ok: false, error: res.error });
        room.game = res.state;
        broadcast(room);
        reply(ack, { ok: true });
      } catch (err) {
        console.error('[ada] action error', err);
        reply(ack, { ok: false, error: 'Hamle işlenemedi.' });
      }
    });

    socket.on('disconnect', () => detach(socket));
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const online = room.players.some((p) => p.socketId);
      if (!online && now - room.lastActive > ROOM_TTL_MS) rooms.delete(code);
    }
  }, 60_000);
  sweep.unref();

  return {
    httpServer,
    io,
    rooms,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweep);
        io.close(() => resolve());
      }),
  };
}
