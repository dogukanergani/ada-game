import type { Room } from './room';

/**
 * Where rooms live. In memory today; a database-backed store (rooms surviving
 * a restart) implements the same interface later.
 */
export interface RoomStore {
  create(room: Room): void;
  get(code: string): Room | undefined;
  has(code: string): boolean;
  /** the only way to change a room: `fn` edits it in place, the edited room is returned */
  update(code: string, fn: (room: Room) => void): Room;
  delete(code: string): void;
  /** codes of every room this player has a seat in */
  codesForPlayer(playerId: string): string[];
  /** deletes rooms empty since at least `maxIdleMs` before `now`; returns their codes */
  sweep(now: number, maxIdleMs: number): string[];
  size(): number;
}
