import type { Room } from './room';
import type { RoomStore } from './store';

export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly byPlayer = new Map<string, Set<string>>();

  private index(room: Room) {
    for (const [pid, codes] of this.byPlayer) {
      if (codes.delete(room.code) && codes.size === 0) this.byPlayer.delete(pid);
    }
    for (const s of room.seats) {
      const set = this.byPlayer.get(s.playerId) ?? new Set<string>();
      set.add(room.code);
      this.byPlayer.set(s.playerId, set);
    }
  }

  create(room: Room) {
    if (this.rooms.has(room.code)) throw new Error(`room ${room.code} exists`);
    this.rooms.set(room.code, room);
    this.index(room);
  }

  get = (code: string) => this.rooms.get(code);
  has = (code: string) => this.rooms.has(code);
  size = () => this.rooms.size;

  update(code: string, fn: (room: Room) => void): Room {
    const room = this.rooms.get(code);
    if (!room) throw new Error(`no room ${code}`);
    fn(room);
    this.index(room);
    return room;
  }

  delete(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    this.rooms.delete(code);
    for (const s of room.seats) {
      const set = this.byPlayer.get(s.playerId);
      set?.delete(code);
      if (set?.size === 0) this.byPlayer.delete(s.playerId);
    }
  }

  codesForPlayer = (playerId: string) => [...(this.byPlayer.get(playerId) ?? [])];

  sweep(now: number, maxIdleMs: number): string[] {
    const gone: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.emptySince !== null && now - room.emptySince >= maxIdleMs) gone.push(room.code);
    }
    for (const c of gone) this.delete(c);
    return gone;
  }
}
