import type { Action, ApplyResult } from './actions';
import { err } from './events';
import { MAX_ROADS_PER_CARD } from './constants';
import { produce, tilesHit } from './production';
import { roleOf } from './roles/registry';
import { checkWin, updateLargestArmy, updateLongestRoad } from './scoring';
import {
  emptyHand, getPlayer, grantFromBank, handCount, payToBank, sameTeam, sanitizeHand, topoOf, transfer, type Ctx,
} from './state';
import { bankRatioFor } from './trade';
import { costFor, devCardCostFor, discardLimitFor, roadSpotOk, validate } from './validate';
import { RESOURCES, type DevCardKind, type GameState, type Hand, type Resource, type Rng } from './types';

/**
 * The only way a game changes. Validates with the same rules the client uses
 * for highlighting, applies the move to a copy, and returns the new state and
 * the events that happened. Randomness comes only from `rng`.
 */
export function applyAction(prev: GameState, pid: string, action: Action, rng: Rng, now?: number): ApplyResult {
  const error = validate(prev, pid, action);
  if (error) return { ok: false, error };

  const ctx: Ctx = { s: cloneState(prev), rng, now, events: [], boardChanged: false };
  dispatch(ctx, pid, action);
  if (ctx.boardChanged) updateLongestRoad(ctx);
  checkWin(ctx);
  return { ok: true, state: ctx.s, events: ctx.events };
}

/**
 * Deep copy of a state. `map`, `tiles` and `harbors` are fixed when the game
 * is created and never change afterwards, so the copy shares them.
 */
export function cloneState(prev: GameState): GameState {
  const { map, tiles, harbors, ...rest } = prev;
  return { ...structuredClone(rest), map, tiles, harbors };
}

function dispatch(ctx: Ctx, pid: string, a: Action) {
  switch (a.type) {
    case 'placeSettlement':
      return placeSettlement(ctx, pid, a.vertex);
    case 'placeRoad':
      return placeRoad(ctx, pid, a.edge);
    case 'upgradeCity':
      return upgradeCity(ctx, pid, a.vertex);
    case 'roll':
      return roll(ctx, pid);
    case 'discard':
      return discard(ctx, pid, sanitizeHand(a.resources)!);
    case 'moveRobber':
      return moveRobber(ctx, pid, a.tile);
    case 'steal':
      return steal(ctx, pid, a.victim);
    case 'bankTrade':
      return bankTrade(ctx, pid, a.give, a.get);
    case 'offerTrade':
      return offerTrade(ctx, pid, sanitizeHand(a.give)!, sanitizeHand(a.want)!);
    case 'acceptTrade':
      return acceptTrade(ctx, pid, a.offerId);
    case 'cancelTrade':
      return cancelTrade(ctx, a.offerId);
    case 'teamGift':
      return teamGift(ctx, pid, a.to, sanitizeHand(a.cards)!);
    case 'buyDevCard':
      return buyDevCard(ctx, pid);
    case 'playKnight':
      return playKnight(ctx, pid);
    case 'playRoadBuilding':
      return playRoadBuilding(ctx, pid);
    case 'playYearOfPlenty':
      return playYearOfPlenty(ctx, pid, a.a, a.b);
    case 'playMonopoly':
      return playMonopoly(ctx, pid, a.resource);
    case 'endTurn':
      return endTurn(ctx, pid);
    case 'roleAction': {
      const def = roleOf(ctx.s, pid).actions![a.name];
      return def.apply(ctx, pid, a.params ?? {});
    }
  }
}

/* ---------------- building ---------------- */

