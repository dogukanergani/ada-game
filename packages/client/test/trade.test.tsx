import { describe, expect, it } from 'vitest';
import { RESOURCES, legalBankTrades, type GameState, type Hand } from '@ada/game-core';
import {
  bankGetTiles, bankGiveTiles, bankPairLegal, bankSummary, canSendOffer, defaultTab, emptyHand, incomingOffers, offerGiveTiles, offerSummary,
  offerWantTiles, ownOffer,
} from '../src/game/tradeView';
import { reach } from './fixtures';

const h = (p: Partial<Hand> = {}): Hand => ({ ...emptyHand(), ...p });

/** a main-phase moment where the mover holds something, seen by the mover and by a rival */
const m = reach((s) => s.phase === 'main' && s.turn > 10 && s.players.every((p) => RESOURCES.some((r) => p.hand[r] > 0)) && legalBankTrades(s, s.current).length > 0, { n: 3, seeds: 200 });
const mover = m.state.current;
const rival = m.state.players.find((p) => p.id !== mover)!.id;
const mine = m.of(mover);
const theirs = m.of(rival);

describe('bank tiles', () => {
  it('show the core\'s ratios, and a tile is on exactly when the server lists a trade that gives it', () => {
    const tiles = bankGiveTiles(mine.view, mine.legal, true);
    expect(tiles.map((t) => t.resource)).toEqual([...RESOURCES]);
    for (const t of tiles) {
      expect(t.ratio).toBe(mine.view.mine!.bankRatios[t.resource]);
      expect(t.enabled).toBe(mine.legal.bankTrades.some((x) => x.give === t.resource));
      expect(t.reason === null).toBe(t.enabled);
    }
  });

  it('explain an off tile: not your turn first, then how many cards are missing', () => {
    for (const t of bankGiveTiles(theirs.view, theirs.legal, false)) expect(t.reason).toEqual({ code: 'notYourTurn' });
    const tiles = bankGiveTiles(mine.view, { ...mine.legal, bankTrades: [] }, true);
    const hand = mine.view.players.find((p) => p.id === mover)!.hand!;
    for (const t of tiles) {
      if (t.have < t.ratio) expect(t.reason).toEqual({ code: 'short', n: t.ratio - t.have });
      else expect(t.reason).toEqual({ code: 'bankEmpty' });
      expect(t.have).toBe(hand[t.resource]);
    }
  });

  it('"you get" tiles follow the chosen resource: none before a choice, never the same one, never an empty bank', () => {
    for (const t of bankGetTiles(mine.view, mine.legal, null)) expect(t).toMatchObject({ enabled: false, reason: null });
    const give = mine.legal.bankTrades[0]?.give;
    if (!give) throw new Error('the mover has no bank trade in this moment');
    const get = bankGetTiles(mine.view, mine.legal, give);
    expect(get.find((t) => t.resource === give)).toMatchObject({ enabled: false, reason: { code: 'same' } });
    for (const t of get) expect(t.enabled).toBe(mine.legal.bankTrades.some((x) => x.give === give && x.get === t.resource));
    const x = RESOURCES.find((r) => r !== give && mine.legal.bankTrades.some((t) => t.give === give && t.get === r))!;
    const emptied = { ...mine.view, bank: { ...mine.view.bank, [x]: 0 } };
    const none = bankGetTiles(emptied, { ...mine.legal, bankTrades: mine.legal.bankTrades.filter((t) => t.get !== x) }, give);
    expect(none.find((t) => t.resource === x)).toMatchObject({ enabled: false, reason: { code: 'bankEmpty' } });
  });

  it('the summary names the ratio from the core, and the pair is legal only if the server lists it', () => {
    const t = mine.legal.bankTrades[0];
    const ratio = mine.view.mine!.bankRatios[t.give];
    expect(bankSummary(mine.view, null, null)).toEqual({ kind: 'none' });
    expect(bankSummary(mine.view, t.give, null)).toEqual({ kind: 'give', n: ratio, give: t.give });
    expect(bankSummary(mine.view, t.give, t.get)).toEqual({ kind: 'full', n: ratio, give: t.give, get: t.get });
    expect(bankPairLegal(mine.legal, t.give, t.get)).toBe(true);
    expect(bankPairLegal(mine.legal, t.give, t.give)).toBe(false);
    expect(bankPairLegal(mine.legal, null, t.get)).toBe(false);
  });
});

