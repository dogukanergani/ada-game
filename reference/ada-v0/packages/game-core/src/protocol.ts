import type { RoleId } from './types';

/** Shared client/server message shapes (Socket.IO). */
export interface LobbyPlayer {
  id: string;
  name: string;
  role: RoleId | null;
  connected: boolean;
}

export interface LobbyInfo {
  code: string;
  host: string;
  me: string;
  players: LobbyPlayer[];
  started: boolean;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
