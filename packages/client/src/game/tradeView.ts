import { RESOURCES, type GameView, type Hand, type LegalMoves, type Resource, type TradeOffer } from '@ada/game-core';
import { countHand, missingFor } from './controls';

/**
 * What the trade sheet shows, worked out from the view and the legal moves.
 * Nothing here decides whether a trade is allowed: the ratios come from the
 * core (`view.mine.bankRatios`, which already count harbours and the role),
 * what is possible comes from `legal`, and the reasons only explain a tile that
 * is off. They never switch one on.
 */

export type TileReason =
  | { code: 'notYourTurn' }
  | { code: 'short'; n: number }
  | { code: 'bankEmpty' }
  | { code: 'same' }
  | { code: 'none' }
  | { code: 'conflict'; side: 'give' | 'want' };

export interface BankGiveTile {
  resource: Resource;
  have: number;
  ratio: number;
  enabled: boolean;
  reason: TileReason | null;
}

export interface BankGetTile {
  resource: Resource;
  inBank: number;
  enabled: boolean;
  reason: TileReason | null;
}

/** The "you give" tiles: the ratio is what the core says; a tile is on when the server lists a trade that gives it. */
export function bankGiveTiles(view: GameView, legal: LegalMoves, myTurn: boolean): BankGiveTile[] {
  const hand = myHand(view);
  return RESOURCES.map((resource) => {
    const ratio = view.mine!.bankRatios[resource];
    const have = hand[resource];
    const enabled = legal.bankTrades.some((x) => x.give === resource);
    let reason: TileReason | null = null;
    if (!enabled) reason = !myTurn ? { code: 'notYourTurn' } : have < ratio ? { code: 'short', n: ratio - have } : { code: 'bankEmpty' };
    return { resource, have, ratio, enabled, reason };
  });
}

/** The "you get" tiles, given the chosen resource to give (null: nothing chosen yet, nothing is explained yet). */
export function bankGetTiles(view: GameView, legal: LegalMoves, give: Resource | null): BankGetTile[] {
  return RESOURCES.map((resource) => {
    const inBank = view.bank[resource];
    const enabled = !!give && legal.bankTrades.some((x) => x.give === give && x.get === resource);
    let reason: TileReason | null = null;
    if (give && !enabled) reason = resource === give ? { code: 'same' } : inBank === 0 ? { code: 'bankEmpty' } : null;
    return { resource, inBank, enabled, reason };
  });
}

export type BankSummary =
  | { kind: 'none' }
  | { kind: 'give'; n: number; give: Resource }
  | { kind: 'full'; n: number; give: Resource; get: Resource };

export function bankSummary(view: GameView, give: Resource | null, get: Resource | null): BankSummary {
  if (!give) return { kind: 'none' };
  const n = view.mine!.bankRatios[give];
  return get ? { kind: 'full', n, give, get } : { kind: 'give', n, give };
}

/** True when the chosen pair is one the server lists. */
export const bankPairLegal = (legal: LegalMoves, give: Resource | null, get: Resource | null): boolean =>
  !!give && !!get && legal.bankTrades.some((x) => x.give === give && x.get === get);

/* ---------------- offers to the other players ---------------- */

export const emptyHand = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });

export interface OfferTile {
  resource: Resource;
  count: number;
  /** the most that can be chosen */
  max: number;
  enabled: boolean;
  reason: TileReason | null;
}

/** The "you give" tiles of an offer: only what is in the hand, and not what is asked for. */
export function offerGiveTiles(view: GameView, give: Hand, want: Hand, myTurn: boolean): OfferTile[] {
  const hand = myHand(view);
  return RESOURCES.map((resource) => {
    const max = hand[resource];
    let reason: TileReason | null = null;
    if (!myTurn) reason = { code: 'notYourTurn' };
    else if (want[resource] > 0) reason = { code: 'conflict', side: 'want' };
    else if (max === 0) reason = { code: 'none' };
    return { resource, count: give[resource], max, enabled: reason === null, reason };
  });
}

/** The "you ask for" tiles: anything but what is given (the core refuses the same resource on both sides). */
export function offerWantTiles(want: Hand, give: Hand, myTurn: boolean): OfferTile[] {
  return RESOURCES.map((resource) => {
    let reason: TileReason | null = null;
    if (!myTurn) reason = { code: 'notYourTurn' };
    else if (give[resource] > 0) reason = { code: 'conflict', side: 'give' };
    return { resource, count: want[resource], max: MAX_ASK, enabled: reason === null, reason };
  });
}

/** How many of one resource an offer may ask for (a bank-sized stack; the core's own limits still decide). */
export const MAX_ASK = 9;

export type OfferSummary = { kind: 'none' } | { kind: 'give'; give: Hand } | { kind: 'want'; want: Hand } | { kind: 'full'; give: Hand; want: Hand };

export function offerSummary(give: Hand, want: Hand): OfferSummary {
  const g = countHand(give) > 0;
  const w = countHand(want) > 0;
  if (g && w) return { kind: 'full', give, want };
  if (g) return { kind: 'give', give };
  if (w) return { kind: 'want', want };
  return { kind: 'none' };
}

/** An offer can be sent when it has something on both sides; whether it is legal at all is the server's call. */
export const canSendOffer = (myTurn: boolean, give: Hand, want: Hand): boolean => myTurn && countHand(give) > 0 && countHand(want) > 0;

export interface IncomingOffer {
  offer: TradeOffer;
  /** true when the server lists accepting it as legal for this player */
  acceptable: boolean;
  /** what the player lacks to accept (empty when nothing, or when the reason is something else) */
  missing: Hand;
}

/** Open offers from the other players, with whether and why this player can accept each. */
export function incomingOffers(view: GameView, legal: LegalMoves): IncomingOffer[] {
  const hand = myHand(view);
  return view.offers
    .filter((o) => o.from !== view.me)
    .map((offer) => ({ offer, acceptable: legal.acceptableOffers.includes(offer.id), missing: missingFor(hand, offer.want) }));
}

export const ownOffer = (view: GameView): TradeOffer | null => view.offers.find((o) => o.from === view.me) ?? null;

/** The tab to open: the one with an open offer in it (one waiting for the player, or the player's own, which they may want to cancel). */
export const defaultTab = (view: GameView): 'bank' | 'players' => (view.offers.length > 0 ? 'players' : 'bank');

function myHand(view: GameView): Hand {
  return view.players.find((p) => p.id === view.me)!.hand!;
}