describe('offer tiles', () => {
  it('a resource cannot be both given and asked for: the other side turns off and says why', () => {
    const give = h({ ore: 1 });
    expect(offerWantTiles(h(), give, true).find((t) => t.resource === 'ore')).toMatchObject({ enabled: false, reason: { code: 'conflict', side: 'give' } });
    expect(offerGiveTiles(mine.view, h(), h({ wool: 1 }), true).find((t) => t.resource === 'wool')).toMatchObject({ enabled: false, reason: { code: 'conflict', side: 'want' } });
  });

  it('only what is in the hand can be given, up to how many are held', () => {
    const hand = mine.view.players.find((p) => p.id === mover)!.hand!;
    for (const t of offerGiveTiles(mine.view, h(), h(), true)) {
      expect(t.max).toBe(hand[t.resource]);
      expect(t.enabled).toBe(hand[t.resource] > 0);
      if (!t.enabled) expect(t.reason).toEqual({ code: 'none' });
    }
  });

  it('off their turn nothing can be chosen', () => {
    for (const t of [...offerGiveTiles(theirs.view, h(), h(), false), ...offerWantTiles(h(), h(), false)]) expect(t.reason).toEqual({ code: 'notYourTurn' });
  });

  it('summaries tell what is chosen and what is still missing; an offer needs both sides', () => {
    expect(offerSummary(h(), h())).toEqual({ kind: 'none' });
    expect(offerSummary(h({ ore: 2 }), h())).toEqual({ kind: 'give', give: h({ ore: 2 }) });
    expect(offerSummary(h(), h({ wool: 1 }))).toEqual({ kind: 'want', want: h({ wool: 1 }) });
    expect(offerSummary(h({ ore: 2 }), h({ wool: 1 }))).toMatchObject({ kind: 'full' });
    expect(canSendOffer(true, h({ ore: 2 }), h({ wool: 1 }))).toBe(true);
    expect(canSendOffer(true, h({ ore: 2 }), h())).toBe(false);
    expect(canSendOffer(false, h({ ore: 2 }), h({ wool: 1 }))).toBe(false);
  });
});

describe('incoming and own offers', () => {
  const state: GameState = structuredClone(m.state);
  const rivalHand = state.players.find((p) => p.id === rival)!.hand;
  const want = RESOURCES.find((r) => r !== 'ore')!;
  const offers = [{ id: 7, from: mover, give: h({ ore: 1 }), want: h({ [want]: rivalHand[want] + 3 }) }];
  const theirView = { ...theirs.view, offers };
  const myView = { ...mine.view, offers };

  it('lists only other players\' offers, with what is missing and what the server says', () => {
    const [i] = incomingOffers(theirView, { ...theirs.legal, acceptableOffers: [] });
    expect(i).toMatchObject({ acceptable: false, offer: { id: 7 } });
    expect(i.missing[want]).toBe(3);
    expect(incomingOffers(theirView, { ...theirs.legal, acceptableOffers: [7] })[0].acceptable).toBe(true);
    expect(incomingOffers(myView, mine.legal)).toEqual([]);
  });

  it('finds the player\'s own open offer, and opens the tab with something waiting', () => {
    expect(ownOffer(myView)?.id).toBe(7);
    expect(ownOffer(theirView)).toBeNull();
    expect(defaultTab(theirView)).toBe('players');
    expect(defaultTab(myView)).toBe('players'); // an open offer of one's own is there to be cancelled
    expect(defaultTab({ ...theirs.view, offers: [] })).toBe('bank');
  });
});
