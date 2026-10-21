import { describe, expect, it } from 'vitest';
import { DEV_CARD_KINDS, RESOURCES, applyAction, eventsFor, topologyOf, viewFor, type GameEvent, type GameState } from '../src';
import { act, autoSetup, give, giveCard, hand, mainPhase, mulberry32, newGame, putBuilding, stackDeck } from './helpers';

const json = (v: unknown) => JSON.stringify(v);

/** Same public situation, different secrets: hand redistributed, deck reordered, dev cards swapped for other kinds. */
function withOtherSecrets(s: GameState, secretOwner: string): GameState {
  const t = structuredClone(s);
  const p = t.players.find((x) => x.id === secretOwner)!;
  const n = RESOURCES.reduce((a, r) => a + p.hand[r], 0);
  for (const r of RESOURCES) p.hand[r] = 0;
  p.hand[RESOURCES[(n + 1) % RESOURCES.length]] = n; // a different distribution with the same card count
  t.devDeck = [...t.devDeck].reverse();
  p.devCards = p.devCards.map((c, i) => ({ ...c, kind: DEV_CARD_KINDS[(DEV_CARD_KINDS.indexOf(c.kind) + 1 + i) % DEV_CARD_KINDS.length] }));
  return t;
}

function richGame(): GameState {
  const s = mainPhase(3);
  give(s, 'p1', hand({ lumber: 2, ore: 3, grain: 1 }));
  give(s, 'p2', hand({ brick: 4, wool: 1 }));
  giveCard(s, 'p1', 'victoryPoint');
  giveCard(s, 'p1', 'knight');
  giveCard(s, 'p2', 'monopoly');
  putBuilding(s, 3, 'p1');
  return s;
}

describe('viewFor: what a player may see', () => {
  it('shows the viewer their own hand and cards', () => {
    const s = richGame();
    const me = viewFor(s, 'p1').players.find((p) => p.id === 'p1')!;
    expect(me.hand).toEqual(s.players[1].hand);
    expect(me.devCards).toHaveLength(2);
    expect(me.hiddenPoints).toBe(1);
  });

  it('replaces an opponent hand and cards by counts', () => {
    const them = viewFor(richGame(), 'p0').players.find((p) => p.id === 'p1')!;
    expect(them.hand).toBeNull();
    expect(them.devCards).toBeNull();
    expect(them.hiddenPoints).toBeNull();
    expect(them.handCount).toBe(6);
    expect(them.devCardCount).toBe(2);
    expect(them.points).toBe(1); // the settlement only, not the victory point card
  });

  it('never contains the deck, only its size', () => {
    const s = richGame();
    const v = viewFor(s, 'p0');
    expect(json(v)).not.toContain('devDeck"');
    expect(Object.keys(v)).not.toContain('devDeck');
    expect(v.devDeckCount).toBe(s.devDeck.length);
    expect(json(v)).not.toContain(json(s.devDeck));
  });

  it('opponent secrets leave no trace: changing them does not change the view', () => {
    const s = richGame();
    for (const viewer of ['p0', 'p2']) {
      expect(json(viewFor(withOtherSecrets(s, 'p1'), viewer))).toBe(json(viewFor(s, viewer)));
    }
  });

  it('the viewer\'s own secrets do show (so the check above is not trivially true)', () => {
    const s = richGame();
    expect(json(viewFor(withOtherSecrets(s, 'p1'), 'p1'))).not.toBe(json(viewFor(s, 'p1')));
  });

  it('deck order and content change no one\'s view', () => {
    const s = richGame();
    const reversed = structuredClone(s);
    reversed.devDeck.reverse();
    const swapped = structuredClone(s);
    swapped.devDeck[0] = swapped.devDeck[0] === 'knight' ? 'monopoly' : 'knight';
    for (const id of ['p0', 'p1', 'p2']) {
      expect(json(viewFor(reversed, id))).toBe(json(viewFor(s, id)));
      expect(json(viewFor(swapped, id))).toBe(json(viewFor(s, id)));
    }
  });

  it('hidden victory points stay out of the public score for everybody', () => {
    const s = richGame();
    for (const id of ['p0', 'p1', 'p2']) expect(viewFor(s, id).players.find((p) => p.id === 'p1')!.points).toBe(1);
    expect(viewFor(s, 'p1').players.find((p) => p.id === 'p1')!.hiddenPoints).toBe(1);
  });

  it('everything is revealed once the game is over', () => {
    const s = richGame();
    s.phase = 'finished';
    s.winner = 'p1';
    const them = viewFor(s, 'p0').players.find((p) => p.id === 'p1')!;
    expect(them.devCards).toHaveLength(2);
    expect(them.hiddenPoints).toBe(1);
    expect(them.hand).not.toBeNull();
  });

  it('a spectator sees no hands at all', () => {
    const v = viewFor(richGame(), 'nobody');
    expect(v.players.every((p) => p.hand === null && p.devCards === null && p.hiddenPoints === null)).toBe(true);
    expect(v.mine).toBeNull();
  });

  it('carries the viewer\'s own costs and ratios', () => {
    const s = mainPhase(2, { roles: ['sage', 'sailor'] });
    const a = viewFor(s, 'p0');
    const b = viewFor(s, 'p1');
    expect(a.mine!.costs.devCard).toEqual(hand({ grain: 1, ore: 1 }));
    expect(b.mine!.costs.devCard).toEqual(hand({ wool: 1, grain: 1, ore: 1 }));
    expect(a.mine!.bankRatios.ore).toBe(4);
    expect(b.mine!.bankRatios.ore).toBe(3);
  });

  it('is plain JSON and does not alias the state', () => {
    const s = richGame();
    const v = viewFor(s, 'p1');
    expect(JSON.parse(json(v))).toEqual(v);
    v.bank.ore = 0;
    v.players[1].hand!.ore = 99;
    expect(s.bank.ore).toBe(19 - 3);
    expect(s.players[1].hand.ore).toBe(3);
  });

  it('holds throughout real games: opponent secrets never reach a view', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const rng = mulberry32(seed);
      let s = autoSetup(newGame(3, { seed }), rng);
      for (let i = 0; i < 40 && s.phase !== 'finished'; i++) {
        let pid = s.current;
        let action: Parameters<typeof applyAction>[2];
        if (s.phase === 'roll') action = { type: 'roll' };
        else if (s.phase === 'discard') {
          pid = Object.keys(s.pendingDiscards)[0];
          const p = s.players.find((x) => x.id === pid)!;
          const h = hand();
          let need = s.pendingDiscards[pid];
          for (const res of RESOURCES) {
            const take = Math.min(need, p.hand[res]);
            h[res] = take;
            need -= take;
          }
          action = { type: 'discard', resources: h };
        } else if (s.phase === 'robber') action = { type: 'moveRobber', tile: (s.robber + 1) % s.tiles.length };
        else if (s.phase === 'steal') action = { type: 'steal', victim: s.stealFrom[0] };
        else action = { type: 'endTurn' };
        s = act(s, pid, action, rng);
        for (const viewer of s.players) {
          const mine = json(viewFor(s, viewer.id));
          for (const other of s.players) {
            if (other.id === viewer.id) continue;
            if (json(viewFor(withOtherSecrets(s, other.id), viewer.id)) !== mine) throw new Error(`secret of ${other.id} leaked to ${viewer.id}`);
          }
        }
      }
    }
  });
});

