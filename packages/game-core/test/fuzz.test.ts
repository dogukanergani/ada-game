import { describe, expect, it } from 'vitest';
import {
  DEV_CARD_KINDS, DEV_DECK_SIZE, canAfford, costFor, PIECE_LIMITS, RESOURCES, ROLE_LIST, applyAction, bankStockFor, createGame, legalBankTrades,
  legalCityVertices, legalDevPlays, legalRoadEdges, legalRobberTiles, legalRoleActions, legalSettlementVertices, legalStealVictims,
  handCount, longestRoadFor, publicPoints, teamPoints, tickTimers, topologyOf, totalPoints, validate, viewFor,
  type Action, type GameEvent, type GameMode, type GameState, type Hand, type Rng,
} from '../src';
import { mulberry32 } from './helpers';
import { chooseWeighted, moves, pick } from '../sim/bot';
import { greedyMoves } from '../sim/greedy';

/* ---------------- invariants (plain throws: cheap enough to run every step) ---------------- */

const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`invariant broken: ${msg}`);
};

/** Points recomputed from the pieces with code that shares nothing with scoring.ts. */
function independentPublicPoints(s: GameState, pid: string): number {
  let vp = 0;
  for (const v in s.buildings) if (s.buildings[v].owner === pid) vp += s.buildings[v].kind === 'city' ? 2 : 1;
  if (s.longestRoad.holder === pid) vp += 2;
  if (s.largestArmy.holder === pid) vp += 2;
  return vp;
}

