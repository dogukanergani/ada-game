import { roleOf } from './roles/registry';
import { emptyHand, grantFromBank, handCount, topoOf, type Ctx } from './state';
import { RESOURCES } from './types';

/** Which tiles the number `roll` hit: the ones that produce (a building, no robber) and the one the robber blocks. Public board facts. */
export function tilesHit(ctx: Ctx, roll: number): { hitTiles: number[]; robbedTile: number | null } {
  const { s } = ctx;
  const topo = topoOf(s);
  const hitTiles: number[] = [];
  let robbedTile: number | null = null;
  s.tiles.forEach((tile, i) => {
    if (tile.number !== roll || tile.kind === 'desert') return;
    if (i === s.robber) robbedTile = i;
    else if (topo.tiles[i].corners.some((v) => s.buildings[v])) hitTiles.push(i);
  });
  return { hitTiles, robbedTile };
}

/**
 * Dice production with a limited bank. When the bank cannot cover a
 * resource: several claimants get nothing, a single claimant gets what is left.
 * Role bonuses are granted afterwards and can never exceed the bank.
 */
export function produce(ctx: Ctx, roll: number) {
  const { s } = ctx;
  const topo = topoOf(s);
  const demand = new Map(s.players.map((p) => [p.id, emptyHand()]));
  /** players whose building touches a tile with this number, even if the robber sits on it */
  const matched = new Set<string>();
  s.tiles.forEach((tile, i) => {
    if (tile.number !== roll || tile.kind === 'desert') return;
    for (const v of topo.tiles[i].corners) {
      const b = s.buildings[v];
      if (!b) continue;
      matched.add(b.owner);
      if (i !== s.robber) demand.get(b.owner)![tile.kind] += b.kind === 'city' ? 2 : 1;
    }
  });

  const gains = new Map(s.players.map((p) => [p.id, emptyHand()]));
  for (const r of RESOURCES) {
    const claimants = s.players.filter((p) => demand.get(p.id)![r] > 0);
    const total = claimants.reduce((sum, p) => sum + demand.get(p.id)![r], 0);
    if (total === 0) continue;
    if (total <= s.bank[r]) {
      for (const p of claimants) gains.get(p.id)![r] = demand.get(p.id)![r];
    } else if (claimants.length > 1) {
      ctx.events.push({ type: 'productionBlocked', resource: r, reason: 'multiple' });
    } else {
      gains.get(claimants[0].id)![r] = s.bank[r];
      ctx.events.push({ type: 'productionBlocked', resource: r, reason: 'short' });
    }
  }

  const received = new Map<string, ReturnType<typeof emptyHand>>();
  for (const p of s.players) {
    const given = grantFromBank(s, p.id, gains.get(p.id)!);
    received.set(p.id, given);
    if (handCount(given) > 0) ctx.events.push({ type: 'produced', player: p.id, gains: given });
  }
  for (const p of s.players) {
    const bonus = roleOf(s, p.id).onProduce?.({
      gains: received.get(p.id)!,
      matched: matched.has(p.id),
      roll,
      bank: { ...s.bank },
      rng: ctx.rng,
      hand: { ...p.hand },
      roller: s.current,
      self: p.id,
    });
    if (!bonus) continue;
    const given = grantFromBank(s, p.id, bonus);
    if (handCount(given) > 0) ctx.events.push({ type: 'roleBonus', player: p.id, role: p.role, gains: given });
  }
}
