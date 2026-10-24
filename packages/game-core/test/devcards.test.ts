import { describe, expect, it } from 'vitest';
import {
  DEV_CARD_KINDS, RESOURCES, applyAction, legalDevPlays, legalRoadEdges, longestRoadFor, publicPoints, topologyOf, totalPoints, validate, type GameState,
} from '../src';
import { act, dice, findPath, give, giveCard, hand, mainPhase, newGame, putBuilding, putRoad, scripted, stackDeck } from './helpers';

const deckTotal = (s: GameState) =>
  s.devDeck.length + DEV_CARD_KINDS.reduce((a, k) => a + s.devPlayed[k], 0) + s.players.reduce((a, p) => a + p.devCards.length, 0);

describe('deck and buying', () => {
  it('starts with 25 cards in the documented mix, in all modes', () => {
    for (const s of [newGame(3), newGame(2, { mode: 'short' }), newGame(5)]) {
      expect(s.devDeck).toHaveLength(25);
      const count = (k: string) => s.devDeck.filter((c) => c === k).length;
      expect([count('knight'), count('victoryPoint'), count('roadBuilding'), count('yearOfPlenty'), count('monopoly')]).toEqual([14, 5, 2, 2, 2]);
    }
  });

  it('the deck order depends on the seed', () => {
    expect(newGame(3, { seed: 1 }).devDeck).not.toEqual(newGame(3, { seed: 2 }).devDeck);
  });

  it('buying costs wool+grain+ore, goes to the bank, and takes the top card', () => {
    let s = mainPhase(2);
    stackDeck(s, 'monopoly');
    expect(validate(s, 'p0', { type: 'buyDevCard' })).toMatchObject({ type: 'cannotAfford' });
    give(s, 'p0', hand({ wool: 1, grain: 1, ore: 1 }));
    s = act(s, 'p0', { type: 'buyDevCard' });
    expect(s.players[0].hand).toEqual(hand());
    expect(s.players[0].devCards).toEqual([{ kind: 'monopoly', boughtTurn: 1 }]);
    expect(s.devDeck).toHaveLength(24);
    for (const r of RESOURCES) expect(s.bank[r]).toBe(19);
    expect(deckTotal(s)).toBe(25);
  });

  it('an empty deck cannot be bought from', () => {
    const s = mainPhase(2);
    give(s, 'p0', hand({ wool: 1, grain: 1, ore: 1 }));
    s.devDeck = [];
    expect(validate(s, 'p0', { type: 'buyDevCard' })).toMatchObject({ type: 'deckEmpty' });
  });
});

describe('play restrictions', () => {
  it('a card bought this turn cannot be played, next turn it can', () => {
    const s = mainPhase(2);
    giveCard(s, 'p0', 'monopoly', s.turn);
    expect(validate(s, 'p0', { type: 'playMonopoly', resource: 'ore' })).toMatchObject({ type: 'devCardNotPlayable', reason: 'boughtThisTurn' });
    s.turn += 1;
    expect(validate(s, 'p0', { type: 'playMonopoly', resource: 'ore' })).toBeNull();
  });

  it('a card you do not hold cannot be played', () => {
    const s = mainPhase(2);
    expect(validate(s, 'p0', { type: 'playKnight' })).toMatchObject({ type: 'noDevCard' });
  });

  it('only one development card per turn; the counter resets next turn', () => {
    let s = mainPhase(2);
    giveCard(s, 'p0', 'monopoly');
    giveCard(s, 'p0', 'monopoly');
    s = act(s, 'p0', { type: 'playMonopoly', resource: 'ore' });
    expect(validate(s, 'p0', { type: 'playMonopoly', resource: 'ore' })).toMatchObject({ reason: 'alreadyPlayed' });
    s = act(s, 'p0', { type: 'endTurn' });
    s = act(s, 'p1', { type: 'roll' }, scripted(dice(1, 2)));
    s = act(s, 'p1', { type: 'endTurn' });
    expect(validate(s, 'p0', { type: 'roll' })).toBeNull();
    s.phase = 'main';
    expect(validate(s, 'p0', { type: 'playMonopoly', resource: 'ore' })).toBeNull();
  });

  it('only the current player plays cards, and not during discard or robber phases', () => {
    const s = mainPhase(2);
    giveCard(s, 'p0', 'knight');
    giveCard(s, 'p1', 'knight');
    expect(validate(s, 'p1', { type: 'playKnight' })).toMatchObject({ type: 'notYourTurn' });
    s.phase = 'robber';
    expect(validate(s, 'p0', { type: 'playKnight' })).toMatchObject({ type: 'wrongPhase' });
    s.phase = 'discard';
    expect(validate(s, 'p0', { type: 'playKnight' })).toMatchObject({ type: 'wrongPhase' });
  });

  it('other cards cannot be played before the roll', () => {
    const s = mainPhase(2);
    s.phase = 'roll';
    giveCard(s, 'p0', 'monopoly');
    giveCard(s, 'p0', 'knight');
    expect(validate(s, 'p0', { type: 'playMonopoly', resource: 'ore' })).toMatchObject({ type: 'wrongPhase' });
    expect(validate(s, 'p0', { type: 'playKnight' })).toBeNull();
  });

  it('the legal list only offers what validates', () => {
    const s = mainPhase(2);
    giveCard(s, 'p0', 'monopoly');
    giveCard(s, 'p0', 'knight');
    giveCard(s, 'p0', 'victoryPoint');
    const plays = legalDevPlays(s, 'p0');
    expect(plays.filter((p) => p.type === 'playMonopoly')).toHaveLength(5);
    expect(plays.some((p) => p.type === 'playKnight')).toBe(true);
    expect(plays.some((p) => p.type === 'playYearOfPlenty')).toBe(false);
    for (const p of plays) expect(validate(s, 'p0', p)).toBeNull();
  });
});