function invariants(s: GameState) {
  const n = s.players.length;
  const stock = bankStockFor(s.mode, n);
  const topo = topologyOf(s.map);

  for (const r of RESOURCES) {
    must(s.bank[r] >= 0, `bank ${r} negative`);
    let total = s.bank[r];
    for (const p of s.players) {
      must(p.hand[r] >= 0, `${p.id} has negative ${r}`);
      total += p.hand[r];
    }
    must(total === stock, `${r} total ${total} != stock ${stock}`);
  }

  const held = s.players.reduce((a, p) => a + p.devCards.length, 0);
  const played = DEV_CARD_KINDS.reduce((a, k) => a + s.devPlayed[k], 0);
  must(s.devDeck.length + held + played === DEV_DECK_SIZE, `dev cards ${s.devDeck.length}+${held}+${played} != ${DEV_DECK_SIZE}`);
  must(s.devPlayed.victoryPoint === 0, 'a victory point card was played');
  must(s.players.reduce((a, p) => a + p.knightsPlayed, 0) === s.devPlayed.knight, 'knight counts disagree');

  const ids = new Set(s.players.map((p) => p.id));
  const counts: Record<string, { road: number; settlement: number; city: number }> = {};
  for (const p of s.players) counts[p.id] = { road: 0, settlement: 0, city: 0 };
  for (const e in s.roads) {
    must(Number(e) < topo.edges.length && ids.has(s.roads[e]), 'bad road');
    counts[s.roads[e]].road++;
  }
  for (const v in s.buildings) {
    const b = s.buildings[v];
    must(Number(v) < topo.vertices.length && ids.has(b.owner), 'bad building');
    counts[b.owner][b.kind]++;
    for (const nb of topo.vertices[Number(v)].neighbors) must(s.buildings[nb] === undefined, 'distance rule broken');
  }
  for (const p of s.players) {
    must(counts[p.id].road <= PIECE_LIMITS.road, `${p.id} road limit`);
    must(counts[p.id].settlement <= PIECE_LIMITS.settlement, `${p.id} settlement limit`);
    must(counts[p.id].city <= PIECE_LIMITS.city, `${p.id} city limit`);
  }

  // longest road: holder needs >= 5 and the maximum; with no holder no one may stand alone at >= 5
  const longRoads = s.players.map((p) => counts[p.id].road >= 5);
  const lens = s.players.map((p, i) => (longRoads[i] ? longestRoadFor(s, p.id) : 0)); // under 5 roads the length cannot reach 5
  const max = Math.max(...lens);
  if (s.longestRoad.holder) {
    const hl = lens[s.players.findIndex((p) => p.id === s.longestRoad.holder)];
    must(hl >= 5, 'longest road holder has fewer than 5');
    must(hl === max, 'longest road holder is not the longest');
  } else if (max >= 5) {
    must(lens.filter((l) => l === max).length > 1, 'a unique longest road >= 5 has no holder');
  }

  const maxKnights = Math.max(...s.players.map((p) => p.knightsPlayed));
  if (s.largestArmy.holder) {
    const k = s.players.find((p) => p.id === s.largestArmy.holder)!.knightsPlayed;
    must(k >= 3 && k === maxKnights && s.largestArmy.size === k, 'largest army holder inconsistent');
  } else {
    must(maxKnights < 3, 'a player has 3+ knights but no army');
  }

  for (const p of s.players) {
    must(publicPoints(s, p.id) === independentPublicPoints(s, p.id), `points of ${p.id} do not match the pieces`);
    must(totalPoints(s, p.id) === independentPublicPoints(s, p.id) + p.devCards.filter((c) => c.kind === 'victoryPoint').length, 'hidden points');
  }

  // phase bookkeeping
  must(ids.has(s.current), 'current player exists');
  must((s.phase === 'discard') === (Object.keys(s.pendingDiscards).length > 0), 'pendingDiscards vs phase');
  must((s.phase === 'steal') === (s.stealFrom.length > 0), 'stealFrom vs phase');
  must((s.phase === 'roadBuilding') === (s.roadBuildingLeft > 0), 'roadBuildingLeft vs phase');
  must((['discard', 'robber', 'steal', 'roadBuilding'] as string[]).includes(s.phase) === (s.returnPhase !== null), 'returnPhase vs phase');
  must((s.turnFlags.counters.demolish ?? 0) <= 1, 'more than one demolition in a turn');
  for (const [pid, until] of Object.entries(s.demolishShield)) must(ids.has(pid) && Number.isInteger(until), 'bad demolish shield');
  must(s.robber >= 0 && s.robber < s.tiles.length && s.tiles[s.robber] !== undefined, 'robber tile');
  must((s.phase === 'finished') === (s.winners.length > 0), 'winners vs phase');
  must(new Set(s.winners).size === s.winners.length && s.winners.every((w) => ids.has(w)), 'bad winners list');
  if (s.teamMode) teamInvariants(s);
  else if (s.winners.length) {
    const totals = s.players.map((p) => totalPoints(s, p.id));
    const top = Math.max(...totals);
    const [first] = s.winners;
    if (s.winners.length === 1 && totalPoints(s, first) >= s.vpToWin) {
      // won by points, on their own turn
      must(first === s.current, 'a win by points belongs to the player whose turn it is');
    } else {
      // only the game time can end a game level or below the target: everyone on the top score wins, nobody else
      must(s.timer !== null, 'a game without a timer ended without a winner at the target');
      must(s.winners.every((w) => totalPoints(s, w) === top), 'a winner is not on the top score');
      must(s.players.filter((p) => totalPoints(s, p.id) === top).length === s.winners.length, 'a top scorer is missing from the winners');
    }
  }
  // the clock fields exist exactly when the game is timed
  must((s.timer === null) === (s.gameStartedAt === null), 'timer vs gameStartedAt');
  if (s.timer === null) must(s.turnStartedAt === null, 'an untimed game has a turn clock');
  if (s.timer) must(s.turnStartedAt !== null || s.phase === 'setup' || (s.phase === 'finished' && s.turn === 0), 'a timed game past setup has a turn clock');
  must(s.vpToWin >= 5 && s.vpToWin <= 15, 'target score out of range');
  if (s.mode !== 'custom') must(s.vpToWin === (s.mode === 'short' ? 7 : 10), 'fixed mode target changed');
  if (!s.teamMode && s.phase !== 'finished' && s.phase !== 'setup') {
    // nobody sits on the target during their own turn without having won
    must(totalPoints(s, s.current) < s.vpToWin, 'current player at the target but game not finished');
  }
}

