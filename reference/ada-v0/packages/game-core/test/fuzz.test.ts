import { describe, expect, it } from 'vitest';
import {
  PIECE_LIMITS, RESOURCES, TOPOLOGY as T, applyAction, canAfford, costFor, handCount, legalCityVertices, legalRoadEdges,
  legalSettlementVertices, longestRoadFor, ROLE_LIST, type Action, type GameState, type Hand, type Rng,
} from '../src';
import { autoSetup, mulberry32, newGame } from './helpers';

const pick = <X,>(a: X[], rng: Rng) => a[Math.floor(rng() * a.length)];

const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`invariant broken: ${msg}`);
};

function invariants(s: GameState) {
  for (const p of s.players) {
    for (const r of RESOURCES) must(p.resources[r] >= 0, `${p.name} has negative ${r}`);
    const roads = Object.values(s.roads).filter((o) => o === p.id).length;
    const sett = Object.values(s.buildings).filter((b) => b.owner === p.id && b.kind === 'settlement').length;
    const city = Object.values(s.buildings).filter((b) => b.owner === p.id && b.kind === 'city').length;
    must(roads <= PIECE_LIMITS.road, 'road limit');
    must(sett <= PIECE_LIMITS.settlement, 'settlement limit');
    must(city <= PIECE_LIMITS.city, 'city limit');
  }
  for (const v of Object.keys(s.buildings)) {
    for (const n of T.vertices[Number(v)].neighbors) must(s.buildings[n] === undefined, 'distance rule');
  }
  must(s.players.some((p) => p.id === s.current), 'current player exists');
  if (s.longestRoad.holder) must(longestRoadFor(s, s.longestRoad.holder) >= 5, 'longest road holder has >= 5');
}

/** A random legal move for whoever has to act (or null if nobody can). */
function candidates(s: GameState, rng: Rng): { pid: string; a: Action }[] {
  const me = s.current;
  const p = s.players.find((x) => x.id === me)!;
  const out: { pid: string; a: Action }[] = [];
  if (s.phase === 'roll') out.push({ pid: me, a: { type: 'roll' } });
  if (s.phase === 'discard') {
    for (const [pid, need] of Object.entries(s.pendingDiscards)) {
      const h: Hand = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
      const have = { ...s.players.find((x) => x.id === pid)!.resources };
      for (let i = 0; i < need; i++) {
        const r = pick(RESOURCES.filter((x) => have[x] > 0), rng);
        have[r]--; h[r]++;
      }
      out.push({ pid, a: { type: 'discard', resources: h } });
    }
  }
  if (s.phase === 'robber') out.push({ pid: me, a: { type: 'moveRobber', tile: pick(s.tiles.filter((t) => t.id !== s.robber), rng).id } });
  if (s.phase === 'steal') out.push({ pid: me, a: { type: 'steal', victim: pick(s.stealFrom, rng) } });
  if (s.phase === 'main') {
    out.push({ pid: me, a: { type: 'endTurn' } });
    const sp = legalSettlementVertices(s, me);
    const rd = legalRoadEdges(s, me);
    const ct = legalCityVertices(s, me);
    if (sp.length && canAfford(p.resources, costFor(s, me, 'settlement'))) out.push({ pid: me, a: { type: 'placeSettlement', vertex: pick(sp, rng) } });
    if (rd.length && canAfford(p.resources, costFor(s, me, 'road'))) out.push({ pid: me, a: { type: 'placeRoad', edge: pick(rd, rng) } });
    if (ct.length && canAfford(p.resources, costFor(s, me, 'city'))) out.push({ pid: me, a: { type: 'upgradeCity', vertex: pick(ct, rng) } });
    const g = pick([...RESOURCES], rng);
    const w = pick(RESOURCES.filter((r) => r !== g), rng);
    out.push({ pid: me, a: { type: 'bankTrade', give: g, get: w } });
    if (handCount(p.resources) > 1) {
      const give = pick(RESOURCES.filter((r) => p.resources[r] > 0), rng);
      const want = pick(RESOURCES.filter((r) => r !== give), rng);
      out.push({ pid: me, a: { type: 'offerTrade', give: { [give]: 1 }, want: { [want]: 1 } } });
    }
    for (const o of s.offers) for (const q of s.players) if (q.id !== o.from) out.push({ pid: q.id, a: { type: 'acceptTrade', offerId: o.id } });
  }
  return out;
}

describe('random playouts', () => {
  it('keeps every invariant across 60 full games with all roles', () => {
    let finished = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed * 7919);
      const n = 2 + (seed % 3);
      const roles = ROLE_LIST.map((r) => r.id);
      let s = autoSetup({ ...newGame(n, seed, roles.slice(seed % 3, (seed % 3) + n).concat(roles).slice(0, n)), vpToWin: 7 });
      invariants(s);
      for (let step = 0; step < 4000 && s.phase !== 'finished'; step++) {
        const cands = candidates(s, rng);
        must(cands.length > 0, `stuck in ${s.phase}`);
        // bias toward progress: prefer building over passing
        const build = cands.filter((c) => ['placeSettlement', 'placeRoad', 'upgradeCity', 'roll', 'discard', 'moveRobber', 'steal'].includes(c.a.type));
        const c = build.length && rng() < 0.8 ? pick(build, rng) : pick(cands, rng);
        const r = applyAction(s, c.pid, c.a, rng);
        // acceptTrade / bank trade may be legitimately refused (can't afford); everything else must succeed
        if (!r.ok) {
          expect(['acceptTrade', 'bankTrade', 'offerTrade']).toContain(c.a.type);
          continue;
        }
        s = r.state;
        invariants(s);
      }
      if (s.phase === 'finished') {
        finished++;
        expect(s.winner).not.toBeNull();
      }
    }
    expect(finished).toBeGreaterThan(40);
  });
});
