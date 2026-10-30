import { describe, expect, it } from 'vitest';
import { ROLE_LIST } from '@ada/game-core';
import { CODE_ALPHABET, freshCode, parseCode, randomCode } from '../src/rooms/code';
import * as lobby from '../src/rooms/lobby';
import { MemoryRoomStore } from '../src/rooms/memoryStore';
import { cryptoRng } from '../src/rng';
import type { Room } from '../src/rooms/room';

const rng = cryptoRng();
const room = (...extra: string[]): Room => {
  const r = lobby.newRoom('ABCD', 'host', 'Host');
  for (const id of extra) lobby.addPlayer(r, id, id.toUpperCase());
  return r;
};
const errKey = (r: { ok: boolean } & Record<string, any>) => (r.ok ? null : r.error.key);

describe('room codes', () => {
  it('are 4 letters with confusable ones left out', () => {
    expect(CODE_ALPHABET).not.toMatch(/[ILOQ0-9]/);
    for (let i = 0; i < 200; i++) expect(randomCode(rng)).toMatch(/^[A-Z]{4}$/);
    for (let i = 0; i < 200; i++) expect([...randomCode(rng)].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
  });
  it('parse user input, case and spaces aside', () => {
    expect(parseCode(' abcd ')).toBe('ABCD');
    for (const bad of ['ABC', 'ABCDE', 'ABCO', 'AB1D', '', null, 4, {}]) expect(parseCode(bad)).toBeNull();
  });
  it('freshCode avoids taken codes and gives up when none is free', () => {
    const taken = new Set<string>();
    const c = freshCode(rng, (x) => taken.has(x));
    taken.add(c);
    expect(freshCode(rng, (x) => taken.has(x))).not.toBe(c);
    expect(() => freshCode(rng, () => true, 5)).toThrow();
  });
});

describe('lobby: joining', () => {
  it('holds 2-5 players and refuses a sixth', () => {
    const r = room('a', 'b', 'c', 'd');
    expect(r.seats).toHaveLength(5);
    expect(errKey(lobby.addPlayer(r, 'f', 'F'))).toBe('roomFull');
  });
  it('a full lobby makes room by dropping a disconnected seat (never the host)', () => {
    const r = room('a', 'b', 'c', 'd');
    lobby.setConnected(r, 'b', false);
    expect(lobby.addPlayer(r, 'f', 'F').ok).toBe(true);
    expect(r.seats.map((s) => s.playerId)).not.toContain('b');
  });
  it('refuses new players once the game started, but a seated one returns', () => {
    const r = room('a');
    r.phase = 'playing';
    expect(errKey(lobby.addPlayer(r, 'new', 'N'))).toBe('gameStarted');
    lobby.setConnected(r, 'a', false);
    expect(lobby.addPlayer(r, 'a', 'A').ok).toBe(true);
    expect(r.seats.find((s) => s.playerId === 'a')!.connected).toBe(true);
  });
});

describe('lobby: roles', () => {
  it('two players cannot take the same role; the owner can change or clear theirs', () => {
    const r = room('a');
    expect(lobby.setRole(r, 'host', 'sage').ok).toBe(true);
    expect(errKey(lobby.setRole(r, 'a', 'sage'))).toBe('roleTaken');
    expect(lobby.setRole(r, 'host', 'sage').ok).toBe(true);
    expect(lobby.setRole(r, 'host', 'sailor').ok).toBe(true);
    expect(lobby.setRole(r, 'a', 'sage').ok).toBe(true);
    expect(lobby.setRole(r, 'a', null).ok).toBe(true);
    expect(errKey(lobby.setRole(r, 'a', 'wizard'))).toBe('unknownRole');
  });
  it('players who chose nothing get distinct random roles nobody else holds', () => {
    for (let i = 0; i < 50; i++) {
      const r = room('a', 'b', 'c', 'd');
      lobby.setRole(r, 'host', 'sage');
      const plan = lobby.planStart(r, 'host', rng);
      if (!plan.ok) throw new Error('plan failed');
      const roles = plan.players.map((p) => p.role);
      expect(new Set(roles).size).toBe(5);
      expect(roles.every((x) => ROLE_LIST.some((d) => d.id === x))).toBe(true);
      expect(plan.players.find((p) => p.id === 'host')!.role).toBe('sage');
    }
  });
});

describe('lobby: host powers', () => {
  it('only the host sets the mode, starts, or resets', () => {
    const r = room('a');
    expect(errKey(lobby.setMode(r, 'a', 'short'))).toBe('notHost');
    expect(lobby.setMode(r, 'host', 'short').ok).toBe(true);
    expect(r.mode).toBe('short');
    expect(errKey(lobby.setMode(r, 'host', 'epic' as never))).toBe('badMode');
    expect(errKey(lobby.planStart(r, 'a', rng))).toBe('notHost');
    expect(errKey(lobby.reset(r, 'a'))).toBe('notHost');
    expect(errKey(lobby.reset(r, 'host'))).toBe('gameNotFinished');
    expect(errKey(lobby.setMode(r, 'stranger', 'short'))).toBe('notInRoom');
  });
  it('needs two present players to start; absent seats do not count and are dropped', () => {
    const r = room('a');
    lobby.setConnected(r, 'a', false);
    expect(errKey(lobby.planStart(r, 'host', rng))).toBe('needMorePlayers');
    lobby.addPlayer(r, 'a', 'A');
    expect(lobby.planStart(r, 'host', rng).ok).toBe(true);
    const r2 = room('a', 'b');
    lobby.setConnected(r2, 'b', false);
    const p2 = lobby.planStart(r2, 'host', rng);
    if (!p2.ok) throw new Error('plan');
    lobby.commitStart(r2, p2.players);
    expect(r2.seats.map((s) => s.playerId)).toEqual(['host', 'a']);
    expect(r2.phase).toBe('playing');
  });
  it('mode, name and role cannot change after the start', () => {
    const r = room('a');
    r.phase = 'playing';
    expect(errKey(lobby.setMode(r, 'host', 'short'))).toBe('notInLobby');
    expect(errKey(lobby.setRole(r, 'a', 'sage'))).toBe('notInLobby');
    expect(errKey(lobby.setName(r, 'a', 'X'))).toBe('notInLobby');
  });
  it('reset returns a finished room to the lobby, keeping names and roles', () => {
    const r = room('a', 'b');
    lobby.setRole(r, 'a', 'sage');
    r.phase = 'finished';
    lobby.setConnected(r, 'b', false);
    expect(lobby.reset(r, 'host').ok).toBe(true);
    expect(r.phase).toBe('lobby');
    expect(r.game).toBeNull();
    expect(r.seats.map((s) => [s.playerId, s.role])).toEqual([['host', null], ['a', 'sage']]);
  });
});

describe('lobby: host transfer', () => {
  it('passes to the next present player when the host leaves the lobby', () => {
    const r = room('a', 'b');
    lobby.leave(r, 'host');
    expect(r.hostId).toBe('a');
    expect(r.seats.map((s) => s.playerId)).toEqual(['a', 'b']);
  });
  it('passes on disconnect, and a returning host does not take it back', () => {
    const r = room('a', 'b');
    lobby.setConnected(r, 'host', false);
    expect(r.hostId).toBe('a');
    lobby.addPlayer(r, 'host', 'Host');
    expect(r.hostId).toBe('a');
  });
  it('is kept when nobody else is present; a started game keeps the leaver as an away seat', () => {
    const r = room('a');
    lobby.setConnected(r, 'a', false);
    lobby.setConnected(r, 'host', false);
    expect(r.hostId).toBe('host');
    const g = room('a');
    g.phase = 'playing';
    lobby.leave(g, 'host');
    expect(g.seats).toHaveLength(2);
    expect(g.seats[0]).toMatchObject({ away: true, connected: false });
    expect(g.hostId).toBe('a');
  });
  it('the last player leaving a lobby leaves no host', () => {
    const r = room();
    lobby.leave(r, 'host');
    expect(r.hostId).toBeNull();
    expect(lobby.addPlayer(r, 'x', 'X').ok).toBe(true);
    expect(r.hostId).toBe('x');
  });
});

describe('lobby: names and view', () => {
  it('names are trimmed, 1-24 characters, no control characters', () => {
    expect(lobby.normalizeName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    for (const bad of ['', '   ', 'x'.repeat(25), 'a\u0000b', 5, null, undefined, {}]) expect(lobby.normalizeName(bad)).toBeNull();
  });
  it('the view lists seats with host and connection flags', () => {
    const r = room('a');
    lobby.setConnected(r, 'a', false);
    const v = lobby.lobbyViewFor(r, 'host');
    expect(v).toMatchObject({ code: 'ABCD', me: 'host', hostId: 'host', mode: 'standard', phase: 'lobby', minPlayers: 2, maxPlayers: 5 });
    expect(v.players).toEqual([
      { id: 'host', name: 'Host', role: null, connected: true, host: true, team: null },
      { id: 'a', name: 'A', role: null, connected: false, host: false, team: null },
    ]);
  });
});

describe('MemoryRoomStore', () => {
  it('creates, reads, updates in place and deletes', () => {
    const s = new MemoryRoomStore();
    s.create(room('a'));
    expect(s.has('ABCD')).toBe(true);
    expect(() => s.create(room())).toThrow();
    s.update('ABCD', (r) => (r.mode = 'short'));
    expect(s.get('ABCD')!.mode).toBe('short');
    expect(() => s.update('NOPE', () => {})).toThrow();
    s.delete('ABCD');
    expect(s.get('ABCD')).toBeUndefined();
    expect(s.size()).toBe(0);
  });
  it('tracks which rooms a player sits in, through joins and leaves', () => {
    const s = new MemoryRoomStore();
    s.create(room('a'));
    expect(s.codesForPlayer('a')).toEqual(['ABCD']);
    s.update('ABCD', (r) => lobby.leave(r, 'a'));
    expect(s.codesForPlayer('a')).toEqual([]);
    s.update('ABCD', (r) => lobby.addPlayer(r, 'z', 'Z'));
    expect(s.codesForPlayer('z')).toEqual(['ABCD']);
    s.delete('ABCD');
    expect(s.codesForPlayer('z')).toEqual([]);
    expect(s.codesForPlayer('host')).toEqual([]);
  });
  it('sweeps rooms that have been empty for the whole idle time, and only those', () => {
    const s = new MemoryRoomStore();
    const H = 3 * 3600_000;
    const a = room('x');
    a.emptySince = 1000;
    const b = lobby.newRoom('WXYZ', 'q', 'Q');
    const c = lobby.newRoom('EFGH', 'w', 'W');
    c.emptySince = 5000;
    s.create(a);
    s.create(b);
    s.create(c);
    expect(s.sweep(1000 + H - 1, H)).toEqual([]);
    expect(s.sweep(1000 + H, H)).toEqual(['ABCD']);
    expect(s.sweep(5000 + H, H)).toEqual(['EFGH']);
    expect(s.size()).toBe(1);
    expect(s.codesForPlayer('x')).toEqual([]);
  });
  it('trackEmpty starts and clears the idle clock', () => {
    const r = room('a');
    lobby.setConnected(r, 'a', false);
    lobby.setConnected(r, 'host', false);
    lobby.trackEmpty(r, 100);
    expect(r.emptySince).toBe(100);
    lobby.trackEmpty(r, 200);
    expect(r.emptySince).toBe(100);
    lobby.addPlayer(r, 'a', 'A');
    lobby.trackEmpty(r, 300);
    expect(r.emptySince).toBeNull();
  });
});