/** Team mode: the teams stay 2v2, the target is doubled, wins belong to whole teams, and the protections hold in every position. */
function teamInvariants(s: GameState) {
  const ids = new Set(s.players.map((p) => p.id));
  must(s.players.length === 4 && s.players.filter((p) => p.team === 'A').length === 2 && s.players.filter((p) => p.team === 'B').length === 2, 'teams are not 2v2');
  must(s.teamTarget === s.vpToWin * 2, 'team target is not twice the target');
  const teamOf = (id: string) => s.players.find((p) => p.id === id)!.team;
  if (s.winners.length) {
    const sums = { A: teamPoints(s, 'A'), B: teamPoints(s, 'B') };
    const members = (t: 'A' | 'B') => s.players.filter((p) => p.team === t).map((p) => p.id).sort();
    const w = [...s.winners].sort();
    const byTarget = w.length === 2 && teamOf(w[0]) === teamOf(w[1]) && sums[teamOf(w[0])!] >= s.teamTarget! && teamOf(w[0]) === teamOf(s.current);
    if (byTarget) {
      must(JSON.stringify(w) === JSON.stringify(members(teamOf(w[0])!)), 'winners are not a whole team');
    } else {
      // only the game time can end it otherwise: the better team, or all four when level
      must(s.timer !== null, 'a team game without a timer ended without a team at the target');
      const best = Math.max(sums.A, sums.B);
      const expected = [...(sums.A === best ? members('A') : []), ...(sums.B === best ? members('B') : [])].sort();
      must(JSON.stringify(w) === JSON.stringify(expected), 'a timed team game picked the wrong winners');
    }
  } else if (s.phase !== 'finished' && s.phase !== 'setup') {
    must(teamPoints(s, teamOf(s.current)!) < s.teamTarget!, 'current team at the target but game not finished');
  }
  must(s.winners.every((w) => ids.has(w)), 'bad winners');
  // protection: nobody may ever rob or demolish a teammate
  for (const v of s.stealFrom) must(teamOf(v) !== teamOf(s.current), 'a teammate is a steal target');
  if (s.phase === 'steal') for (const v of legalStealVictims(s, s.current)) must(teamOf(v) !== teamOf(s.current), 'a teammate is a legal steal victim');
  if (s.phase === 'main') {
    for (const a of legalRoleActions(s, s.current)) {
      if (a.type !== 'roleAction' || a.name !== 'demolish') continue;
      const { kind, id } = a.params as { kind: 'road' | 'settlement' | 'city'; id: number };
      const owner = kind === 'road' ? s.roads[id] : s.buildings[id].owner;
      must(teamOf(owner) !== teamOf(s.current), 'a teammate piece is a legal demolition target');
    }
  }
}

/**
 * What a step may do to the pieces and the cards, checked on every step of every game: nobody who has a settlement or a city
 * is ever left with none (only a demolition removes a building, and it spares the last one); and a demolition changes exactly
 * what the rules say: it costs the Soldier its price (which goes to the bank) and nothing else of the Soldier's changes except
 * the longest road it may open; a road or a settlement goes back to its owner's stock, a city falls to a settlement; the
 * demolished player is shielded for a full round, and was not shielded already.
 */
