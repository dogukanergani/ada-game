import { legalMovesFor, type Action, type GameEvent, type GameMode, type LegalMoves, type Rng, type Team, type TimerConfig } from '@ada/game-core';
import type { PreviewResult } from '@ada/protocol';
import { playAction, previewAction, startGame, tickGame } from './game/session';
import { freshCode, parseCode } from './rooms/code';
import * as lobby from './rooms/lobby';
import { fail, seatOf, type Room } from './rooms/room';
import type { RoomStore } from './rooms/store';

type Fail = ReturnType<typeof fail>;
export type Out<T extends object = object> = ({ ok: true } & T) | Fail;

/**
 * Everything the server does to rooms, with no sockets in sight: each method
 * takes a verified player id and returns a result. The socket layer decides
 * who to notify afterwards.
 */
export class RoomService {
  constructor(
    private readonly store: RoomStore,
    private readonly rng: Rng,
    private readonly now: () => number = Date.now,
    /** test only (see ServerConfig.testVp) */
    private readonly testVp: number | null = null,
    /** test only (see ServerConfig.testResources) */
    private readonly testResources: number | null = null,
    /** the timer limits a host may pick; the rules' own lists unless a test server adds some */
    private readonly timerChoices: lobby.TimerChoices = lobby.defaultTimerChoices(),
  ) {}

  /** codes of the rooms whose timed game is running: the only rooms the clock has to look at */
  private readonly timed = new Set<string>();

  /** how many rooms the timer is watching (tests check it empties as games end and rooms close) */
  timedRoomCount(): number {
    return this.timed.size;
  }

  get(code: string): Room | undefined {
    return this.store.get(code);
  }

  /** The room this player is sitting in right now (a seat marked away does not count). */
  activeRoom(playerId: string): Room | undefined {
    for (const code of this.store.codesForPlayer(playerId)) {
      const room = this.store.get(code);
      if (room && seatOf(room, playerId) && !seatOf(room, playerId)!.away) return room;
    }
    return undefined;
  }

  /** Runs `fn` on a room and keeps the empty-room clock right. */
  private mutate<T extends { ok: boolean }>(code: string, fn: (room: Room) => T): T {
    let result!: T;
    this.store.update(code, (room) => {
      result = fn(room);
      lobby.trackEmpty(room, this.now());
    });
    return result;
  }

  /** A player's connection is (re)established; returns the room they are back in, if any. */
  connect(playerId: string): Room | undefined {
    const room = this.activeRoom(playerId);
    if (!room) return undefined;
    this.mutate(room.code, (r) => {
      lobby.setConnected(r, playerId, true);
      return { ok: true };
    });
    return this.store.get(room.code);
  }

  /** The player's connection dropped; their seat stays. */
  disconnect(playerId: string): Room | undefined {
    const room = this.activeRoom(playerId);
    if (!room) return undefined;
    return this.mutate(room.code, (r) => {
      lobby.setConnected(r, playerId, false);
      return { ok: true, room: r };
    }).room;
  }

  createRoom(playerId: string, nameInput: unknown): Out<{ code: string }> {
    const name = lobby.normalizeName(nameInput);
    if (!name) return fail('badName');
    const current = this.activeRoom(playerId);
    if (current) return fail('alreadyInRoom', { code: current.code });
    const code = freshCode(this.rng, (c) => this.store.has(c));
    this.store.create(lobby.newRoom(code, playerId, name));
    return { ok: true, code };
  }

  joinRoom(playerId: string, codeInput: unknown, nameInput: unknown): Out<{ code: string }> {
    const code = parseCode(codeInput);
    if (!code || !this.store.has(code)) return fail('roomNotFound');
    const name = lobby.normalizeName(nameInput);
    if (!name) return fail('badName');
    const current = this.activeRoom(playerId);
    if (current && current.code !== code) return fail('alreadyInRoom', { code: current.code });
    const res = this.mutate(code, (r) => lobby.addPlayer(r, playerId, name));
    return res.ok ? { ok: true, code } : res;
  }

  /** Leaves the room; returns what the room looks like afterwards. */
  leaveRoom(playerId: string): Out<{ code: string }> {
    const room = this.activeRoom(playerId);
    if (!room) return fail('notInRoom');
    const res = this.mutate(room.code, (r) => lobby.leave(r, playerId));
    return res.ok ? { ok: true, code: room.code } : res;
  }

