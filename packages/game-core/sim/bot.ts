import {
  RESOURCES, canAfford, costFor, legalBankTrades, legalCityVertices, legalDevPlays, legalRoadEdges, legalRobberTiles, legalRoleActions,
  legalSettlementVertices, legalStealVictims, legalTeamGiftTargets, validate,
  type Action, type GameState, type Hand, type Rng,
} from '../src';

/* ---------------- the bot: plays only moves the legal listers offer ---------------- */

export interface Move { pid: string; action: Action; weight: number; }

export const pick = <T,>(a: T[], rng: Rng): T => a[Math.floor(rng() * a.length)];

function randomDiscard(s: GameState, pid: string, rng: Rng): Action {
  const have = { ...s.players.find((p) => p.id === pid)!.hand };
  const out: Hand = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  for (let i = 0; i < s.pendingDiscards[pid]; i++) {
    const r = pick(RESOURCES.filter((x) => have[x] > 0), rng);
    have[r]--;
    out[r]++;
  }
  return { type: 'discard', resources: out };
}

export function moves(s: GameState, rng: Rng, actionsThisTurn: number): Move[] {
  const me = s.current;
  const p = s.players.find((x) => x.id === me)!;
  const out: Move[] = [];
  const add = (action: Action, weight: number, pid = me) => out.push({ pid, action, weight });

  switch (s.phase) {
    case 'setup':
      if (s.setup!.step === 'settlement') add({ type: 'placeSettlement', vertex: pick(legalSettlementVertices(s, me), rng) }, 1);
      else add({ type: 'placeRoad', edge: pick(legalRoadEdges(s, me), rng) }, 1);
      break;
    case 'roll':
      add({ type: 'roll' }, 1);
      for (const a of legalDevPlays(s, me)) if (a.type === 'playKnight') add(a, 0.15);
      break;
    case 'discard':
      for (const pid of Object.keys(s.pendingDiscards)) add(randomDiscard(s, pid, rng), 1, pid);
      break;
    case 'robber':
      add({ type: 'moveRobber', tile: pick(legalRobberTiles(s, me), rng) }, 1);
      break;
    case 'steal':
      add({ type: 'steal', victim: pick(legalStealVictims(s, me), rng) }, 1);
      break;
    case 'roadBuilding':
      add({ type: 'placeRoad', edge: pick(legalRoadEdges(s, me), rng) }, 1);
      break;
    case 'main': {
      add({ type: 'endTurn' }, 0.6 + actionsThisTurn * 0.4);
      const st = canAfford(p.hand, costFor(s, me, 'settlement')) ? legalSettlementVertices(s, me) : [];
      if (st.length) add({ type: 'placeSettlement', vertex: pick(st, rng) }, 8);
      const ct = canAfford(p.hand, costFor(s, me, 'city')) ? legalCityVertices(s, me) : [];
      if (ct.length) add({ type: 'upgradeCity', vertex: pick(ct, rng) }, 8);
      const rd = canAfford(p.hand, costFor(s, me, 'road')) ? legalRoadEdges(s, me) : [];
      if (rd.length) add({ type: 'placeRoad', edge: pick(rd, rng) }, 3);
      if (validate(s, me, { type: 'buyDevCard' }) === null) add({ type: 'buyDevCard' }, 4);
      const dev = legalDevPlays(s, me);
      if (dev.length) add(pick(dev, rng), 4);
      const roleActs = legalRoleActions(s, me);
      if (roleActs.length) add(pick(roleActs, rng), 5);
      const bt = legalBankTrades(s, me);
      if (bt.length) add({ type: 'bankTrade', ...pick(bt, rng) }, 1.5);
      const owned = RESOURCES.filter((r) => p.hand[r] > 0);
      if (owned.length) {
        const give = pick(owned, rng);
        const want = pick(RESOURCES.filter((r) => r !== give), rng);
        add({ type: 'offerTrade', give: { [give]: 1 }, want: { [want]: 1 + Math.floor(rng() * 2) } }, 0.25);
        // one-sided offers: a gift, and a request for a gift
        add({ type: 'offerTrade', give: { [give]: 1 }, want: {} }, 0.1);
      }
      add({ type: 'offerTrade', give: {}, want: { [pick([...RESOURCES], rng)]: 1 } }, 0.1);
      for (const o of s.offers) {
        add({ type: 'cancelTrade', offerId: o.id }, 0.3, o.from);
        for (const q of s.players) {
          if (q.id !== o.from && validate(s, q.id, { type: 'acceptTrade', offerId: o.id }) === null) add({ type: 'acceptTrade', offerId: o.id }, 3, q.id);
        }
      }
      break;
    }
  }
  // team mode: any teammate may send cards at any time, on turn or not (the rng is touched only in team mode, so other games replay as before)
  if (s.teamMode) {
    for (const q of s.players) {
      const to = legalTeamGiftTargets(s, q.id);
      if (!to.length) continue;
      const have = RESOURCES.filter((r) => q.hand[r] > 0);
      const r = pick(have, rng);
      add({ type: 'teamGift', to: pick(to, rng), cards: { [r]: 1 + Math.floor(rng() * q.hand[r]) } }, 0.4, q.id);
    }
  }
  return out;
}

export function chooseWeighted(ms: Move[], rng: Rng): Move {
  const total = ms.reduce((a, m) => a + m.weight, 0);
  let x = rng() * total;
  for (const m of ms) {
    x -= m.weight;
    if (x <= 0) return m;
  }
  return ms[ms.length - 1];
}