function checkTransition(prev: GameState, next: GameState, events: GameEvent[], stats: Stats) {
  for (const p of prev.players) {
    const had = Object.values(prev.buildings).filter((b) => b.owner === p.id).length;
    const has = Object.values(next.buildings).filter((b) => b.owner === p.id).length;
    must(had === 0 || has > 0, `${p.id} was left with no settlement or city`);
  }
  const count = (s: GameState, pid: string) => {
    const c = { road: 0, settlement: 0, city: 0 };
    for (const o of Object.values(s.roads)) if (o === pid) c.road++;
    for (const b of Object.values(s.buildings)) if (b.owner === pid) c[b.kind]++;
    return c;
  };
  const buildingPoints = (s: GameState, pid: string) => Object.values(s.buildings).reduce((a, b) => a + (b.owner === pid ? (b.kind === 'city' ? 2 : 1) : 0), 0);
  for (const e of events) {
    if (e.type !== 'demolished') continue;
    stats.demolished++;
    const before = prev.players.find((p) => p.id === e.player)!;
    const after = next.players.find((p) => p.id === e.player)!;
    for (const r of RESOURCES) {
      must(after.hand[r] === before.hand[r] - e.cost[r], 'the Soldier did not pay exactly the price');
      must(next.bank[r] === prev.bank[r] + e.cost[r], 'the price did not go to the bank');
    }
    const mineBefore = count(prev, e.player);
    const mineAfter = count(next, e.player);
    must(JSON.stringify(mineBefore) === JSON.stringify(mineAfter), 'a demolition changed the Soldier\'s own pieces');
    must(buildingPoints(next, e.player) === buildingPoints(prev, e.player), 'the Soldier gained building points from a demolition');
    must(publicPoints(next, e.player) >= publicPoints(prev, e.player), 'the Soldier lost points by demolishing');
    const was = count(prev, e.from);
    const now = count(next, e.from);
    if (e.kind === 'road') must(now.road === was.road - 1 && now.settlement === was.settlement && now.city === was.city, 'a demolished road');
    else if (e.kind === 'settlement') must(now.settlement === was.settlement - 1 && now.road === was.road && now.city === was.city, 'a demolished settlement');
    else must(now.city === was.city - 1 && now.settlement === was.settlement + 1 && now.road === was.road, 'a demolished city did not fall to a settlement');
    if (e.kind !== 'road') must(buildingPoints(next, e.from) === buildingPoints(prev, e.from) - 1, 'a demolished building did not cost its owner exactly 1 point');
    must((prev.demolishShield[e.from] ?? 0) <= prev.turn, 'a shielded player was demolished');
    must(next.demolishShield[e.from] === prev.turn + prev.players.length, 'the demolished player was not shielded for a full round');
  }
}

/**
 * The dice event's tile lists must match the board as everyone can see it
 * (numbers, robber, buildings): they add nothing a client could not work out, and
 * every producing player must have a building on a listed tile.
 */
function checkRollTiles(after: GameState, events: GameEvent[], stats: Stats) {
  const rolled = events.find((e) => e.type === 'diceRolled');
  if (!rolled || rolled.type !== 'diceRolled') return;
  const topo = topologyOf(after.map);
  const expectHit: number[] = [];
  let expectRobbed: number | null = null;
  after.tiles.forEach((t, i) => {
    if (t.kind === 'desert' || t.number !== rolled.total) return;
    if (i === after.robber) expectRobbed = i;
    else if (topo.tiles[i].corners.some((v) => after.buildings[v])) expectHit.push(i);
  });
  must(JSON.stringify(rolled.hitTiles) === JSON.stringify(expectHit), 'hitTiles do not match the public board');
  must(rolled.robbedTile === expectRobbed, 'robbedTile does not match the public board');
  must(Object.keys(rolled).sort().join() === 'dice,hitTiles,player,robbedTile,total,type', 'diceRolled carries unexpected fields');
  if (rolled.total === 7) must(rolled.hitTiles.length === 0 && rolled.robbedTile === null, 'a seven hits no tile');
  for (const e of events) {
    if (e.type !== 'produced') continue;
    const touches = rolled.hitTiles.some((i) => topo.tiles[i].corners.some((v) => after.buildings[v]?.owner === e.player));
    must(touches, 'a player produced without a building on a hit tile');
  }
  stats.hits += rolled.hitTiles.length;
  if (rolled.robbedTile !== null) stats.robbed++;
}

/* ---------------- one game ---------------- */

