import { describe, expect, it } from 'vitest';
import {
  applyAction, createGame, legalRoadEdges, legalSettlementVertices, tickTimers, totalPoints, viewFor, ROLE_LIST, type GameState,
} from '../src';
import { autoSetup, give, hand, mainPhase, mulberry32, newGame, putBuilding, putRoad } from './helpers';

const T0 = 1_000_000;
const SEC = 1000;

/** Makes a test state a timed game whose game and current turn both began at T0. */
function timed(s: GameState, turnSeconds = 90, gameSeconds = 1800): GameState {
  s.timer = { turnSeconds, gameSeconds };
  s.gameStartedAt = T0;
  s.turnStartedAt = T0;
  return s;
}

const tick = (s: GameState, at: number, seed = 3) => {
  const r = tickTimers(s, mulberry32(seed), at);
  if (!r.ok) throw new Error(`tick refused: ${JSON.stringify(r.error)}`);
  return r;
};

describe('a game without a timer', () => {
  it('is not touched by the clock, and `now` changes nothing', () => {
    const s = mainPhase(3);
    const r = tick(s, T0 + 10_000_000 * SEC);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
    expect(s.timer).toBeNull();
    expect(s.gameStartedAt).toBeNull();
    expect(s.turnStartedAt).toBeNull();

    const withNow = applyAction(s, 'p0', { type: 'endTurn' }, mulberry32(1), T0);
    const without = applyAction(s, 'p0', { type: 'endTurn' }, mulberry32(1));
    expect(withNow).toEqual(without);
    expect(withNow.ok && withNow.state.turnStartedAt).toBeNull();
  });

  it('plays a whole setup the same with and without a clock handed in', () => {
    const a = autoSetup(newGame(3, { seed: 4 }), mulberry32(8));
    const b = autoSetup(newGame(3, { seed: 4 }), mulberry32(8));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.timer).toBeNull();
  });
});

describe('creating a timed or custom game', () => {
  const players = [0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, role: ROLE_LIST[i].id }));

  it('starts the game clock from the time it is given, and the turn clock with the first turn', () => {
    const r = createGame({ players, mode: 'standard', timer: { turnSeconds: 60, gameSeconds: 1800 } }, mulberry32(1), T0);
    if (!r.ok) throw new Error('create failed');
    expect(r.state.timer).toEqual({ turnSeconds: 60, gameSeconds: 1800 });
    expect(r.state.gameStartedAt).toBe(T0);
    expect(r.state.turnStartedAt).toBeNull(); // setup is not timed
    expect(viewFor(r.state, 'p0').timer).toEqual({ turnSeconds: 60, gameSeconds: 1800 });
  });

  it('refuses a timer without a clock or with nonsense limits', () => {
    for (const [timer, now] of [
      [{ turnSeconds: 60, gameSeconds: 1800 }, undefined],
      [{ turnSeconds: 0, gameSeconds: 1800 }, T0],
      [{ turnSeconds: 60, gameSeconds: -1 }, T0],
      [{ turnSeconds: 1.5, gameSeconds: 1800 }, T0],
    ] as const) {
      const r = createGame({ players, mode: 'standard', timer }, mulberry32(1), now);
      expect(r.ok).toBe(false);
    }
  });

  it('takes a target of 5 to 15 in custom mode only, and keeps the bank and the map by player count', () => {
    for (const t of [5, 10, 15]) {
      const r = createGame({ players, mode: 'custom', targetScore: t }, mulberry32(1));
      expect(r.ok && r.state.vpToWin).toBe(t);
    }
    for (const bad of [4, 16, 7.5, NaN, undefined]) {
      expect(createGame({ players, mode: 'custom', targetScore: bad as number }, mulberry32(1)).ok).toBe(false);
    }
    expect(createGame({ players, mode: 'standard', targetScore: 8 }, mulberry32(1)).ok).toBe(false);
    expect(createGame({ players, mode: 'short', targetScore: 8 }, mulberry32(1)).ok).toBe(false);

    const five = [0, 1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `P${i}`, role: ROLE_LIST[i].id }));
    for (const [list, n] of [[players, 3], [five, 5]] as const) {
      const std = createGame({ players: list, mode: 'standard' }, mulberry32(2));
      const cus = createGame({ players: list, mode: 'custom', targetScore: 6 }, mulberry32(2));
      if (!std.ok || !cus.ok) throw new Error('create failed');
      expect(cus.state.bank).toEqual(std.state.bank);
      expect(cus.state.map.id).toBe(std.state.map.id);
      expect(cus.state.bank.ore).toBe(n === 5 ? 24 : 19);
    }
  });
});

