import type { GameEvent, GamePayload, GameView, Hand, LegalMoves, LobbyView, PresenceNotice, ServerError } from '@ada/protocol';

/**
 * The whole client state. It holds only what the server sent this player:
 * their own view and options, and the events as censored for them. Nothing
 * about a rival's hidden cards can be in here because it never arrives.
 */
export type ConnStatus = 'connecting' | 'online' | 'reconnecting' | 'incompatible' | 'replaced';

export interface LogEntry {
  id: number;
  event: GameEvent;
}

export type Notice =
  | { id: number; kind: 'error'; error: ServerError }
  | { id: number; kind: 'presence'; notice: PresenceNotice };

/**
 * The last dice roll that arrived as a live event (never from a snapshot, so a
 * reload, a late join or a reconnect shows the dice at rest). It only feeds the
 * presentation: what the dice showed is in the view, what the player may do is
 * in `legal`; neither waits for this.
 */
export interface RollRecord {
  /** grows with every live roll */
  seq: number;
  dice: [number, number];
  total: number;
  /** tiles that produced (a building on them, no robber) and the tile the robber blocked, as the core reported them */
  hitTiles: number[];
  robbedTile: number | null;
  /** log id of the `diceRolled` entry: entries from here on stay hidden while the dice tumble */
  logId: number;
  /** what each player received from this roll (production and role bonuses), by player id; the counts are held back by this much while the dice tumble */
  gains: Record<string, Hand>;
}

export interface AppState {
  conn: ConnStatus;
  /** reconnection attempt counter while `reconnecting` */
  attempt: number;
  playerId: string | null;
  lobby: LobbyView | null;
  game: { view: GameView; legal: LegalMoves } | null;
  log: LogEntry[];
  nextId: number;
  notice: Notice | null;
  /** counts every game payload (update or snapshot): a newer one means what was being shown is stale */
  rev: number;
  lastRoll: RollRecord | null;
  /** the game's running time as the server last told it, with the monotonic moment (`performance.now()`) it arrived at */
  clock: { elapsedMs: number; running: boolean; at: number } | null;
}

export const initialState: AppState = {
  conn: 'connecting',
  attempt: 0,
  playerId: null,
  lobby: null,
  game: null,
  log: [],
  nextId: 1,
  notice: null,
  rev: 0,
  lastRoll: null,
  clock: null,
};

export type Msg =
  | { t: 'conn'; status: ConnStatus; attempt?: number }
  | { t: 'hello'; playerId: string }
  | { t: 'lobby'; lobby: LobbyView }
  | { t: 'game'; kind: 'snapshot' | 'update'; payload: GamePayload; /** monotonic arrival time, taken where the message is received */ at?: number }
  | { t: 'presence'; notice: PresenceNotice }
  | { t: 'error'; error: ServerError }
  | { t: 'leftRoom' }
  | { t: 'dismiss' };

export const LOG_LIMIT = 300;

export function reducer(s: AppState, m: Msg): AppState {
  switch (m.t) {
    case 'conn':
      return { ...s, conn: m.status, attempt: m.attempt ?? 0 };
    case 'hello':
      return { ...s, playerId: m.playerId };
    case 'lobby':
      // a lobby view means no game is running (or it is finished and the lobby is shown beside it)
      return m.lobby.phase === 'lobby' ? { ...s, lobby: m.lobby, game: null, log: [], lastRoll: null, clock: null } : { ...s, lobby: m.lobby };
    case 'game': {
      const entries = m.payload.events.map((event, i) => ({ id: s.nextId + i, event }));
      const rolled = m.kind === 'update' ? entries.find((e) => e.event.type === 'diceRolled') : undefined;
      return {
        ...s,
        rev: s.rev + 1,
        lastRoll: rolled ? rollRecord(s.lastRoll?.seq ?? 0, rolled, entries) : s.lastRoll,
        game: { view: m.payload.view, legal: m.payload.legal },
        clock: m.payload.clock ? { ...m.payload.clock, at: m.at ?? 0 } : s.clock,
        log: [...s.log, ...entries].slice(-LOG_LIMIT),
        nextId: s.nextId + entries.length,
      };
    }
    case 'presence':
      return { ...s, notice: { id: s.nextId, kind: 'presence', notice: m.notice }, nextId: s.nextId + 1 };
    case 'error':
      return { ...s, notice: { id: s.nextId, kind: 'error', error: m.error }, nextId: s.nextId + 1 };
    case 'leftRoom':
      return { ...s, lobby: null, game: null, log: [], lastRoll: null, clock: null };
    case 'dismiss':
      return { ...s, notice: null };
  }
}

function rollRecord(prevSeq: number, rolled: LogEntry, batch: LogEntry[]): RollRecord {
  const e = rolled.event;
  if (e.type !== 'diceRolled') throw new Error('not a roll');
  const gains: Record<string, Hand> = {};
  for (const { event } of batch) {
    if (event.type !== 'produced' && event.type !== 'roleBonus') continue;
    const sum: Hand = { ...(gains[event.player] ?? { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 }) };
    for (const r of Object.keys(sum) as (keyof Hand)[]) sum[r] += event.gains[r] ?? 0;
    gains[event.player] = sum;
  }
  return { seq: prevSeq + 1, dice: e.dice, total: e.total, hitTiles: e.hitTiles, robbedTile: e.robbedTile, logId: rolled.id, gains };
}