function placeSettlement(ctx: Ctx, pid: string, v: number) {
  const { s } = ctx;
  const inSetup = s.phase === 'setup';
  if (!inSetup) payToBank(s, pid, costFor(s, pid, 'settlement'));
  s.buildings[v] = { owner: pid, kind: 'settlement' };
  ctx.boardChanged = true;
  ctx.events.push({ type: 'settlementBuilt', player: pid, vertex: v, setup: inSetup });
  if (!inSetup) return;
  const setup = s.setup!;
  setup.step = 'road';
  setup.lastSettlement = v;
  if (setup.index >= s.players.length) {
    // second settlement: one card from each neighbouring producing tile
    const want = emptyHand();
    for (const t of topoOf(s).vertices[v].tiles) {
      const kind = s.tiles[t].kind;
      if (kind !== 'desert') want[kind]++;
    }
    const given = grantFromBank(s, pid, want);
    if (handCount(given) > 0) ctx.events.push({ type: 'setupResources', player: pid, gains: given });
  }
}

function placeRoad(ctx: Ctx, pid: string, e: number) {
  const { s } = ctx;
  const phase = s.phase;
  if (phase === 'main') payToBank(s, pid, costFor(s, pid, 'road'));
  s.roads[e] = pid;
  ctx.boardChanged = true;
  ctx.events.push({ type: 'roadBuilt', player: pid, edge: e, free: phase !== 'main' });

  if (phase === 'setup') {
    const setup = s.setup!;
    setup.index += 1;
    if (setup.index >= setup.order.length) {
      s.setup = null;
      s.phase = 'roll';
      s.current = s.players[0].id;
      s.turn = 1;
      startTurnClock(ctx);
      ctx.events.push({ type: 'turnStarted', player: s.current, turn: s.turn });
    } else {
      setup.step = 'settlement';
      setup.lastSettlement = null;
      s.current = setup.order[setup.index];
    }
  } else if (phase === 'roadBuilding') {
    s.roadBuildingLeft -= 1;
    endRoadBuildingIfStuck(ctx, pid);
  }
}

/** Free roads that can no longer be placed are dropped so the player never gets stuck. */
function endRoadBuildingIfStuck(ctx: Ctx, pid: string) {
  const { s } = ctx;
  if (s.roadBuildingLeft > 0 && !topoOf(s).edges.some((e) => roadSpotOk(s, pid, e.id))) {
    ctx.events.push({ type: 'roadBuildingEnded', player: pid, unused: s.roadBuildingLeft });
    s.roadBuildingLeft = 0;
  }
  if (s.roadBuildingLeft === 0) finishInterruption(s);
}

function upgradeCity(ctx: Ctx, pid: string, v: number) {
  const { s } = ctx;
  payToBank(s, pid, costFor(s, pid, 'city'));
  s.buildings[v].kind = 'city';
  ctx.events.push({ type: 'cityBuilt', player: pid, vertex: v });
}

/* ---------------- dice, seven, robber ---------------- */

function finishInterruption(s: GameState) {
  s.phase = s.returnPhase ?? 'main';
  s.returnPhase = null;
  s.stealFrom = [];
}

function roll(ctx: Ctx, pid: string) {
  const { s, rng } = ctx;
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  const total = d1 + d2;
  s.dice = [d1, d2];
  ctx.events.push({ type: 'diceRolled', player: pid, dice: [d1, d2], total, ...tilesHit(ctx, total) });
  if (total !== 7) {
    produce(ctx, total);
    s.phase = 'main';
    return;
  }
  s.returnPhase = 'main';
  s.pendingDiscards = {};
  for (const p of s.players) {
    const n = handCount(p.hand);
    if (n > discardLimitFor(s, p.id)) s.pendingDiscards[p.id] = Math.floor(n / 2);
  }
  if (Object.keys(s.pendingDiscards).length) {
    s.phase = 'discard';
    ctx.events.push({ type: 'discardRequired', players: { ...s.pendingDiscards } });
  } else {
    s.phase = 'robber';
  }
}

function discard(ctx: Ctx, pid: string, cards: Hand) {
  const { s } = ctx;
  payToBank(s, pid, cards);
  ctx.events.push({ type: 'discarded', player: pid, count: s.pendingDiscards[pid] });
  delete s.pendingDiscards[pid];
  if (Object.keys(s.pendingDiscards).length === 0) s.phase = 'robber';
}

