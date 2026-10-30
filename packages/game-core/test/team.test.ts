import { describe, expect, it } from 'vitest';
import {
  applyAction, createGame, legalMovesFor, legalRoleActions, legalStealVictims, tickTimers, topologyOf, validate, viewFor,
  type GameMode, type GameState, type Team,
} from '../src';
import { act, farVertices, give, giveCard, hand, mulberry32, putBuilding, putRoad } from './helpers';

const TEAMS: Record<string, Team> = { p0: 'A', p1: 'A', p2: 'B', p3: 'B' };
const ROLES = ['soldier', 'sage', 'sailor', 'diplomat'];

function players() {
  return ROLES.map((role, i) => ({ id: `p${i}`, name: `P${i}`, role }));
}

/** A team game in the main phase of p0's turn (p0 and p1 are team A, p2 and p3 team B), seated p0..p3. Custom target 5 (team target 10) unless told otherwise. */
function teamMain(opts: { mode?: GameMode; teams?: boolean } = {}): GameState {
  const mode = opts.mode ?? 'custom';
  const r = createGame(
    { players: players(), mode, ...(mode === 'custom' ? { targetScore: 5 } : {}), ...(opts.teams === false ? {} : { teams: TEAMS }) },
    mulberry32(3),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  const s = r.state;
  s.players.sort((a, b) => a.id.localeCompare(b.id));
  s.players.forEach((p, i) => (p.seat = i));
  s.phase = 'main';
  s.setup = null;
  s.turn = 1;
  s.current = 'p0';
  return s;
}

const handSize = (s: GameState, pid: string) => Object.values(s.players.find((p) => p.id === pid)!.hand).reduce((a, b) => a + b, 0);

describe('team mode: setup', () => {
  it('needs exactly 4 players and two on each team', () => {
    const bad = (teams: Record<string, Team>, ps = players()) => {
      const r = createGame({ players: ps, mode: 'standard', teams }, mulberry32(1));
      return r.ok ? null : r.error;
    };
    expect(bad({ p0: 'A', p1: 'A', p2: 'B' }, players().slice(0, 3))).toMatchObject({ type: 'invalidSetup', reason: 'teamPlayerCount' });
    expect(bad({ p0: 'A', p1: 'A', p2: 'A', p3: 'B' })).toMatchObject({ reason: 'teamAssignment' });
    expect(bad({ p0: 'A', p1: 'A', p2: 'B' })).toMatchObject({ reason: 'teamAssignment' });
    expect(bad({ p0: 'A', p1: 'A', p2: 'B', p3: 'C' } as unknown as Record<string, Team>)).toMatchObject({ reason: 'teamAssignment' });
    expect(bad(TEAMS)).toBeNull();
  });

  it('sets the team target to twice the mode target and leaves vpToWin alone', () => {
    const target = (mode: GameMode, targetScore?: number) => {
      const r = createGame({ players: players(), mode, targetScore, teams: TEAMS }, mulberry32(1));
      if (!r.ok) throw new Error('createGame failed');
      return [r.state.vpToWin, r.state.teamTarget];
    };
    expect(target('standard')).toEqual([10, 20]);
    expect(target('short')).toEqual([7, 14]);
    expect(target('custom', 8)).toEqual([8, 16]);
    const solo = createGame({ players: players(), mode: 'standard' }, mulberry32(1));
    if (!solo.ok) throw new Error('createGame failed');
    expect(solo.state.teamMode).toBe(false);
    expect(solo.state.teamTarget).toBeNull();
    expect(solo.state.players.every((p) => p.team === null)).toBe(true);
  });
});

describe('team mode: winning', () => {
  it("a team wins on the summed points, hidden victory point cards included, at the start of a member's turn", () => {
    const s = teamMain(); // team target 10
    const vs = farVertices(s, 6);
    [vs[0], vs[1], vs[2]].forEach((v) => putBuilding(s, v, 'p0', 'city')); // 6
    putBuilding(s, vs[3], 'p1', 'city'); // 8
    putBuilding(s, vs[4], 'p1'); // 9
    giveCard(s, 'p1', 'victoryPoint'); // a hidden point: 10
    const next = act(s, 'p0', { type: 'endTurn' }); // p1's turn begins
    expect(next.phase).toBe('finished');
    expect([...next.winners].sort()).toEqual(['p0', 'p1']);
  });

  it('does not win one point short', () => {
    const s = teamMain();
    const vs = farVertices(s, 6);
    [vs[0], vs[1], vs[2]].forEach((v) => putBuilding(s, v, 'p0', 'city'));
    putBuilding(s, vs[3], 'p1', 'city');
    putBuilding(s, vs[4], 'p1'); // 9
    expect(act(s, 'p0', { type: 'endTurn' }).phase).toBe('roll');
  });

  it('one player over the single-player target does not win alone; the rival team wins only when its own turn comes', () => {
    const s = teamMain();
    const vs = farVertices(s, 9);
    for (let i = 0; i < 4; i++) putBuilding(s, vs[i], 'p0', 'city'); // 8 > 5, but team A has 8 < 10
    putBuilding(s, vs[4], 'p2', 'city');
    putBuilding(s, vs[5], 'p2', 'city'); // 4
    for (const v of [vs[6], vs[7], vs[8]]) putBuilding(s, v, 'p3', 'city'); // 6: team B at 10
    let n = act(s, 'p0', { type: 'endTurn' }); // p1's turn: team A still 8
    expect(n.phase).toBe('roll');
    n.phase = 'main';
    n = act(n, 'p1', { type: 'endTurn' }); // p2's turn: team B has 10
    expect(n.phase).toBe('finished');
    expect([...n.winners].sort()).toEqual(['p2', 'p3']);
  });

  it('team mode off: the old single-player check is unchanged', () => {
    const s = teamMain({ teams: false });
    const vs = farVertices(s, 3);
    [vs[0], vs[1], vs[2]].forEach((v) => putBuilding(s, v, 'p1', 'city'));
    expect(act(s, 'p0', { type: 'endTurn' }).winners).toEqual(['p1']);
  });
});

describe('team mode: timed game', () => {
  const timed = (): GameState => {
    const r = createGame({ players: players(), mode: 'standard', teams: TEAMS, timer: { turnSeconds: 60, gameSeconds: 1800 } }, mulberry32(1), 1000);
    if (!r.ok) throw new Error('createGame failed');
    return r.state;
  };
  const end = 1000 + 1800 * 1000;

  it('the best team total wins when time is up: both members, even if only one of them scored', () => {
    const s = timed();
    const vs = farVertices(s, 3);
    putBuilding(s, vs[0], 'p0');
    putBuilding(s, vs[1], 'p2'); // A 1 + ... make A higher
    putBuilding(s, vs[2], 'p1');
    const r = tickTimers(s, mulberry32(1), end);
    expect(r.ok && [...r.state.winners].sort()).toEqual(['p0', 'p1']);
    expect(r.ok && r.events.find((e) => e.type === 'gameWon')).toMatchObject({ points: 2, reason: 'time' });
  });

  it('a level game lists all four players', () => {
    const s = timed();
    const vs = farVertices(s, 2);
    putBuilding(s, vs[0], 'p0');
    putBuilding(s, vs[1], 'p3');
    const r = tickTimers(s, mulberry32(1), end);
    expect(r.ok && [...r.state.winners].sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
});

describe('team mode: gifts', () => {
  it('send cards at once to a teammate, off turn, as often as wanted, and leave the bank and the open offer alone', () => {
    let s = teamMain();
    give(s, 'p1', { lumber: 4, ore: 2 });
    s = act(s, 'p0', { type: 'offerTrade', give: {}, want: { wool: 1 } });
    const bank = { ...s.bank };
    const offers = s.offers;
    expect(s.current).toBe('p0');
    s = act(s, 'p1', { type: 'teamGift', to: 'p0', cards: { lumber: 3 } }); // p1 is not on turn
    s = act(s, 'p1', { type: 'teamGift', to: 'p0', cards: { lumber: 1, ore: 2 } });
    expect(s.players[0].hand).toEqual(hand({ lumber: 4, ore: 2 }));
    expect(s.players[1].hand).toEqual(hand());
    expect(s.bank).toEqual(bank);
    expect(s.offers).toEqual(offers);
    const r = applyAction(s, 'p0', { type: 'teamGift', to: 'p1', cards: { ore: 1 } }, mulberry32(1));
    expect(r.ok && r.events).toEqual([{ type: 'teamGifted', from: 'p0', to: 'p1', cards: hand({ ore: 1 }) }]);
  });

  it('is refused for an opponent, oneself, an unknown id, in a game without teams, and when the hand is short or the gift empty', () => {
    const s = teamMain();
    give(s, 'p0', { grain: 2 });
    const verdict = (a: Parameters<typeof validate>[2]) => validate(s, 'p0', a);
    expect(verdict({ type: 'teamGift', to: 'p2', cards: { grain: 1 } })).toMatchObject({ type: 'invalidTarget', reason: 'notTeammate' });
    expect(verdict({ type: 'teamGift', to: 'p0', cards: { grain: 1 } })).toMatchObject({ reason: 'notTeammate' });
    expect(verdict({ type: 'teamGift', to: 'nobody', cards: { grain: 1 } })).toMatchObject({ reason: 'notTeammate' });
    expect(verdict({ type: 'teamGift', to: 'p1', cards: { grain: 3 } })).toMatchObject({ type: 'cannotAfford' });
    expect(verdict({ type: 'teamGift', to: 'p1', cards: {} })).toMatchObject({ type: 'invalidHand' });
    expect(verdict({ type: 'teamGift', to: 'p1', cards: { grain: -1 } })).toMatchObject({ type: 'invalidHand' });
    expect(verdict({ type: 'teamGift', to: 'p1', cards: { grain: 2 } })).toBeNull();
    const solo = teamMain({ teams: false });
    give(solo, 'p0', { grain: 2 });
    expect(validate(solo, 'p0', { type: 'teamGift', to: 'p1', cards: { grain: 1 } })).toMatchObject({ reason: 'noTeamMode' });
    expect(legalMovesFor(solo, 'p0').teamGiftTargets).toEqual([]);
  });

  it('is refused in setup, and while the sender still owes a discard', () => {
    const s = teamMain();
    give(s, 'p0', { grain: 9 });
    give(s, 'p1', { grain: 9 });
    s.phase = 'discard';
    s.returnPhase = 'main';
    s.pendingDiscards = { p0: 4 };
    expect(validate(s, 'p0', { type: 'teamGift', to: 'p1', cards: { grain: 1 } })).toMatchObject({ type: 'wrongPhase' });
    expect(validate(s, 'p1', { type: 'teamGift', to: 'p0', cards: { grain: 1 } })).toBeNull(); // p1 owes nothing
    s.phase = 'setup';
    s.pendingDiscards = {};
    expect(validate(s, 'p1', { type: 'teamGift', to: 'p0', cards: { grain: 1 } })).toMatchObject({ type: 'wrongPhase' });
  });

  it('is listed in the legal moves exactly when it would be accepted', () => {
    const s = teamMain();
    expect(legalMovesFor(s, 'p1').teamGiftTargets).toEqual([]); // empty hand
    give(s, 'p1', { wool: 1 });
    expect(legalMovesFor(s, 'p1').teamGiftTargets).toEqual(['p0']);
    expect(legalMovesFor(s, 'p2').teamGiftTargets).toEqual([]);
  });
});

describe('team mode: protection', () => {
  /** Puts two buildings on one tile (not adjacent), gives both owners cards and starts the robber phase; returns the tile. */
  const robberOn = (s: GameState, owners: [string, string]) => {
    const tile = topologyOf(s.map).tiles.find((t) => t.id !== s.robber)!;
    putBuilding(s, tile.corners[0], owners[0]);
    putBuilding(s, tile.corners[2], owners[1]);
    give(s, owners[0], { ore: 2 });
    give(s, owners[1], { ore: 2 });
    s.phase = 'robber';
    s.returnPhase = 'main';
    return tile.id;
  };

  it('the robber never takes from a teammate: with a rival beside, the rival is the only victim', () => {
    const s = teamMain();
    const tile = robberOn(s, ['p1', 'p2']);
    const n = act(s, 'p0', { type: 'moveRobber', tile });
    expect(n.phase).toBe('main'); // one possible victim: stolen at once, no choice
    expect(handSize(n, 'p1')).toBe(2);
    expect(handSize(n, 'p2')).toBe(1);
    expect(handSize(n, 'p0')).toBe(1);
  });

  it('a lone teammate is no victim at all', () => {
    const s = teamMain();
    const tile = robberOn(s, ['p1', 'p1']);
    const n = act(s, 'p0', { type: 'moveRobber', tile });
    expect(n.phase).toBe('main');
    expect(handSize(n, 'p1')).toBe(4);
    expect(handSize(n, 'p0')).toBe(0);
  });

  it('without team mode the same spot gives a choice of victims', () => {
    const s = teamMain({ teams: false });
    const tile = robberOn(s, ['p1', 'p2']);
    const r = act(s, 'p0', { type: 'moveRobber', tile });
    expect(r.phase).toBe('steal');
    expect([...legalStealVictims(r, 'p0')].sort()).toEqual(['p1', 'p2']);
  });

  it("the Soldier cannot demolish a teammate's piece and it is not listed", () => {
    const s = teamMain();
    const { edges } = topologyOf(s.map);
    putRoad(s, edges[0].id, 'p1');
    putRoad(s, edges[5].id, 'p2');
    give(s, 'p0', { wool: 2, ore: 2 });
    const demolish = (id: number) => validate(s, 'p0', { type: 'roleAction', name: 'demolish', params: { kind: 'road', id } });
    expect(demolish(edges[0].id)).toMatchObject({ type: 'invalidTarget', reason: 'teammate' });
    expect(demolish(edges[5].id)).toBeNull();
    expect(legalRoleActions(s, 'p0').map((a) => (a.type === 'roleAction' ? a.params!.id : null))).toEqual([edges[5].id]);
  });

  it('without team mode that piece is a normal target', () => {
    const s = teamMain({ teams: false });
    const { edges } = topologyOf(s.map);
    putRoad(s, edges[0].id, 'p1');
    give(s, 'p0', { wool: 2, ore: 2 });
    expect(validate(s, 'p0', { type: 'roleAction', name: 'demolish', params: { kind: 'road', id: edges[0].id } })).toBeNull();
  });
});

describe('team mode: what a view tells', () => {
  it("the team total counts only the viewer's own hidden points until the game is over", () => {
    const s = teamMain();
    const vs = farVertices(s, 2);
    putBuilding(s, vs[0], 'p0');
    putBuilding(s, vs[1], 'p2');
    giveCard(s, 'p1', 'victoryPoint');
    giveCard(s, 'p2', 'victoryPoint');
    expect(viewFor(s, 'p0').teamPoints).toEqual({ A: 1, B: 1 }); // neither p1's nor p2's card is p0's to know
    expect(viewFor(s, 'p1').teamPoints).toEqual({ A: 2, B: 1 });
    expect(viewFor(s, 'p2').teamPoints).toEqual({ A: 1, B: 2 });
    expect(viewFor(s, 'p0').players.find((p) => p.id === 'p1')!.hiddenPoints).toBeNull();
    s.phase = 'finished';
    s.winners = ['p0', 'p1'];
    expect(viewFor(s, 'p0').teamPoints).toEqual({ A: 2, B: 2 });
    expect(viewFor(teamMain({ teams: false }), 'p0').teamPoints).toBeNull();
  });
});