describe('knight and the phase machine', () => {
  function setting() {
    const s = mainPhase(3);
    const topo = topologyOf(s.map);
    const c = topo.tiles[9].corners;
    putBuilding(s, c[0], 'p1');
    return { s, tile: 9 };
  }

  it('played in the main phase: move the robber, steal, back to main', () => {
    const { s, tile } = setting();
    give(s, 'p1', hand({ ore: 1 }));
    giveCard(s, 'p0', 'knight');
    let g = act(s, 'p0', { type: 'playKnight' });
    expect(g.phase).toBe('robber');
    expect(g.returnPhase).toBe('main');
    expect(g.players[0].knightsPlayed).toBe(1);
    expect(g.devPlayed.knight).toBe(1);
    g = act(g, 'p0', { type: 'moveRobber', tile });
    expect(g.phase).toBe('main');
    expect(g.returnPhase).toBeNull();
    expect(g.players[0].hand.ore).toBe(1);
    expect(deckTotal(g)).toBe(25);
  });

  it('played before the roll: after the robber the player is back at the roll', () => {
    const { s, tile } = setting();
    s.phase = 'roll';
    give(s, 'p1', hand({ ore: 1 }));
    giveCard(s, 'p0', 'knight');
    let g = act(s, 'p0', { type: 'playKnight' });
    expect(g.returnPhase).toBe('roll');
    g = act(g, 'p0', { type: 'moveRobber', tile });
    expect(g.phase).toBe('roll');
    expect(validate(g, 'p0', { type: 'roll' })).toBeNull();
    g = act(g, 'p0', { type: 'roll' }, scripted(dice(1, 2)));
    expect(g.phase).toBe('main');
  });

  it('before the roll with several victims: steal phase, then back to the roll', () => {
    const { s, tile } = setting();
    const topo = topologyOf(s.map);
    putBuilding(s, topo.tiles[9].corners[2], 'p2');
    s.phase = 'roll';
    give(s, 'p1', hand({ ore: 1 }));
    give(s, 'p2', hand({ wool: 1 }));
    giveCard(s, 'p0', 'knight');
    let g = act(s, 'p0', { type: 'playKnight' });
    g = act(g, 'p0', { type: 'moveRobber', tile });
    expect(g.phase).toBe('steal');
    g = act(g, 'p0', { type: 'steal', victim: 'p1' });
    expect(g.phase).toBe('roll');
  });

  it('a seven rolled after a pre-roll knight still returns to main', () => {
    const { s, tile } = setting();
    s.phase = 'roll';
    giveCard(s, 'p0', 'knight');
    let g = act(s, 'p0', { type: 'playKnight' });
    g = act(g, 'p0', { type: 'moveRobber', tile });
    g = act(g, 'p0', { type: 'roll' }, scripted(dice(3, 4)));
    expect(g.phase).toBe('robber');
    g = act(g, 'p0', { type: 'moveRobber', tile: 3 });
    expect(g.phase).toBe('main');
  });
});