describe('the turn time running out', () => {
  it('does nothing until the limit, then ends the turn at exactly the limit', () => {
    const s = timed(mainPhase(3), 90);
    expect(tick(s, T0 + 89_999).events).toEqual([]);
    const r = tick(s, T0 + 90 * SEC);
    expect(r.state.current).toBe('p1');
    expect(r.state.phase).toBe('roll');
    expect(r.state.turn).toBe(s.turn + 1);
    expect(r.state.turnStartedAt).toBe(T0 + 90 * SEC);
    expect(r.events.map((e) => e.type)).toEqual(['turnTimedOut', 'turnEnded', 'turnStarted']);
    expect(r.events[0]).toEqual({ type: 'turnTimedOut', player: 'p0' });
  });

  it('keeps what the player built and traded before the time ran out, and the cards stay in their hand', () => {
    const s = timed(mainPhase(3));
    give(s, 'p0', { lumber: 3, brick: 2, wool: 1 });
    putBuilding(s, 0, 'p0');
    putRoad(s, 0, 'p0');
    const r = tick(s, T0 + 200 * SEC);
    expect(r.state.buildings[0]).toEqual({ owner: 'p0', kind: 'settlement' });
    expect(r.state.roads[0]).toBe('p0');
    expect(r.state.players[0].hand).toEqual(hand({ lumber: 3, brick: 2, wool: 1 }));
  });

  it('rolls for a player who never rolled, then ends their turn', () => {
    const s = timed(mainPhase(3));
    s.phase = 'roll';
    const r = tick(s, T0 + 91 * SEC);
    expect(r.events.map((e) => e.type)).toContain('diceRolled');
    expect(r.state.current).toBe('p1');
    expect(r.state.phase).toBe('roll');
  });

  it('settles a pending discard with random legal cards, then the robber, then ends the turn', () => {
    const s = timed(mainPhase(3));
    s.phase = 'discard';
    s.returnPhase = 'main';
    give(s, 'p1', { lumber: 4, brick: 4 });
    s.pendingDiscards = { p1: 4 };
    putBuilding(s, 0, 'p1'); // so a robber move can steal from someone
    const r = tick(s, T0 + 91 * SEC);
    expect(r.state.players[1].hand.lumber + r.state.players[1].hand.brick).toBeLessThanOrEqual(4);
    expect(r.state.pendingDiscards).toEqual({});
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['discarded', 'robberMoved', 'turnEnded']));
    expect(r.state.current).toBe('p1');
    expect(r.state.phase).toBe('roll');
  });

  it('gives up unplaced free roads when the time runs out in the middle of road building', () => {
    const s = timed(mainPhase(3));
    s.phase = 'roadBuilding';
    s.returnPhase = 'main';
    s.roadBuildingLeft = 2;
    const r = tick(s, T0 + 91 * SEC);
    expect(r.events.map((e) => e.type)).toEqual(['turnTimedOut', 'roadBuildingEnded', 'turnEnded', 'turnStarted']);
    expect(r.state.roadBuildingLeft).toBe(0);
    expect(r.state.current).toBe('p1');
  });

  it('chooses a victim when the robber has several to steal from', () => {
    const s = timed(mainPhase(3));
    s.phase = 'steal';
    s.returnPhase = 'main';
    s.stealFrom = ['p1', 'p2'];
    give(s, 'p1', { ore: 1 });
    give(s, 'p2', { ore: 1 });
    const r = tick(s, T0 + 91 * SEC);
    expect(r.events.filter((e) => e.type === 'stolen')).toHaveLength(1);
    expect(r.state.current).toBe('p1');
  });

  it('is not applied during setup, but the first turn starts its clock with the `now` of the last placement', () => {
    let s = newGame(2, { seed: 6 });
    s.timer = { turnSeconds: 60, gameSeconds: 1800 };
    s.gameStartedAt = T0;
    expect(tick(s, T0 + 600 * SEC).events).toEqual([]);
    const rng = mulberry32(5);
    let now = T0;
    while (s.phase === 'setup') {
      now += SEC;
      const pid = s.current;
      const legal = s.setup!.step === 'settlement' ? legalSettlementVertices(s, pid) : legalRoadEdges(s, pid);
      const action = s.setup!.step === 'settlement' ? { type: 'placeSettlement' as const, vertex: legal[Math.floor(rng() * legal.length)] } : { type: 'placeRoad' as const, edge: legal[Math.floor(rng() * legal.length)] };
      const r = applyAction(s, pid, action, rng, now);
      if (!r.ok) throw new Error('setup move refused');
      s = r.state;
    }
    expect(s.turnStartedAt).toBe(now);
  });
});