interface Stats {
  games: number;
  finished: number;
  steps: number;
  byType: Record<string, number>;
  roleWins: Record<string, number>;
  rolePlays: Record<string, number>;
  stolen: number;
  demolished: number;
  blocked: number;
  hits: number;
  robbed: number;
  refusedProbes: number;
  timedOutTurns: number;
  endedByTime: number;
  gifts: number;
}

const newStats = (): Stats => ({ games: 0, finished: 0, steps: 0, byType: {}, roleWins: {}, rolePlays: {}, stolen: 0, demolished: 0, blocked: 0, hits: 0, robbed: 0, refusedProbes: 0, timedOutTurns: 0, endedByTime: 0, gifts: 0 });
const T0 = 1_700_000_000_000;

const BAD_PROBES: unknown[] = [
  { type: 'placeSettlement', vertex: -1 }, { type: 'placeRoad', edge: 99999 }, { type: 'bankTrade', give: 'gold', get: 'ore' },
  { type: 'discard', resources: { ore: -2 } }, { type: 'roleAction', name: '__proto__' }, { type: 'steal', victim: 'nobody' },
  { type: 'acceptTrade', offerId: 12345 }, null, 'roll', { type: 'upgradeCity', vertex: 0.5 },
];

/** Extra game setup for a playout: a custom target, and/or the timed mode with a fake clock that jumps forward as the bots play. */
interface Variant {
  teams?: boolean;
  targetScore?: number;
  timer?: { turnSeconds: number; gameSeconds: number };
}

