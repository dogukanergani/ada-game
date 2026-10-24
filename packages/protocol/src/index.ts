/**
 * Wire protocol between client and server: event names, payloads and error
 * keys. Types only. Game types (Action, GameEvent, GameError, GameView) come
 * from game-core and are re-exported so a client needs just this package.
 *
 * The server never sends text: every error is `{key, ...values}` and every
 * notice is `{type, ...values}`; clients translate them (tr / en).
 */
import type { Action, GameError, GameEvent, GameMode, GameView, Hand, LegalMoves, RoleId, TimerConfig } from '@ada/game-core';

export type { Action, GameError, GameEvent, GameMode, GameView, Hand, LegalMoves, RoleId, TimerConfig };

/**
 * Bumped whenever client and server stop understanding each other. The client
 * sends it with `identity:hello`; the server refuses a different version, and the
 * client then asks the player to reload the page.
 */
/** 2: the Soldier demolishes instead of capturing (the `demolish` role action, the `demolished` event, `demolishShield` in the view) and the preview reports the longest road. */
/**
 * 3: custom mode and the timed mode. `lobby:setMode` carries a target score, `lobby:setTimer` is new, the lobby view tells the target
 * score and the timer, `GamePayload` carries `timerClock`, and the game view has `winners` (a list) in place of `winner`.
 */
export const PROTOCOL_VERSION = 3;

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
  'badTarget',
  'badTimer',
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
  /** the target of a custom game (5-15); kept while another mode is chosen, and only used in a custom game */
  targetScore: number;
  /** the timed mode's limits; null = no timer (the default) */
  timer: TimerConfig | null;
  /** the limits the host may pick, in seconds: the lists of the rules (a test server may add values) */
  timerChoices: { turnSeconds: number[]; gameSeconds: number[] };
  phase: RoomPhase;
  minPlayers: number;
  maxPlayers: number;
  players: LobbyPlayer[];
}

/** Notices about other players' connections; the client turns them into text. */
export type PresenceNotice = { type: 'playerDisconnected'; player: string } | { type: 'playerReconnected'; player: string };

/**
 * How long the game has been going, worked out by the server (the client's clock is never trusted): milliseconds since the game
 * started, and whether it is still running (a finished game's time stands still). The client counts on from the moment it arrived.
 */
export interface GameClock {
  elapsedMs: number;
  running: boolean;
}

/**
 * What is left of the timed mode's limits, worked out by the server. Not absolute times: the client counts down from the moment the
 * message arrived, so a wrong clock on the player's device changes nothing. `turnRemainingMs` is null before the first turn (setup
 * has no turn limit).
 */
export interface TimerClock {
  turnRemainingMs: number | null;
  gameRemainingMs: number;
}

export interface GamePayload {
  /** this player's own view; the only game data a client ever receives */
  view: GameView;
  /** what just happened, already censored for this player */
  events: GameEvent[];
  /** what this player may do now: their own options only */
  legal: LegalMoves;
  /** the game's running time (server time) */
  clock: GameClock;
  /** time left on the timed mode's clocks as the server sees it at this moment; null when the game is untimed or over */
  timerClock: TimerClock | null;
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
  /**
   * only when not restricted: who holds the longest road, and how long it is, before and after; and every player's own longest
   * road before and after. All of it follows from the public board, so it hides nothing.
   */
  longestRoad?: { before: { holder: string | null; length: number }; after: { holder: string | null; length: number } };
  roadLengths?: Record<string, { before: number; after: number }>;
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
  /** `targetScore` goes with the custom mode (an integer from 5 to 15) and is refused with any other */
  'lobby:setMode': (p: { mode: GameMode; targetScore?: number }, ack: (r: Ack) => void) => void;
  /** the host switches the timed mode on (with the limits) or off (`null`) */
  'lobby:setTimer': (p: { timer: TimerConfig | null }, ack: (r: Ack) => void) => void;
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
  'identity:hello', 'room:create', 'room:join', 'room:leave', 'lobby:setName', 'lobby:setRole', 'lobby:setMode', 'lobby:setTimer', 'lobby:start',
  'lobby:reset', 'game:action', 'game:legal', 'game:preview',
] as const satisfies readonly (keyof ClientToServerEvents)[];
