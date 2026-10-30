import {
  CUSTOM_TARGET_MAX, CUSTOM_TARGET_MIN, GAME_MINUTES_OPTIONS, MAX_PLAYERS, MIN_PLAYERS, ROLE_LIST, TURN_SECONDS_OPTIONS, isRoleId,
  TEAMS, TEAM_MODE_PLAYERS, TEAM_SIZE, type GameMode, type Rng, type RoleId, type Team, type TimerConfig,
} from '@ada/game-core';
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
    targetScore: 10,
    timer: null,
    teamMode: false,
    phase: 'lobby',
    seats: [{ playerId: hostId, name, role: null, team: null, connected: true, away: false }],
    game: null,
    emptySince: null,
    startedAt: null,
    endedAt: null,
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
  room.seats.push({ playerId, name, role: null, team: null, connected: true, away: false });
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

/** `targetScore` belongs to the custom mode only: required there (an integer from 5 to 15), refused with any other mode. */
export function setMode(room: Room, playerId: string, mode: GameMode, targetScore?: number): Done {
  const h = hostOnly(room, playerId);
  if (!h.ok) return h;
  if (room.phase !== 'lobby') return fail('notInLobby');
  if (mode !== 'standard' && mode !== 'short' && mode !== 'custom') return fail('badMode');
  if (mode === 'custom') {
    if (!Number.isInteger(targetScore) || targetScore! < CUSTOM_TARGET_MIN || targetScore! > CUSTOM_TARGET_MAX) return fail('badTarget');
    room.targetScore = targetScore!;
  } else if (targetScore !== undefined) {
    return fail('badTarget');
  }
  room.mode = mode;
  return OK;
}

/** The limits a host may pick: the fixed lists of the rules, plus (test servers only) the extra values the config allows. */
export interface TimerChoices {
  turnSeconds: readonly number[];
  gameSeconds: readonly number[];
}
export const defaultTimerChoices = (extra: Partial<TimerChoices> = {}): TimerChoices => ({
  turnSeconds: [...TURN_SECONDS_OPTIONS, ...(extra.turnSeconds ?? [])],
  gameSeconds: [...GAME_MINUTES_OPTIONS.map((m) => m * 60), ...(extra.gameSeconds ?? [])],
});

export function setTimer(room: Room, playerId: string, timer: TimerConfig | null, choices: TimerChoices): Done {
  const h = hostOnly(room, playerId);
  if (!h.ok) return h;
  if (room.phase !== 'lobby') return fail('notInLobby');
  if (timer !== null && !(choices.turnSeconds.includes(timer.turnSeconds) && choices.gameSeconds.includes(timer.gameSeconds))) return fail('badTimer');
  room.timer = timer ? { turnSeconds: timer.turnSeconds, gameSeconds: timer.gameSeconds } : null;
  return OK;
}

/** The host turns the team mode on or off. Every pick of a team is cleared, so nobody starts on a stale side. */
export function setTeamMode(room: Room, playerId: string, on: boolean): Done {
  const h = hostOnly(room, playerId);
  if (!h.ok) return h;
  if (room.phase !== 'lobby') return fail('notInLobby');
  room.teamMode = on;
  for (const s of room.seats) s.team = null;
  return OK;
}

/** A player picks their own team, or null to step out. A team holds at most two. */
export function setTeam(room: Room, playerId: string, team: Team | null): Done {
  const seat = seatOf(room, playerId);
  if (!seat) return fail('notInRoom');
  if (room.phase !== 'lobby') return fail('notInLobby');
  if (!room.teamMode) return fail('badTeams', { reason: 'off' });
  if (team !== null) {
    if (!(TEAMS as readonly unknown[]).includes(team)) return fail('badTeams', { reason: 'unknownTeam' });
    if (room.seats.filter((s) => s.team === team && s !== seat).length >= TEAM_SIZE) return fail('teamFull', { team });
  }
  seat.team = team;
  return OK;
}

export type StartPlan = { ok: true; players: { id: string; name: string; role: RoleId }[]; teams?: Record<string, Team> } | ReturnType<typeof fail>;

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
  if (!room.teamMode) return { ok: true, players };
  // the team mode is exactly 4 players, two on each team; the core checks again, this gives the lobby a precise reason
  if (present.length !== TEAM_MODE_PLAYERS) return fail('badTeams', { reason: 'playerCount', need: TEAM_MODE_PLAYERS, have: present.length });
  const sizes = { A: 0, B: 0 };
  for (const s of present) if (s.team) sizes[s.team]++;
  if (sizes.A !== TEAM_SIZE || sizes.B !== TEAM_SIZE) return fail('badTeams', { reason: 'assignment', A: sizes.A, B: sizes.B });
  return { ok: true, players, teams: Object.fromEntries(present.map((s) => [s.playerId, s.team!])) };
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
  room.startedAt = null;
  room.endedAt = null;
  room.phase = 'lobby';
  ensureHost(room);
  return OK;
}

export function lobbyViewFor(room: Room, me: string, choices: TimerChoices = defaultTimerChoices()): LobbyView {
  return {
    code: room.code,
    me,
    hostId: room.hostId,
    mode: room.mode,
    targetScore: room.targetScore,
    timer: room.timer,
    timerChoices: { turnSeconds: [...choices.turnSeconds], gameSeconds: [...choices.gameSeconds] },
    teamMode: room.teamMode,
    phase: room.phase,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: room.seats.map((s) => ({ id: s.playerId, name: s.name, role: s.role, connected: s.connected, host: s.playerId === room.hostId, team: room.teamMode ? s.team : null })),
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