function moveRobber(ctx: Ctx, pid: string, tile: number) {
  const { s } = ctx;
  s.robber = tile;
  ctx.events.push({ type: 'robberMoved', player: pid, tile });
  const victims = new Set<string>();
  for (const v of topoOf(s).tiles[tile].corners) {
    const b = s.buildings[v];
    if (b && b.owner !== pid && !sameTeam(s, pid, b.owner) && handCount(getPlayer(s, b.owner).hand) > 0) victims.add(b.owner);
  }
  if (victims.size > 1) {
    s.phase = 'steal';
    s.stealFrom = [...victims];
    return;
  }
  if (victims.size === 1) stealCard(ctx, pid, [...victims][0]);
  finishInterruption(s);
}

function stealCard(ctx: Ctx, thief: string, victim: string) {
  const v = getPlayer(ctx.s, victim);
  const pool: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < v.hand[r]; i++) pool.push(r);
  if (pool.length === 0) {
    ctx.events.push({ type: 'stolen', thief, victim, resource: null });
    return;
  }
  const r = pool[Math.floor(ctx.rng() * pool.length)];
  transfer(ctx.s, victim, thief, { [r]: 1 });
  ctx.events.push({ type: 'stolen', thief, victim, resource: r });
}

function steal(ctx: Ctx, pid: string, victim: string) {
  stealCard(ctx, pid, victim);
  finishInterruption(ctx.s);
}

/* ---------------- trade ---------------- */

function bankTrade(ctx: Ctx, pid: string, give: Resource, get: Resource) {
  const ratio = bankRatioFor(ctx.s, pid, give);
  payToBank(ctx.s, pid, { [give]: ratio });
  grantFromBank(ctx.s, pid, { [get]: 1 });
  ctx.events.push({ type: 'bankTraded', player: pid, give, get, ratio });
}

function offerTrade(ctx: Ctx, pid: string, give: Hand, want: Hand) {
  const { s } = ctx;
  const offer = { id: s.nextOfferId++, from: pid, give, want };
  s.offers = [offer];
  ctx.events.push({ type: 'tradeOffered', offer });
}

/** Cards move between two teammates and nowhere else: the bank, the open offer and the role hooks are not touched. */
function teamGift(ctx: Ctx, pid: string, to: string, cards: Hand) {
  transfer(ctx.s, pid, to, cards);
  ctx.events.push({ type: 'teamGifted', from: pid, to, cards });
}

function acceptTrade(ctx: Ctx, pid: string, offerId: number) {
  const { s } = ctx;
  const offer = s.offers.find((o) => o.id === offerId)!;
  transfer(s, offer.from, pid, offer.give);
  transfer(s, pid, offer.from, offer.want);
  s.offers = [];
  ctx.events.push({ type: 'tradeAccepted', offerId, from: offer.from, to: pid, give: offer.give, want: offer.want });

  const owner = getPlayer(s, offer.from);
  // a gift (one side empty) is not an exchange: roles that reward accepted trades are told which kind this was
  const reciprocal = handCount(offer.give) > 0 && handCount(offer.want) > 0;
  const bonus = roleOf(s, owner.id).onTradeAccepted?.({ counters: s.turnFlags.counters, bank: { ...s.bank }, rng: ctx.rng, reciprocal });
  if (!bonus) return;
  if (bonus.counter) s.turnFlags.counters[bonus.counter] = (s.turnFlags.counters[bonus.counter] ?? 0) + 1;
  if (bonus.gains) {
    const given = grantFromBank(s, owner.id, bonus.gains);
    if (handCount(given) > 0) ctx.events.push({ type: 'roleBonus', player: owner.id, role: owner.role, gains: given });
  }
}

function cancelTrade(ctx: Ctx, offerId: number) {
  ctx.s.offers = ctx.s.offers.filter((o) => o.id !== offerId);
  ctx.events.push({ type: 'tradeCancelled', offerId });
}

/* ---------------- development cards ---------------- */

