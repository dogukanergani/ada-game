/**
 * Wire protocol between client and server: event names, payloads and error
 * keys. Types only. Game types (Action, GameEvent, GameError, GameView) come
 * from game-core and are re-exported so a client needs just this package.
 *
 * The server never sends text: every error is `{key, ...values}` and every
 * notice is `{type, ...values}`; clients translate them (tr / en).
 */
import type { Action, GameError, GameEvent, GameMode, GameView, Hand, LegalMoves, RoleId } from '@ada/game-core';

export type { Action, GameError, GameEvent, GameMode, GameView, Hand, LegalMoves, RoleId };

/**
 * Bumped whenever client and server stop understanding each other. The client
 * sends it with `identity:hello`; the server refuses a different version, and the
 * client then asks the player to reload the page.
 */
export const PROTOCOL_VERSION = 1;

export const ROOM_CODE_LENGTH = 4;
export const NAME_MAX_LENGTH = 24;

/** Every error key the server can answer with, as data: clients check their translations against this list. */
export const ERROR_KEYS = [
  'badPayload',
  'incompatibleVersion',
  'unknownEvent',
  'rateLimited',
  'internal',
  'noIdentity',
  'roomNotFound',
  'roomFull',
  'gameStarted',
  'alreadyInRoom',
  'notInRoom',
  'notInLobby',
  'notInGame',
  'gameNotFinished',
  'notHost',
  'roleTaken',
  'unknownRole',
  'badName',
  'badMode',
  'needMorePlayers',
  'game',
] as const;
/** 'game' means the game core refused; `error` then carries its GameError. */
export type ErrorKey = (typeof ERROR_KEYS)[number];

export interface ServerError {
  key: ErrorKey;
  /** present when key is 'game' */
  error?: GameError;
  [detail: string]: unknown;
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ServerError };

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface LobbyPlayer {
  id: string;
  name: string;
  /** null = not chosen yet; assigned at random when the host starts */
  role: RoleId | null;
  connected: boolean;
  host: boolean;
}

export interface LobbyView {
  code: string;
  me: string;
  hostId: string | null;
  mode: GameMode;
  phase: RoomPhase;
  minPlayers: number;
  maxPlayers: number;
  players: LobbyPlayer[];
}

/** Notices about other players' connections; the client turns them into text. */
export type PresenceNotice = { type: 'playerDisconnected'; player: string } | { type: 'playerReconnected'; player: string };

export interface GamePayload {
  /** this player's own view; the only game data a client ever receives */
  view: GameView;
  /** what just happened, already censored for this player */
  events: GameEvent[];
  /** what this player may do now: their own options only */
  legal: LegalMoves;
}

/**
 * What `game:preview` answers. It never carries anything random or hidden:
 * for actions whose outcome involves chance or other players' secret cards
 * (dice, buying a development card, stealing, monopoly, an accepted trade
 * with a bonus) only the verdict and the cost come back (`restricted`).
 */
export interface PreviewResult {
  restricted: boolean;
  /** what the player would pay */
  cost: Hand;
  /** only when not restricted: what the player would receive */
  gain?: Hand;
  /** only when not restricted: public points of every player before and after */
  points?: Record<string, { before: number; after: number }>;
  /** only when not restricted: the events, censored for this player */
  events?: GameEvent[];
}

export interface ClientToServerEvents {
  'identity:hello': (
    p: { token?: string; protocolVersion: number },
    ack: (r: Ack<{ playerId: string; token: string; room: string | null; protocolVersion: number }>) => void,
  ) => void;
  'room:create': (p: { name: string }, ack: (r: Ack<{ code: string }>) => void) => void;
  'room:join': (p: { code: string; name: string }, ack: (r: Ack<{ code: string }>) => void) => void;
  'room:leave': (p: object, ack: (r: Ack) => void) => void;
  'lobby:setName': (p: { name: string }, ack: (r: Ack) => void) => void;
  'lobby:setRole': (p: { role: RoleId | null }, ack: (r: Ack) => void) => void;
  'lobby:setMode': (p: { mode: GameMode }, ack: (r: Ack) => void) => void;
  'lobby:start': (p: object, ack: (r: Ack) => void) => void;
  'lobby:reset': (p: object, ack: (r: Ack) => void) => void;
  'game:action': (action: Action, ack: (r: Ack) => void) => void;
  /** what this player may do right now (their own options only) */
  'game:legal': (p: object, ack: (r: Ack<{ legal: LegalMoves }>) => void) => void;
  /** asks what an action would do for this player without doing it */
  'game:preview': (action: Action, ack: (r: Ack<{ preview: PreviewResult }>) => void) => void;
}

export interface ServerToClientEvents {
  'lobby:update': (lobby: LobbyView) => void;
  /** after every accepted action */
  'game:update': (p: GamePayload) => void;
  /** full state on (re)attach and when a game starts; `events` is empty */
  'game:snapshot': (p: GamePayload) => void;
  presence: (n: PresenceNotice) => void;
  /** this connection was replaced by a newer one with the same identity */
  replaced: () => void;
}

export const CLIENT_EVENTS = [
  'identity:hello', 'room:create', 'room:join', 'room:leave', 'lobby:setName', 'lobby:setRole', 'lobby:setMode', 'lobby:start',
  'lobby:reset', 'game:action', 'game:legal', 'game:preview',
] as const satisfies readonly (keyof ClientToServerEvents)[];
