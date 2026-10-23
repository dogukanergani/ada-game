import { describe, expect, it } from 'vitest';
import { DEMOLISH_COSTS, RESOURCES, topologyOf, type GameState } from '@ada/game-core';
import { PROTOCOL_VERSION } from '@ada/protocol';
import { mulberry32 } from '../../game-core/sim/rng';
import { chooseWeighted, moves } from '../../game-core/sim/bot';
import { setup, stateOf, type Setup } from './gameplay';
import { TestClient, startServer } from './harness';

const errorKey = (r: any) => r?.error?.key;

describe('protocol version', () => {
  it('hello with the right version works and reports the server version', async () => {
    const { url } = await startServer();
    const c = await TestClient.open(url);
    const r = await c.emit('identity:hello', { protocolVersion: PROTOCOL_VERSION });
    expect(r).toMatchObject({ ok: true, protocolVersion: PROTOCOL_VERSION });
  });

  it('refuses another version, a missing one or a malformed one, and the connection stays anonymous', async () => {
    const { url } = await startServer();
    for (const payload of [{ protocolVersion: PROTOCOL_VERSION + 1 }, { protocolVersion: 0 }, {}, { protocolVersion: '1' }, { token: 'x' }, undefined]) {
      const c = await TestClient.open(url);
      const r = await c.emit('identity:hello', payload);
      expect(errorKey(r), JSON.stringify(payload)).toBe('incompatibleVersion');
      expect(r.error.serverVersion).toBe(PROTOCOL_VERSION);
      expect(errorKey(await c.emit('room:create', { name: 'X' }))).toBe('noIdentity');
    }
  });

  it('the old client (protocol 1, before the Soldier demolished) is refused by this server (protocol 2), even with a good token', async () => {
    expect(PROTOCOL_VERSION).toBe(2);
    const { url } = await startServer();
    const a = await TestClient.login(url);
    const old = await TestClient.open(url);
    const r = await old.emit('identity:hello', { token: a.token, protocolVersion: 1 });
    expect(errorKey(r)).toBe('incompatibleVersion');
    expect(r.error).toMatchObject({ serverVersion: 2, clientVersion: 1 });
    // and it stays anonymous: it cannot reach a room, so it can never send the action it does not know
    expect(errorKey(await old.emit('room:create', { name: 'Old' }))).toBe('noIdentity');
    expect(errorKey(await old.emit('game:action', { type: 'roleAction', name: 'capture', params: { kind: 'road', id: 1 } }))).toBe('noIdentity');
    // a client of the current version is let in
    const fresh = await TestClient.open(url);
    expect(await fresh.emit('identity:hello', { protocolVersion: 2 })).toMatchObject({ ok: true, protocolVersion: 2 });
  });

  it('a returning token is refused too when the version is wrong (nobody sits with an old client)', async () => {
    const { url } = await startServer();
    const a = await TestClient.login(url);
    await a.emit('room:create', { name: 'A' });
    const old = await TestClient.open(url);
    expect(errorKey(await old.emit('identity:hello', { token: a.token, protocolVersion: PROTOCOL_VERSION - 1 }))).toBe('incompatibleVersion');
  });
});

/** A started game, played by the bots up to the point `until` is true for the server's state. */
async function gameAt(until: (s: GameState) => boolean, opts: { n?: number; seed?: number; soldier?: boolean } = {}) {
  let draws = 0;
  const base = mulberry32(opts.seed ?? 3);
  const rng = () => {
    draws++;
    return base();
  };
  const ctx = await setup(opts.n ?? 2, 'short', rng);
  if (opts.soldier) expect(await ctx.players[0].emit('lobby:setRole', { role: 'soldier' })).toMatchObject({ ok: true });
  await ctx.players[0].emit('lobby:start');
  for (const p of ctx.players) await p.until('game:snapshot');
  const botRng = mulberry32(99);
  const byId = new Map(ctx.players.map((p) => [p.playerId, p]));
  let actions = 0;
  let turn = -1;
  for (let i = 0; i < 2000 && !until(stateOf(ctx.server, ctx.code)); i++) {
    const s = stateOf(ctx.server, ctx.code);
    if (s.turn !== turn) {
      turn = s.turn;
      actions = 0;
    }
    const m = chooseWeighted(moves(s, botRng, actions++), botRng);
    expect(await byId.get(m.pid)!.emit('game:action', m.action)).toEqual({ ok: true });
  }
  expect(until(stateOf(ctx.server, ctx.code))).toBe(true);
  const clientOf = (pid: string) => byId.get(pid)!;
  return { ...ctx, draws: () => draws, clientOf, mover: () => clientOf(stateOf(ctx.server, ctx.code).current) };
}