function playGame(seed: number, n: number, mode: GameMode, stats: Stats, maxSteps = 5000, bot = moves, variant: Variant = {}): GameState {
  const rng = mulberry32(seed * 7919 + n);
  const roles = ROLE_LIST.map((r) => r.id);
  const shift = seed % roles.length;
  const chosen = Array.from({ length: n }, (_, i) => roles[(shift + i) % roles.length]);
  const { teams, ...rest } = variant;
  const created = createGame(
    {
      players: chosen.map((role, i) => ({ id: `p${i}`, name: `P${i}`, role })),
      mode,
      ...rest,
      ...(teams ? { teams: Object.fromEntries(chosen.map((_, i) => [`p${i}`, i % 2 === 0 ? 'A' : 'B'])) as Record<string, 'A' | 'B'> } : {}),
    },
    rng,
    T0,
  );
  must(created.ok, 'createGame failed');
  let s = (created as { ok: true; state: GameState }).state;
  invariants(s);

  let actionsThisTurn = 0;
  let lastTurn = s.turn;
  let now = T0;
  for (let step = 0; step < maxSteps && s.phase !== 'finished'; step++) {
    if (variant.timer) {
      // time passes (up to 40 s a move); whatever the clock then forces must keep every invariant too
      now += Math.floor(rng() * 40_000);
      const t = tickTimers(s, rng, now);
      must(t.ok, 'tickTimers failed');
      if (t.ok && t.events.length) {
        checkTransition(s, t.state, t.events, stats);
        s = t.state;
        invariants(s);
        for (const e of t.events) {
          if (e.type === 'turnTimedOut') stats.timedOutTurns++;
          if (e.type === 'gameWon' && e.reason === 'time') stats.endedByTime++;
        }
        if (s.phase === 'finished') break;
      }
    }
    const ms = bot(s, rng, actionsThisTurn);
    must(ms.length > 0, `stuck in phase ${s.phase}`);
    const m = chooseWeighted(ms, rng);

    // the validator and the reducer must agree, and a refusal must leave the state untouched
    const checkPurity = step % 10 === 0;
    const before = checkPurity ? JSON.stringify(s) : '';
    const verdict = validate(s, m.pid, m.action);
    const r = applyAction(s, m.pid, m.action, rng, now);
    must(verdict === null, `a listed move failed validation: ${JSON.stringify(m.action)} -> ${JSON.stringify(verdict)}`);
    must(r.ok, `a validated move was refused: ${JSON.stringify(m.action)} ${JSON.stringify((r as { error?: unknown }).error)}`);
    if (checkPurity) must(JSON.stringify(s) === before, 'applyAction mutated its input');
    if (!r.ok) throw new Error('unreachable');
    const prev = s;
    s = r.state;
    checkTransition(prev, s, r.events, stats);
    stats.steps++;
    stats.byType[m.action.type] = (stats.byType[m.action.type] ?? 0) + 1;
    if (m.action.type === 'roleAction') stats.byType[`role:${m.action.name}`] = (stats.byType[`role:${m.action.name}`] ?? 0) + 1;
    checkRollTiles(s, r.events, stats);
    for (const e of r.events) {
      if (e.type === 'teamGifted') stats.gifts++;
      if (e.type === 'stolen') stats.stolen++;
      if (e.type === 'productionBlocked') stats.blocked++;
      if (e.type === 'tradeAccepted') {
        const gift = handCount(e.give) === 0 || handCount(e.want) === 0;
        if (gift) stats.byType['trade:oneSided'] = (stats.byType['trade:oneSided'] ?? 0) + 1;
        // a one-sided trade never pays a role's trade bonus
        if (gift && r.events.some((x) => x.type === 'roleBonus' && x.player === e.from)) throw new Error('a one-sided trade paid a role bonus');
      }
    }
    invariants(s);

    if (s.turn !== lastTurn) {
      lastTurn = s.turn;
      actionsThisTurn = 0;
    } else actionsThisTurn++;

    if (step % 17 === 0) {
      const probe = pick(BAD_PROBES, rng);
      const bad = applyAction(s, pick(s.players, rng).id, probe as Action, rng);
      must(!bad.ok, `malformed action accepted: ${JSON.stringify(probe)}`);
      stats.refusedProbes++;
    }
    if (step % 150 === 0) {
      must(JSON.stringify(JSON.parse(JSON.stringify(s))) === JSON.stringify(s), 'state is not plain JSON');
      for (const p of s.players) must(viewFor(s, p.id).me === p.id, 'view');
    }
  }
  stats.games++;
  for (const p of s.players) stats.rolePlays[p.role] = (stats.rolePlays[p.role] ?? 0) + 1;
  if (s.phase === 'finished') {
    stats.finished++;
    for (const id of s.winners) {
      const w = s.players.find((p) => p.id === id)!;
      stats.roleWins[w.role] = (stats.roleWins[w.role] ?? 0) + 1;
    }
  }
  return s;
}

