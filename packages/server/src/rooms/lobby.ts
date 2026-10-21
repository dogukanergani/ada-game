import { MAX_PLAYERS, MIN_PLAYERS, ROLE_LIST, isRoleId, type GameMode, type Rng, type RoleId } from '@ada/game-core';
import { NAME_MAX_LENGTH, type LobbyView } from '@ada/protocol';
import { fail, isActive, seatOf, type Room } from './room';

type Done = { ok: true } | ReturnType<typeof fail>;
const OK: Done = { ok: true };

/** A display name, trimmed; null when empty, too long or containing control characters. */
export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const n = input.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  return n.length >= 1 && n.length <= NAME_MAX_LENGTH && !/[\u0000-\u001f\u007f]/.test(n) ? n : null;
}

export function newRoom(code: string, hostId: string, name: string): Room {
  return {
    code,
    hostId,
    mode: 'standard',
    phase: 'lobby',
    seats: [{ playerId: hostId, name, role: null, connected: true, away: false }],
    game: null,
    emptySince: null,
  };
}

/** Hands the host role to someone present when the host is gone; never takes it back from a returning host. */
export function ensureHost(room: Room) {
  const host = room.hostId ? seatOf(room, room.hostId) : undefined;
  if (host && isActive(host)) return;
  const next = room.seats.find(isActive);
  if (next) room.hostId = next.playerId;
  else if (!host) room.hostId = room.seats[0]?.playerId ?? null;
}

/** Keeps `emptySince` in step with who is connected. */
export function trackEmpty(room: Room, now: number) {
  const anyone = room.seats.some(isActive);
  if (anyone) room.emptySince = null;
  else if (room.emptySince === null) room.emptySince = now;
}

/**
 * A player enters. A known seat is simply taken back (reconnect, any phase);
 * a new player can only enter a lobby, and a full lobby makes room by dropping
 * a seat nobody is sitting in.
 */
export function addPlayer(room: Room, playerId: string, name: string): Done {
  const seat = seatOf(room, playerId);
  if (seat) {
    seat.connected = true;
    seat.away = false;
    return OK;
  }
  if (room.phase !== 'lobby') return fail('gameStarted');
  if (room.seats.length >= MAX_PLAYERS) {
    const ghost = room.seats.find((s) => !s.connected && s.playerId !== room.hostId);
    if (!ghost) return fail('roomFull');
    room.seats = room.seats.filter((s) => s !== ghost);
  }
  room.seats.push({ playerId, name, role: null, connected: true, away: false });
  if (!room.hostId) room.hostId = playerId;
  return OK;
}

/** Leaving on purpose: in a lobby the seat goes, in a started game it is kept but marked away. */
export function leave(room: Room, playerId: string): Done {
  const seat = seatOf(room, playerId);
  if (!seat) return fail('notInRoom');
  if (room.phase === 'lobby') room.seats = room.seats.filter((s) => s !== seat);
  else {
    seat.away = true;
    seat.connected = false;
  }
  ensureHost(room);
  return OK;
}

export function setConnected(room: Room, playerId: string, connected: boolean) {
  const seat = seatOf(room, playerId);
  if (!seat) return;
  seat.connected = connected;
  ensureHost(room);
}

export function setName(room: Room, playerId: string, name: string): Done {
  const seat = seatOf(room, playerId);
  if (!seat) return fail('notInRoom');
  if (room.phase !== 'lobby') return fail('notInLobby');
  seat.name = name;
  return OK;
}

export function setRole(room: Room, playerId: string, role: RoleId | null): Done {
  const seat = seatOf(room, playerId);
  if (!seat) return fail('notInRoom');
  if (room.phase !== 'lobby') return fail('notInLobby');
  if (role !== null) {
    if (!isRoleId(role)) return fail('unknownRole');
    const owner = room.seats.find((s) => s.role === role && s.playerId !== playerId);
    if (owner) return fail('roleTaken', { role });
  }
  seat.role = role;
  return OK;
}

function hostOnly(room: Room, playerId: string): Done {
  if (!seatOf(room, playerId)) return fail('notInRoom');
  return room.hostId === playerId ? OK : fail('notHost');
}

export function setMode(room: Room, playerId: string, mode: GameMode): Done {
  const h = hostOnly(room, playerId);
  if (!h.ok) return h;
  if (room.phase !== 'lobby') return fail('notInLobby');
  if (mode !== 'standard' && mode !== 'short') return fail('badMode');
  room.mode = mode;
  return OK;
}

export type StartPlan = { ok: true; players: { id: string; name: string; role: RoleId }[] } | ReturnType<typeof fail>;

/**
 * Checks that the host may start and works out who plays, without changing
 * the room: seats nobody is sitting in are dropped, and players who chose no
 * role get a random one nobody else holds.
 */
export function planStart(room: Room, playerId: string, rng: Rng): StartPlan {
  const h = hostOnly(room, playerId);
  if (!h.ok) return h;
  if (room.phase !== 'lobby') return fail('notInLobby');
  const present = room.seats.filter(isActive);
  if (present.length < MIN_PLAYERS) return fail('needMorePlayers', { min: MIN_PLAYERS, have: present.length });
  const free = shuffle(
    ROLE_IDS().filter((r) => !present.some((s) => s.role === r)),
    rng,
  );
  const players = present.map((s) => ({ id: s.playerId, name: s.name, role: s.role ?? free.pop()! }));
  return { ok: true, players };
}

/** Applies a plan once the game exists. */
export function commitStart(room: Room, players: { id: string; role: RoleId }[]) {
  room.seats = room.seats.filter(isActive);
  for (const p of players) seatOf(room, p.id)!.role = p.role;
  room.phase = 'playing';
  ensureHost(room);
}

/** Back to the lobby after a finished game; the host decides. Names and roles stay, absent players go. */
export function reset(room: Room, playerId: string): Done {
  const h = hostOnly(room, playerId);
  if (!h.ok) return h;
  if (room.phase !== 'finished') return fail('gameNotFinished');
  room.seats = room.seats.filter(isActive);
  room.game = null;
  room.phase = 'lobby';
  ensureHost(room);
  return OK;
}

export function lobbyViewFor(room: Room, me: string): LobbyView {
  return {
    code: room.code,
    me,
    hostId: room.hostId,
    mode: room.mode,
    phase: room.phase,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: room.seats.map((s) => ({ id: s.playerId, name: s.name, role: s.role, connected: s.connected, host: s.playerId === room.hostId })),
  };
}

const ROLE_IDS = () => ROLE_LIST.map((r) => r.id);

function shuffle<T>(a: T[], rng: Rng): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