/** Edits the server's game state directly, the way a test may. */
const tweak = (ctx: Setup, fn: (s: GameState) => void) => ctx.server.store.update(ctx.code, (r) => fn(r.game!));
const REAL_RANDOM_WORDS = /knight|monopoly|roadBuilding|yearOfPlenty|victoryPoint|dice|diceRolled|produced|stolen|devCardBought/;

describe('game:preview', () => {
  it('says what a placement would do, without doing it', async () => {
    const ctx = await gameAt((s) => s.phase === 'setup');
    const s0 = stateOf(ctx.server, ctx.code);
    const mover = ctx.clientOf(s0.current);
    const legal = (await mover.emit('game:legal')).legal;
    const before = JSON.stringify(s0);
    const r = await mover.emit('game:preview', { type: 'placeSettlement', vertex: legal.settlements[0] });
    expect(r.ok).toBe(true);
    expect(r.preview.restricted).toBe(false);
    expect(Object.values(r.preview.cost).every((n) => n === 0)).toBe(true);
    expect(r.preview.points[mover.playerId]).toEqual({ before: 0, after: 1 });
    expect(r.preview.events.some((e: any) => e.type === 'settlementBuilt')).toBe(true);
    // nothing happened
    expect(JSON.stringify(stateOf(ctx.server, ctx.code))).toBe(before);
    expect((await mover.emit('game:legal')).legal.settlements).toEqual(legal.settlements);
  });

  it('refuses what the core refuses, with the core error, and not out of turn', async () => {
    const ctx = await gameAt((s) => s.phase === 'setup');
    const s0 = stateOf(ctx.server, ctx.code);
    const mover = ctx.clientOf(s0.current);
    const other = ctx.players.find((p) => p !== mover)!;
    expect(await mover.emit('game:preview', { type: 'placeSettlement', vertex: 99999 })).toMatchObject({ ok: false, error: { key: 'game' } });
    expect(await other.emit('game:preview', { type: 'placeSettlement', vertex: 0 })).toMatchObject({ ok: false, error: { key: 'game', error: { type: 'notYourTurn' } } });
    expect(errorKey(await mover.emit('game:preview', { type: 'nonsense' }))).toBe('badPayload');
  });

  it('is refused outside a game', async () => {
    const { url } = await startServer();
    const c = await TestClient.login(url);
    expect(errorKey(await c.emit('game:preview', { type: 'roll' }))).toBe('notInRoom');
    await c.emit('room:create', { name: 'A' });
    expect(errorKey(await c.emit('game:preview', { type: 'roll' }))).toBe('notInGame');
  });

  it('never changes the state and never touches the game\'s rng, whatever is previewed', async () => {
    const ctx = await gameAt((s) => s.phase === 'main' && s.turn > 12);
    const mover = ctx.mover();
    const s0 = stateOf(ctx.server, ctx.code);
    const before = JSON.stringify(s0);
    const draws = ctx.draws();
    const all: any[] = [
      { type: 'roll' }, { type: 'buyDevCard' }, { type: 'endTurn' }, { type: 'playKnight' }, { type: 'playMonopoly', resource: 'ore' },
      { type: 'playYearOfPlenty', a: 'ore', b: 'wool' }, { type: 'bankTrade', give: 'ore', get: 'wool' }, { type: 'offerTrade', give: { ore: 1 }, want: { wool: 1 } },
      { type: 'steal', victim: ctx.players.find((p) => p !== mover)!.playerId }, { type: 'moveRobber', tile: 3 }, { type: 'upgradeCity', vertex: 1 },
      { type: 'placeRoad', edge: 4 }, { type: 'acceptTrade', offerId: 1 }, { type: 'roleAction', name: 'demolish', params: { kind: 'road', id: 1 } },
    ];
    for (const a of all) await mover.emit('game:preview', a);
    expect(ctx.draws()).toBe(draws);
    expect(JSON.stringify(stateOf(ctx.server, ctx.code))).toBe(before);
  });

  it('answers a dice roll with the verdict only: no dice, no production, no events', async () => {
    const ctx = await gameAt((s) => s.phase === 'roll' && s.turn > 4);
    const mover = ctx.mover();
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await mover.emit('game:preview', { type: 'roll' });
      expect(r.ok).toBe(true);
      expect(Object.keys(r.preview).sort()).toEqual(['cost', 'restricted']);
      expect(r.preview.restricted).toBe(true);
      seen.push(JSON.stringify(r));
    }
    for (const x of seen) expect(x).not.toMatch(REAL_RANDOM_WORDS);
    // the real roll, afterwards, is not what any preview could have shown
    const mark = mover.mark();
    expect(await mover.emit('game:action', { type: 'roll' })).toEqual({ ok: true });
    const upd = await mover.until('game:update', () => true, mark);
    expect(upd.events.some((e: any) => e.type === 'diceRolled')).toBe(true);
  });

  it('answers buying a development card with the cost only, never the card', async () => {
    const ctx = await gameAt((s) => s.phase === 'main' && s.turn > 4);
    const mover = ctx.mover();
    tweak(ctx, (s) => {
      const p = s.players.find((q) => q.id === s.current)!;
      p.hand = { lumber: 0, brick: 0, wool: 2, grain: 2, ore: 2 };
    });
    const top = stateOf(ctx.server, ctx.code).devDeck[0];
    const r = await mover.emit('game:preview', { type: 'buyDevCard' });
    expect(r.ok).toBe(true);
    expect(r.preview.restricted).toBe(true);
    expect(Object.keys(r.preview).sort()).toEqual(['cost', 'restricted']);
    expect(r.preview.cost).toMatchObject({ ore: 1, grain: 1 });
    expect(JSON.stringify(r)).not.toContain(top);
    expect(JSON.stringify(r)).not.toMatch(REAL_RANDOM_WORDS);
    // and previewing leaves the deck as it was
    expect(stateOf(ctx.server, ctx.code).devDeck[0]).toBe(top);
  });

  it('answers moving the robber onto a lone victim, and stealing, without the card that would be taken', async () => {
    const ctx = await gameAt((s) => s.phase === 'main' && s.turn > 4, { n: 3 });
    const mover = ctx.mover();
    const [victim] = ctx.players.filter((p) => p !== mover);
    // a tile where the victim, and only the victim, has a building, and who holds exactly one kind of card
    const s = stateOf(ctx.server, ctx.code);
    const topo = topologyOf(s.map);
    const tile = s.tiles.findIndex((_, i) => {
      if (i === s.robber) return false;
      const owners = new Set(topo.tiles[i].corners.map((v) => s.buildings[v]?.owner).filter(Boolean));
      return owners.size === 1 && owners.has(victim.playerId);
    });
    expect(tile, 'no tile with a lone victim in this game').toBeGreaterThanOrEqual(0);
    tweak(ctx, (g) => {
      g.phase = 'robber';
      g.returnPhase = 'main';
      g.players.find((p) => p.id === victim.playerId)!.hand = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 7 };
    });
    const r = await mover.emit('game:preview', { type: 'moveRobber', tile });
    expect(r.ok).toBe(true);
    expect(r.preview.restricted).toBe(true);
    expect(Object.keys(r.preview).sort()).toEqual(['cost', 'restricted']);
    expect(JSON.stringify(r)).not.toMatch(/stolen|"ore":[1-9]/);
    expect(stateOf(ctx.server, ctx.code).robber).not.toBe(tile);

    tweak(ctx, (g) => {
      g.phase = 'steal';
      g.stealFrom = [victim.playerId];
    });
    const r2 = await mover.emit('game:preview', { type: 'steal', victim: victim.playerId });
    expect(r2.ok).toBe(true);
    expect(Object.keys(r2.preview).sort()).toEqual(['cost', 'restricted']);
    expect(Object.values(r2.preview.cost).every((n) => n === 0)).toBe(true);
    expect(JSON.stringify(r2)).not.toMatch(/stolen|gain/);
    // the victim's cards are untouched
    expect(stateOf(ctx.server, ctx.code).players.find((p) => p.id === victim.playerId)!.hand.ore).toBe(7);
    // no preview carries a resource count of the victim's hidden hand anywhere
    for (const res of RESOURCES) expect(JSON.stringify([r, r2])).not.toContain(`"${res}":7`);
  });

  describe('a demolition preview', () => {
    /** the Soldier's main phase with the means to demolish; returns the rival and what they own */
    async function soldierMain() {
      const ctx = await gameAt((s) => s.phase === 'main' && s.turn > 6, { n: 2, seed: 7, soldier: true });
      const soldier = ctx.players[0];
      const rival = ctx.players[1];
      tweak(ctx, (g) => {
        g.current = soldier.playerId;
        g.phase = 'main';
        g.returnPhase = null;
        g.turnFlags = { devPlayed: false, counters: {} };
        g.demolishShield = {};
        g.players.find((p) => p.id === soldier.playerId)!.hand = { lumber: 0, brick: 0, wool: 3, grain: 3, ore: 5 };
      });
      return { ctx, soldier, rival };
    }
    const ask = (soldier: TestClient, kind: string, id: number) => soldier.emit('game:preview', { type: 'roleAction', name: 'demolish', params: { kind, id } });
    const reasonOf = (r: any) => ({ key: r?.error?.key, type: r?.error?.error?.type, reason: r?.error?.error?.reason, player: r?.error?.error?.player, until: r?.error?.error?.until });

    it('shows a demolished building in full: its price, whose points drop, the longest road, and nothing hidden', async () => {
      const { ctx, soldier, rival } = await soldierMain();
      const s = stateOf(ctx.server, ctx.code);
      const owned = Object.entries(s.buildings).filter(([, b]) => b.owner === rival.playerId);
      expect(owned.length).toBeGreaterThan(1);
      const [id, b] = owned[0];
      const before = JSON.stringify(s);
      const r = await ask(soldier, b.kind, Number(id));
      expect(r).toMatchObject({ ok: true, preview: { restricted: false } });
      expect(r.preview.cost).toEqual(DEMOLISH_COSTS[b.kind]);
      expect(r.preview.gain).toEqual({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
      const pts = r.preview.points;
      expect(pts[soldier.playerId].after).toBe(pts[soldier.playerId].before); // the Soldier gains nothing
      expect(pts[rival.playerId].after).toBe(pts[rival.playerId].before - 1); // a building costs its owner exactly one point
      expect(r.preview.events.some((e: any) => e.type === 'demolished' && e.from === rival.playerId && e.kind === b.kind)).toBe(true);
      // the longest road before and after, and every player's own length: public board facts
      expect(r.preview.longestRoad).toMatchObject({ before: { length: expect.any(Number) }, after: { length: expect.any(Number) } });
      expect(Object.keys(r.preview.roadLengths).sort()).toEqual([soldier.playerId, rival.playerId].sort());
      // nothing hidden: no hand of the rival, no card kinds
      expect(JSON.stringify(r)).not.toMatch(/devCards|"hand"/);
      expect(JSON.stringify(stateOf(ctx.server, ctx.code))).toBe(before);
    });

    it('shows a demolished road: its price, and the longest road it cuts', async () => {
      const { ctx, soldier, rival } = await soldierMain();
      const roads = Object.entries(stateOf(ctx.server, ctx.code).roads).filter(([, o]) => o === rival.playerId);
      expect(roads.length).toBeGreaterThan(0);
      const r = await ask(soldier, 'road', Number(roads[0][0]));
      expect(r).toMatchObject({ ok: true, preview: { restricted: false } });
      expect(r.preview.cost).toEqual(DEMOLISH_COSTS.road);
      expect(r.preview.roadLengths[rival.playerId].after).toBeLessThanOrEqual(r.preview.roadLengths[rival.playerId].before);
      expect(r.preview.points[rival.playerId].after).toBeLessThanOrEqual(r.preview.points[rival.playerId].before);
    });

    it('each refusal comes back as its own reason from the core: protected, last building, no settlement piece left, no money, one per turn', async () => {
      const { ctx, soldier, rival } = await soldierMain();
      const topo = topologyOf(stateOf(ctx.server, ctx.code).map);
      const spread: number[] = [];
      for (const v of topo.vertices) if (spread.every((o) => o !== v.id && !topo.vertices[o].neighbors.includes(v.id))) spread.push(v.id);
      const rivalId = rival.playerId;

      // protected: the rival was demolished in the last full round
      tweak(ctx, (g) => {
        g.demolishShield = { [rivalId]: g.turn + 2 };
      });
      const s0 = stateOf(ctx.server, ctx.code);
      const [bid, b] = Object.entries(s0.buildings).find(([, x]) => x.owner === rivalId)!;
      expect(reasonOf(await ask(soldier, b.kind, Number(bid)))).toEqual({ key: 'game', type: 'roleActionRefused', reason: 'protected', player: rivalId, until: s0.turn + 2 });

      // the rival's last building
      tweak(ctx, (g) => {
        g.demolishShield = {};
        for (const v of Object.keys(g.buildings)) if (g.buildings[Number(v)].owner === rivalId && Number(v) !== Number(bid)) delete g.buildings[Number(v)];
      });
      expect(reasonOf(await ask(soldier, b.kind, Number(bid)))).toMatchObject({ type: 'roleActionRefused', reason: 'lastBuilding', player: rivalId });

      // a city whose owner holds five settlements already (nothing left for it to fall to)
      tweak(ctx, (g) => {
        for (const v of Object.keys(g.buildings)) if (g.buildings[Number(v)].owner === rivalId) delete g.buildings[Number(v)];
        const free = spread.filter((v) => g.buildings[v] === undefined && topo.vertices[v].neighbors.every((n) => g.buildings[n] === undefined));
        g.buildings[free[0]] = { owner: rivalId, kind: 'city' };
        for (const v of free.slice(1, 6)) g.buildings[v] = { owner: rivalId, kind: 'settlement' };
      });
      const s1 = stateOf(ctx.server, ctx.code);
      const city = Object.entries(s1.buildings).find(([, x]) => x.owner === rivalId && x.kind === 'city')!;
      expect(Object.values(s1.buildings).filter((x) => x.owner === rivalId && x.kind === 'settlement')).toHaveLength(5);
      expect(reasonOf(await ask(soldier, 'city', Number(city[0])))).toMatchObject({ type: 'roleActionRefused', reason: 'settlementLimit', player: rivalId });

      // too poor, and then one a turn
      const settlement = Object.entries(s1.buildings).find(([, x]) => x.owner === rivalId && x.kind === 'settlement')!;
      tweak(ctx, (g) => {
        g.players.find((p) => p.id === soldier.playerId)!.hand = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
      });
      expect(reasonOf(await ask(soldier, 'settlement', Number(settlement[0])))).toMatchObject({ type: 'cannotAfford' });
      tweak(ctx, (g) => {
        g.players.find((p) => p.id === soldier.playerId)!.hand = { lumber: 0, brick: 0, wool: 3, grain: 3, ore: 5 };
        g.turnFlags.counters.demolish = 1;
      });
      expect(reasonOf(await ask(soldier, 'city', Number(city[0])))).toMatchObject({ type: 'roleActionRefused', reason: 'perTurnLimit' });
    });
  });

  it('is rate limited like every message', async () => {
    const { url } = await startServer({ rateLimit: { capacity: 6, perSecond: 0.0001 } });
    const c = await TestClient.login(url);
    const keys: unknown[] = [];
    for (let i = 0; i < 8; i++) keys.push(errorKey(await c.emit('game:preview', { type: 'roll' })));
    expect(keys.filter((k) => k === 'rateLimited').length).toBeGreaterThanOrEqual(2);
  });
});
