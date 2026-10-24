import type { GameMode, GameState, RoleId, TimerConfig } from '@ada/game-core';
import type { ErrorKey, GameClock, RoomPhase, ServerError, TimerClock } from '@ada/protocol';

export interface Seat {
  playerId: string;
  name: string;
  role: RoleId | null;
  connected: boolean;
  /** left a started game on purpose: the seat is kept, but the player is free to join another room */
  away: boolean;
}

/**
 * A room: who is in it, who hosts, the chosen mode, and (once started) the
 * game state. Lobby code never looks inside `game`; the matchmaking of the
 * future builds on rooms without touching rules.
 */
export interface Room {
  code: string;
  hostId: string | null;
  mode: GameMode;
  /** the target of a custom game; kept while another mode is chosen */
  targetScore: number;
  /** the timed mode's limits, chosen in the lobby; null = untimed */
  timer: TimerConfig | null;
  phase: RoomPhase;
  /** join order */
  seats: Seat[];
  game: GameState | null;
  /** when the last connected player left; null while anyone is connected */
  emptySince: number | null;
  /** server time (ms) when the game was started; null in a lobby */
  startedAt: number | null;
  /** server time (ms) when the game finished; null while it runs */
  endedAt: number | null;
}

/** The game's running time as the server sees it at `now`; a finished game stands still. */
export function clockFor(room: Room, now: number): GameClock {
  if (room.startedAt === null) return { elapsedMs: 0, running: false };
  const end = room.endedAt ?? now;
  return { elapsedMs: Math.max(0, end - room.startedAt), running: room.endedAt === null };
}

/** What is left on the timed mode's clocks at `now`; null for an untimed or finished game. */
export function timerClockFor(game: GameState | null, now: number): TimerClock | null {
  if (!game || !game.timer || game.phase === 'finished' || game.gameStartedAt === null) return null;
  const left = (limitSeconds: number, since: number) => Math.max(0, limitSeconds * 1000 - (now - since));
  return {
    turnRemainingMs: game.turnStartedAt === null ? null : left(game.timer.turnSeconds, game.turnStartedAt),
    gameRemainingMs: left(game.timer.gameSeconds, game.gameStartedAt),
  };
}

export const fail = (key: ErrorKey, detail: Record<string, unknown> = {}): { ok: false; error: ServerError } => ({
  ok: false,
  error: { ...detail, key },
});

export const seatOf = (room: Room, playerId: string): Seat | undefined => room.seats.find((s) => s.playerId === playerId);
export const isActive = (s: Seat): boolean => s.connected && !s.away;