describe('largest army', () => {
  function play(s: GameState, pid: string) {
    s.current = pid;
    s.phase = 'main';
    s.turnFlags.devPlayed = false;
    giveCard(s, pid, 'knight');
    let g = act(s, pid, { type: 'playKnight' });
    const tile = g.robber === 0 ? 1 : 0;
    g = act(g, pid, { type: 'moveRobber', tile });
    return g;
  }

  it('needs 3 knights, is worth 2 points, ties keep the holder, more knights take it', () => {
    let s = mainPhase(2);
    s.vpToWin = 99;
    s = play(s, 'p0');
    s = play(s, 'p0');
    expect(s.largestArmy.holder).toBeNull();
    s = play(s, 'p0');
    expect(s.largestArmy).toEqual({ holder: 'p0', size: 3 });
    s.players[1].knightsPlayed = 2;
    s = play(s, 'p1');
    expect(s.players[1].knightsPlayed).toBe(3);
    expect(s.largestArmy.holder).toBe('p0');
    s = play(s, 'p1');
    expect(s.largestArmy).toEqual({ holder: 'p1', size: 4 });
  });

  it('is worth 2 public points', () => {
    const s = mainPhase(2);
    s.largestArmy = { holder: 'p0', size: 3 };
    expect(publicPoints(s, 'p0')).toBe(2);
    expect(publicPoints(s, 'p1')).toBe(0);
  });
});

describe('road building', () => {
  it('gives two free roads and returns to main', () => {
    let s = mainPhase(2);
    putBuilding(s, 0, 'p0');
    giveCard(s, 'p0', 'roadBuilding');
    s = act(s, 'p0', { type: 'playRoadBuilding' });
    expect(s.phase).toBe('roadBuilding');
    expect(s.roadBuildingLeft).toBe(2);
    const first = legalRoadEdges(s, 'p0')[0];
    s = act(s, 'p0', { type: 'placeRoad', edge: first });
    expect(s.phase).toBe('roadBuilding');
    s = act(s, 'p0', { type: 'placeRoad', edge: legalRoadEdges(s, 'p0')[0] });
    expect(s.phase).toBe('main');
    expect(s.returnPhase).toBeNull();
    expect(Object.values(s.roads).filter((o) => o === 'p0')).toHaveLength(2);
    expect(s.players[0].hand).toEqual(hand());
    for (const r of RESOURCES) expect(s.bank[r]).toBe(19);
  });

  it('the legal list ignores resources during the card', () => {
    let s = mainPhase(2);
    putBuilding(s, 0, 'p0');
    giveCard(s, 'p0', 'roadBuilding');
    s = act(s, 'p0', { type: 'playRoadBuilding' });
    expect(legalRoadEdges(s, 'p0').length).toBeGreaterThan(0);
    expect(validate(s, 'p1', { type: 'placeRoad', edge: 0 })).toMatchObject({ type: 'notYourTurn' });
    expect(validate(s, 'p0', { type: 'endTurn' })).toMatchObject({ type: 'wrongPhase' });
    expect(validate(s, 'p0', { type: 'buyDevCard' })).toMatchObject({ type: 'wrongPhase' });
  });

  it('the second road drops automatically when the road limit is reached', () => {
    let s = mainPhase(2);
    const path = findPath(s, 14);
    path.forEach((e) => putRoad(s, e, 'p0'));
    giveCard(s, 'p0', 'roadBuilding');
    s = act(s, 'p0', { type: 'playRoadBuilding' });
    expect(s.phase).toBe('roadBuilding');
    const r = applyAction(s, 'p0', { type: 'placeRoad', edge: legalRoadEdges(s, 'p0')[0] }, () => 0.5);
    if (!r.ok) throw new Error('refused');
    expect(r.state.phase).toBe('main');
    expect(r.state.roadBuildingLeft).toBe(0);
    expect(r.events).toContainEqual({ type: 'roadBuildingEnded', player: 'p0', unused: 1 });
  });

  it('is not playable when the player has no legal road spot at all', () => {
    const s = mainPhase(2);
    giveCard(s, 'p0', 'roadBuilding');
    expect(validate(s, 'p0', { type: 'playRoadBuilding' })).toMatchObject({ type: 'devCardNotPlayable', reason: 'noRoadSpot' });
    const full = mainPhase(2);
    findPath(full, 15).forEach((e) => putRoad(full, e, 'p0'));
    giveCard(full, 'p0', 'roadBuilding');
    expect(validate(full, 'p0', { type: 'playRoadBuilding' })).toMatchObject({ reason: 'noRoadSpot' });
  });

  it('can end the free roads early when they run out of space and the player is never locked', () => {
    let s = mainPhase(2);
    putBuilding(s, 0, 'p0');
    const topo = topologyOf(s.map);
    // wall in vertex 0's neighbourhood: every edge touching a neighbour is taken except a single one
    const edges = new Set<number>();
    for (const n of topo.vertices[0].neighbors) topo.vertices[n].edges.forEach((e) => edges.add(e));
    const open = topo.vertices[0].edges[0];
    for (const e of edges) if (e !== open) putRoad(s, e, 'p1');
    giveCard(s, 'p0', 'roadBuilding');
    s = act(s, 'p0', { type: 'playRoadBuilding' });
    s = act(s, 'p0', { type: 'placeRoad', edge: open });
    expect(s.phase).toBe('main');
    expect(longestRoadFor(s, 'p0')).toBe(1);
  });
});