describe('random playouts', () => {
  it('keeps every invariant over hundreds of bot games (2-5 players, all roles, both modes)', () => {
    const stats = newStats();
    let seed = 1;
    for (const mode of ['standard', 'short'] as GameMode[]) {
      for (let n = 2; n <= 5; n++) {
        const games = 25;
        for (let g = 0; g < games; g++) playGame(seed++, n, mode, stats);
      }
    }
    // the bot must have exercised every kind of action, otherwise the run proves little
    for (const t of [
      'placeSettlement', 'placeRoad', 'upgradeCity', 'roll', 'discard', 'moveRobber', 'steal', 'bankTrade', 'offerTrade', 'acceptTrade',
      'buyDevCard', 'playKnight', 'playRoadBuilding', 'playYearOfPlenty', 'playMonopoly', 'endTurn', 'role:demolish', 'trade:oneSided',
    ]) {
      if (!stats.byType[t]) throw new Error(`the bot never played ${t}`);
    }
    for (const r of ROLE_LIST) if (!stats.rolePlays[r.id]) throw new Error(`role ${r.id} never played`);
    expect(stats.games).toBe(200);
    expect(stats.finished).toBeGreaterThan(stats.games * 0.5);
    expect(stats.stolen).toBeGreaterThan(0);
    expect(stats.demolished).toBeGreaterThan(0);
    expect(stats.blocked).toBeGreaterThan(0);
    expect(stats.hits).toBeGreaterThan(0);
    expect(stats.robbed).toBeGreaterThan(0);
    if (process.env.FUZZ_REPORT) console.log(JSON.stringify(stats, null, 1));
  }, 120_000);

  it('keeps every invariant when greedy bots play (they build, trade, demolish and rob on purpose)', () => {
    const stats = newStats();
    let seed = 5000;
    for (const mode of ['standard', 'short'] as GameMode[]) {
      for (let n = 2; n <= 5; n++) for (let g = 0; g < 6; g++) playGame(seed++, n, mode, stats, 6000, greedyMoves);
    }
    expect(stats.demolished).toBeGreaterThan(0);
    expect(stats.games).toBe(48);
    expect(stats.finished).toBe(48);
    for (const t of ['upgradeCity', 'placeSettlement', 'buyDevCard', 'bankTrade', 'moveRobber', 'playKnight']) {
      if (!stats.byType[t]) throw new Error('the greedy bot never played ' + t);
    }
  }, 120_000);

  it('keeps every invariant in custom-target games (5 and 15 points included)', () => {
    const stats = newStats();
    let seed = 8000;
    for (const targetScore of [5, 8, 15]) {
      for (let n = 2; n <= 5; n++) for (let g = 0; g < 4; g++) playGame(seed++, n, 'custom', stats, 6000, moves, { targetScore });
    }
    expect(stats.games).toBe(48);
    expect(stats.finished).toBeGreaterThan(30);
  }, 120_000);

  it('keeps every invariant in timed games, where the clock forces turns to end and ends games early', () => {
    const stats = newStats();
    let seed = 9000;
    const timers = [
      { turnSeconds: 60, gameSeconds: 900 },
      { turnSeconds: 60, gameSeconds: 2_000_000 },
      { turnSeconds: 150, gameSeconds: 5400 },
    ];
    for (const mode of ['standard', 'short', 'custom'] as GameMode[]) {
      for (let n = 2; n <= 5; n++) {
        for (const timer of timers) playGame(seed++, n, mode, stats, 6000, moves, { timer, ...(mode === 'custom' ? { targetScore: 9 } : {}) });
      }
    }
    expect(stats.games).toBe(36);
    expect(stats.timedOutTurns).toBeGreaterThan(50);
    expect(stats.endedByTime).toBeGreaterThan(3);
    expect(stats.byType.endTurn).toBeGreaterThan(0);
  }, 120_000);

  it('keeps every invariant in team games (2v2), plain, timed and with the Soldier demolishing', () => {
    const stats = newStats();
    let seed = 12000;
    for (const mode of ['standard', 'short', 'custom'] as GameMode[]) {
      for (let g = 0; g < 14; g++) playGame(seed++, 4, mode, stats, 6000, moves, { teams: true, ...(mode === 'custom' ? { targetScore: 6 } : {}) });
    }
    for (const bot of [moves, greedyMoves]) {
      for (let g = 0; g < 6; g++) playGame(seed++, 4, 'short', stats, 6000, bot, { teams: true });
    }
    const timers = [{ turnSeconds: 60, gameSeconds: 900 }, { turnSeconds: 150, gameSeconds: 5400 }];
    for (const timer of timers) for (let g = 0; g < 10; g++) playGame(seed++, 4, 'standard', stats, 6000, moves, { teams: true, timer });
    expect(stats.games).toBe(42 + 12 + 20);
    expect(stats.gifts).toBeGreaterThan(100);
    expect(stats.finished).toBeGreaterThan(40);
    expect(stats.demolished).toBeGreaterThan(0);
    expect(stats.endedByTime).toBeGreaterThan(0);
    if (!stats.byType.teamGift) throw new Error('the bot never sent a gift');
  }, 240_000);

  it('the same seed replays to the same final state', () => {
    const a = playGame(42, 4, 'standard', newStats(), 800);
    const b = playGame(42, 4, 'standard', newStats(), 800);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