function buyDevCard(ctx: Ctx, pid: string) {
  const { s } = ctx;
  payToBank(s, pid, devCardCostFor(s, pid));
  const kind = s.devDeck.pop()!;
  getPlayer(s, pid).devCards.push({ kind, boughtTurn: s.turn });
  ctx.events.push({ type: 'devCardBought', player: pid, kind });
}

/** Removes the played card from the hand and records the play. */
function spendDevCard(ctx: Ctx, pid: string, kind: DevCardKind) {
  const { s } = ctx;
  const p = getPlayer(s, pid);
  const i = p.devCards.findIndex((c) => c.kind === kind && c.boughtTurn < s.turn);
  p.devCards.splice(i, 1);
  s.devPlayed[kind] += 1;
  s.turnFlags.devPlayed = true;
  ctx.events.push({ type: 'devCardPlayed', player: pid, kind });
}

function playKnight(ctx: Ctx, pid: string) {
  const { s } = ctx;
  spendDevCard(ctx, pid, 'knight');
  getPlayer(s, pid).knightsPlayed += 1;
  updateLargestArmy(ctx);
  s.returnPhase = s.phase === 'roll' ? 'roll' : 'main';
  s.phase = 'robber';
}

function playRoadBuilding(ctx: Ctx, pid: string) {
  const { s } = ctx;
  spendDevCard(ctx, pid, 'roadBuilding');
  s.returnPhase = 'main';
  s.phase = 'roadBuilding';
  s.roadBuildingLeft = MAX_ROADS_PER_CARD;
  endRoadBuildingIfStuck(ctx, pid);
}

function playYearOfPlenty(ctx: Ctx, pid: string, a: Resource, b: Resource) {
  spendDevCard(ctx, pid, 'yearOfPlenty');
  const want = emptyHand();
  want[a] += 1;
  want[b] += 1;
  const given = grantFromBank(ctx.s, pid, want);
  ctx.events.push({ type: 'yearOfPlentyTaken', player: pid, gains: given });
}

function playMonopoly(ctx: Ctx, pid: string, resource: Resource) {
  const { s } = ctx;
  spendDevCard(ctx, pid, 'monopoly');
  let count = 0;
  for (const p of s.players) {
    if (p.id === pid) continue;
    const n = p.hand[resource];
    if (n > 0) transfer(s, p.id, pid, { [resource]: n });
    count += n;
  }
  ctx.events.push({ type: 'monopolyCollected', player: pid, resource, count });
}

/* ---------------- turn ---------------- */

/** A timed game restarts the turn clock whenever a turn begins; an untimed one never looks at `now`. */
function startTurnClock(ctx: Ctx) {
  if (ctx.s.timer && ctx.now !== undefined) ctx.s.turnStartedAt = ctx.now;
}

/**
 * Used when a turn runs out in the middle of free road building: the unplaced roads are lost (there is no action for it, and a
 * player who has stopped playing should not get them placed for them).
 */
export function forfeitRoadBuilding(prev: GameState, now?: number): ApplyResult {
  if (prev.phase !== 'roadBuilding') return { ok: false, error: err('wrongPhase', { phase: prev.phase }) };
  const ctx: Ctx = { s: cloneState(prev), rng: () => 0, now, events: [], boardChanged: false };
  ctx.events.push({ type: 'roadBuildingEnded', player: prev.current, unused: prev.roadBuildingLeft });
  ctx.s.roadBuildingLeft = 0;
  finishInterruption(ctx.s);
  return { ok: true, state: ctx.s, events: ctx.events };
}

function endTurn(ctx: Ctx, pid: string) {
  const { s } = ctx;
  ctx.events.push({ type: 'turnEnded', player: pid });
  const i = s.players.findIndex((p) => p.id === pid);
  s.current = s.players[(i + 1) % s.players.length].id;
  s.phase = 'roll';
  s.dice = null;
  s.offers = [];
  s.turn += 1;
  s.turnFlags = { devPlayed: false, counters: {} };
  startTurnClock(ctx);
  ctx.events.push({ type: 'turnStarted', player: s.current, turn: s.turn });
}