describe('the dice event is public', () => {
  it('lists the same tiles to everyone and does not depend on hidden cards', () => {
    const s = richGame();
    s.phase = 'roll';
    s.tiles.forEach((t, i) => (t.number = i === 9 ? 8 : t.kind === 'desert' ? null : 4));
    putBuilding(s, topologyOf(s.map).tiles[9].corners[0], 'p1');
    const roll = (state: GameState) => {
      const r = applyAction(state, state.current, { type: 'roll' }, mulberry32(11));
      if (!r.ok) throw new Error('refused');
      return r.events;
    };
    // find a roll of 8 by trying seeds, so the tile is really hit
    let events: GameEvent[] = [];
    for (let seed = 1; seed < 400 && !events.length; seed++) {
      const r = applyAction(s, s.current, { type: 'roll' }, mulberry32(seed));
      if (r.ok && r.events.some((e) => e.type === 'diceRolled' && e.total === 8)) events = r.events.filter((e) => e.type === 'diceRolled');
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ hitTiles: [9] });
    for (const p of s.players) expect(eventsFor(events, p.id)).toEqual(events);
    // the same public position with other hands and decks gives the very same event
    const other = withOtherSecrets(s, 'p1');
    expect(roll(other).filter((e) => e.type === 'diceRolled')).toEqual(roll(s).filter((e) => e.type === 'diceRolled'));
    // and the lists carry nothing but tile ids
    expect(json(events[0])).toBe(json({ type: 'diceRolled', player: s.current, dice: (events[0] as any).dice, total: 8, hitTiles: [9], robbedTile: null }));
  });
});

describe('eventFor: event redaction', () => {
  const stolen: GameEvent = { type: 'stolen', thief: 'p0', victim: 'p1', resource: 'ore' };
  const bought: GameEvent = { type: 'devCardBought', player: 'p1', kind: 'victoryPoint' };

  it('what was stolen is visible to the thief and the victim only', () => {
    expect(eventsFor([stolen], 'p0')[0]).toEqual(stolen);
    expect(eventsFor([stolen], 'p1')[0]).toEqual(stolen);
    expect(eventsFor([stolen], 'p2')[0]).toEqual({ ...stolen, resource: null });
  });

  it('the kind of a bought card is visible to the buyer only', () => {
    expect(eventsFor([bought], 'p1')[0]).toEqual(bought);
    expect(eventsFor([bought], 'p0')[0]).toEqual({ ...bought, kind: null });
  });

  it('a real steal does not reveal the card to a third player', () => {
    const s = mainPhase(3);
    const topo = topologyOf(s.map);
    putBuilding(s, topo.tiles[9].corners[0], 'p1');
    give(s, 'p1', hand({ ore: 1 }));
    s.phase = 'robber';
    const r = applyAction(s, 'p0', { type: 'moveRobber', tile: 9 }, mulberry32(1));
    if (!r.ok) throw new Error('refused');
    const theirs = json(eventsFor(r.events, 'p2'));
    expect(theirs).toContain('"stolen"');
    expect(theirs).not.toContain('ore');
    expect(json(eventsFor(r.events, 'p0'))).toContain('ore');
  });

  it('a real purchase does not reveal the card to the others', () => {
    const s = mainPhase(3);
    stackDeck(s, 'victoryPoint');
    give(s, 'p0', hand({ wool: 1, grain: 1, ore: 1 }));
    const r = applyAction(s, 'p0', { type: 'buyDevCard' }, mulberry32(1));
    if (!r.ok) throw new Error('refused');
    expect(json(eventsFor(r.events, 'p1'))).not.toContain('victoryPoint');
    expect(json(eventsFor(r.events, 'p0'))).toContain('victoryPoint');
  });
});