  private inRoom(playerId: string, run: (room: Room) => Out): Out<{ code: string }> {
    const room = this.activeRoom(playerId);
    if (!room) return fail('notInRoom');
    const res = this.mutate(room.code, run);
    return res.ok ? { ok: true, code: room.code } : res;
  }

  setName(playerId: string, nameInput: unknown) {
    const name = lobby.normalizeName(nameInput);
    if (!name) return fail('badName');
    return this.inRoom(playerId, (r) => lobby.setName(r, playerId, name));
  }

  setRole(playerId: string, role: string | null) {
    return this.inRoom(playerId, (r) => lobby.setRole(r, playerId, role));
  }

  setMode(playerId: string, mode: GameMode, targetScore?: number) {
    return this.inRoom(playerId, (r) => lobby.setMode(r, playerId, mode, targetScore));
  }

  setTimer(playerId: string, timer: TimerConfig | null) {
    return this.inRoom(playerId, (r) => lobby.setTimer(r, playerId, timer, this.timerChoices));
  }

  setTeamMode(playerId: string, on: boolean) {
    return this.inRoom(playerId, (r) => lobby.setTeamMode(r, playerId, on));
  }

  setTeam(playerId: string, team: Team | null) {
    return this.inRoom(playerId, (r) => lobby.setTeam(r, playerId, team));
  }

  start(playerId: string) {
    return this.inRoom(playerId, (r) => {
      const at = this.now();
      const res = startGame(r, playerId, this.rng, at, this.testVp, this.testResources);
      if (res.ok) {
        r.startedAt = at;
        r.endedAt = null;
        if (r.game?.timer) this.timed.add(r.code);
      }
      return res;
    });
  }

  reset(playerId: string) {
    return this.inRoom(playerId, (r) => lobby.reset(r, playerId));
  }

  act(playerId: string, action: Action): Out<{ code: string; events: GameEvent[] }> {
    const room = this.activeRoom(playerId);
    if (!room) return fail('notInRoom');
    const res = this.mutate(room.code, (r) => {
      const done = playAction(r, playerId, action, this.rng, this.now());
      if (done.ok && r.phase === 'finished') this.markOver(r);
      return done;
    });
    return res.ok ? { ok: true, code: room.code, events: res.events } : res;
  }

  /** A game just ended: stop its clock and the timer's watch over the room. */
  private markOver(room: Room) {
    if (room.endedAt === null) room.endedAt = this.now();
    this.timed.delete(room.code);
  }

  /**
   * Looks at every timed game that is running and lets the ones whose time is up move on: a turn that ran out is ended for its
   * player, a game that ran out is finished. Returns what happened, room by room, for the socket layer to push. The time is the
   * service's own clock (injected in tests), never the sockets'.
   */
  tickTimers(): { code: string; events: GameEvent[] }[] {
    const changed: { code: string; events: GameEvent[] }[] = [];
    for (const code of [...this.timed]) {
      const room = this.store.get(code);
      if (!room || room.phase !== 'playing' || !room.game?.timer) {
        this.timed.delete(code);
        continue;
      }
      const res = this.mutate(code, (r) => {
        const done = tickGame(r, this.rng, this.now());
        if (done.ok && r.phase === 'finished') this.markOver(r);
        return done;
      });
      if (res.ok && res.events.length) changed.push({ code, events: res.events });
    }
    return changed;
  }

  preview(playerId: string, action: Action): Out<{ preview: PreviewResult }> {
    const room = this.activeRoom(playerId);
    if (!room) return fail('notInRoom');
    return previewAction(room, playerId, action);
  }

  legal(playerId: string): Out<{ legal: LegalMoves }> {
    const room = this.activeRoom(playerId);
    if (!room) return fail('notInRoom');
    if (room.phase !== 'playing' || !room.game) return fail('notInGame');
    return { ok: true, legal: legalMovesFor(room.game, playerId) };
  }

  sweep(maxIdleMs: number): string[] {
    const gone = this.store.sweep(this.now(), maxIdleMs);
    for (const code of gone) this.timed.delete(code);
    return gone;
  }
}
