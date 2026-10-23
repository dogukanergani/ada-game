import { legalMovesFor, type Action, type GameEvent, type LegalMoves, type Rng } from '@ada/game-core';
import type { PreviewResult } from '@ada/protocol';
import { playAction, previewAction, startGame } from './game/session';
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
  ) {}

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

  setMode(playerId: string, mode: 'standard' | 'short') {
    return this.inRoom(playerId, (r) => lobby.setMode(r, playerId, mode));
  }

  start(playerId: string) {
    return this.inRoom(playerId, (r) => {
      const res = startGame(r, playerId, this.rng, this.testVp, this.testResources);
      if (res.ok) {
        r.startedAt = this.now();
        r.endedAt = null;
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
      const done = playAction(r, playerId, action, this.rng);
      if (done.ok && r.phase === 'finished' && r.endedAt === null) r.endedAt = this.now();
      return done;
    });
    return res.ok ? { ok: true, code: room.code, events: res.events } : res;
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
    return this.store.sweep(this.now(), maxIdleMs);
  }
}