describe('year of plenty and monopoly', () => {
  it('year of plenty takes any two resources from the bank', () => {
    let s = mainPhase(2);
    giveCard(s, 'p0', 'yearOfPlenty');
    s = act(s, 'p0', { type: 'playYearOfPlenty', a: 'ore', b: 'ore' });
    expect(s.players[0].hand).toEqual(hand({ ore: 2 }));
    expect(s.bank.ore).toBe(17);
  });

  it('is not playable when the bank cannot supply the choice', () => {
    const s = mainPhase(2);
    giveCard(s, 'p0', 'yearOfPlenty');
    s.bank.ore = 1;
    expect(validate(s, 'p0', { type: 'playYearOfPlenty', a: 'ore', b: 'ore' })).toMatchObject({ type: 'bankLacks', resource: 'ore' });
    expect(validate(s, 'p0', { type: 'playYearOfPlenty', a: 'ore', b: 'wool' })).toBeNull();
    s.bank.ore = 0;
    expect(validate(s, 'p0', { type: 'playYearOfPlenty', a: 'ore', b: 'wool' })).toMatchObject({ type: 'bankLacks' });
    expect(validate(s, 'p0', { type: 'playYearOfPlenty', a: 'gold' as never, b: 'wool' })).toMatchObject({ type: 'invalidTarget' });
  });

  it('monopoly collects one resource from everybody else', () => {
    let s = mainPhase(3);
    giveCard(s, 'p0', 'monopoly');
    give(s, 'p0', hand({ wool: 1 }));
    give(s, 'p1', hand({ wool: 3, ore: 2 }));
    give(s, 'p2', hand({ wool: 2 }));
    const r = applyAction(s, 'p0', { type: 'playMonopoly', resource: 'wool' }, () => 0.5);
    if (!r.ok) throw new Error('refused');
    s = r.state;
    expect(s.players[0].hand.wool).toBe(6);
    expect(s.players[1].hand).toEqual(hand({ ore: 2 }));
    expect(s.players[2].hand.wool).toBe(0);
    expect(r.events).toContainEqual({ type: 'monopolyCollected', player: 'p0', resource: 'wool', count: 5 });
  });
});

describe('victory point cards', () => {
  it('stay out of the public score but win the game for their owner on their own turn', () => {
    let s = mainPhase(2);
    s.vpToWin = 3;
    putBuilding(s, 0, 'p0');
    giveCard(s, 'p0', 'victoryPoint');
    giveCard(s, 'p0', 'victoryPoint');
    expect(publicPoints(s, 'p0')).toBe(1);
    expect(totalPoints(s, 'p0')).toBe(3);
    give(s, 'p0', hand({ lumber: 1 }));
    s = act(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { ore: 1 } });
    expect(s.phase).toBe('finished');
    expect(s.winners).toEqual(['p0']);
  });

  it('hidden cards of an opponent do not end the game on your turn, only on theirs', () => {
    let s = mainPhase(2);
    s.vpToWin = 3;
    putBuilding(s, 0, 'p1');
    giveCard(s, 'p1', 'victoryPoint');
    giveCard(s, 'p1', 'victoryPoint');
    give(s, 'p0', hand({ lumber: 1 }));
    s = act(s, 'p0', { type: 'offerTrade', give: { lumber: 1 }, want: { ore: 1 } });
    expect(s.phase).toBe('main');
    s = act(s, 'p0', { type: 'endTurn' });
    expect(s.phase).toBe('finished');
    expect(s.winners).toEqual(['p1']);
  });

  it('buying the deciding card wins immediately', () => {
    let s = mainPhase(2);
    s.vpToWin = 2;
    putBuilding(s, 0, 'p0');
    stackDeck(s, 'victoryPoint');
    give(s, 'p0', hand({ wool: 1, grain: 1, ore: 1 }));
    s = act(s, 'p0', { type: 'buyDevCard' });
    expect(s.winners).toEqual(['p0']);
  });

  it('victory point cards are never playable', () => {
    const s = mainPhase(2);
    giveCard(s, 'p0', 'victoryPoint');
    expect(legalDevPlays(s, 'p0')).toEqual([]);
  });
});