describe('the game time running out', () => {
  it('ends the game at once with the single highest scorer as the winner', () => {
    const s = timed(mainPhase(3), 5000, 1800);
    putBuilding(s, 0, 'p0');
    putBuilding(s, 10, 'p0', 'city');
    putBuilding(s, 20, 'p1');
    s.phase = 'robber';
    s.returnPhase = 'main';
    expect(tick(s, T0 + 1799 * SEC).events).toEqual([]);
    const r = tick(s, T0 + 1800 * SEC);
    expect(r.state.phase).toBe('finished');
    expect(r.state.winners).toEqual(['p0']);
    expect(r.state.returnPhase).toBeNull();
    expect(r.events).toEqual([{ type: 'gameWon', players: ['p0'], points: 3, reason: 'time' }]);
  });

  it('names every player on the top score when it is level', () => {
    const s = timed(mainPhase(4), 90, 1800);
    putBuilding(s, 0, 'p0');
    putBuilding(s, 10, 'p2');
    putBuilding(s, 20, 'p3');
    putBuilding(s, 30, 'p3');
    const r = tick(s, T0 + 1800 * SEC);
    expect(r.state.winners).toEqual(['p3']);
    putBuilding(s, 40, 'p1');
    putBuilding(s, 50, 'p1');
    const tie = tick(s, T0 + 1800 * SEC);
    expect(tie.state.winners).toEqual(['p1', 'p3']);
    expect(tie.events[0]).toMatchObject({ type: 'gameWon', players: ['p1', 'p3'], points: 2, reason: 'time' });
  });

  it('counts hidden victory point cards', () => {
    const s = timed(mainPhase(3), 90, 1800);
    putBuilding(s, 0, 'p0');
    putBuilding(s, 10, 'p1');
    s.players[1].devCards.push({ kind: 'victoryPoint', boughtTurn: 1 });
    const r = tick(s, T0 + 1800 * SEC);
    expect(r.state.winners).toEqual(['p1']);
    expect(totalPoints(r.state, 'p1')).toBe(2);
  });

  it('takes priority over the turn time, applies in setup, and ends the game level there', () => {
    const s = timed(mainPhase(3), 60, 600);
    const r = tick(s, T0 + 100_000 * SEC);
    expect(r.events.map((e) => e.type)).toEqual(['gameWon']);

    const setup = newGame(3, { seed: 9 });
    setup.timer = { turnSeconds: 60, gameSeconds: 600 };
    setup.gameStartedAt = T0;
    const end = tick(setup, T0 + 600 * SEC);
    expect(end.state.phase).toBe('finished');
    expect(end.state.winners).toEqual(['p0', 'p1', 'p2']);
  });

  it('does nothing to a game that is already over', () => {
    const s = timed(mainPhase(3), 60, 600);
    s.phase = 'finished';
    s.winners = ['p0'];
    expect(tick(s, T0 + 10_000 * SEC).state).toBe(s);
  });

  it('leaves a win by points as a one-element list with the reason "target"', () => {
    const s = timed(mainPhase(3), 90, 1800);
    s.vpToWin = 2;
    putBuilding(s, 0, 'p0');
    putBuilding(s, 10, 'p0');
    give(s, 'p0', { wool: 1, grain: 1, ore: 1 });
    const r = applyAction(s, 'p0', { type: 'buyDevCard' }, mulberry32(1), T0 + SEC);
    if (!r.ok) throw new Error('buy refused');
    expect(r.state.phase).toBe('finished');
    expect(r.state.winners).toEqual(['p0']);
    expect(r.events.at(-1)).toEqual({ type: 'gameWon', players: ['p0'], points: 2, reason: 'target' });
  });
});
