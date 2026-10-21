import { TOPOLOGY as T, generateTiles, shuffle } from './board';
import { ROLES } from './roles';
import {
  RESOURCES,
  RESOURCE_LABEL,
  type GameState,
  type Hand,
  type PieceKind,
  type Player,
  type Resource,
  type RoleId,
  type Rng,
} from './types';

export const PLAYER_COLORS = ['#FF7A45', '#B28DFF', '#F4F6F8', '#FF5CA8'];

export const BASE_COSTS: Record<PieceKind, Hand> = {
  road: { lumber: 1, brick: 1, wool: 0, grain: 0, ore: 0 },
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1, ore: 0 },
  city: { lumber: 0, brick: 0, wool: 0, grain: 2, ore: 3 },
};
export const PIECE_LIMITS: Record<PieceKind, number> = { road: 15, settlement: 5, city: 4 };

export type Action =
  | { type: 'placeSettlement'; vertex: number }
  | { type: 'placeRoad'; edge: number }
  | { type: 'upgradeCity'; vertex: number }
  | { type: 'roll' }
  | { type: 'discard'; resources: Partial<Hand> }
  | { type: 'moveRobber'; tile: number }
  | { type: 'steal'; victim: string }
  | { type: 'bankTrade'; give: Resource; get: Resource }
  | { type: 'offerTrade'; give: Partial<Hand>; want: Partial<Hand> }
  | { type: 'acceptTrade'; offerId: number }
  | { type: 'cancelTrade'; offerId: number }
  | { type: 'endTurn' };

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

export const emptyHand = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
export const handCount = (h: Hand): number => RESOURCES.reduce((s, r) => s + h[r], 0);
export const canAfford = (have: Hand, cost: Hand): boolean => RESOURCES.every((r) => have[r] >= cost[r]);

const isId = (n: unknown, len: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < len;
const isResource = (x: unknown): x is Resource => typeof x === 'string' && (RESOURCES as readonly string[]).includes(x);

/** Validates an untrusted partial hand coming from a client. */
function sanitizeHand(input: unknown): Hand | null {
  if (!input || typeof input !== 'object') return null;
  const out = emptyHand();
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isResource(k)) return null;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 99) return null;
    out[k] = v as number;
  }
  return out;
}

const getPlayer = (s: GameState, id: string): Player => s.players.find((p) => p.id === id)!;

function pushLog(s: GameState, msg: string) {
  s.log.push(msg);
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}

function describeHand(h: Hand): string {
  return RESOURCES.filter((r) => h[r] > 0)
    .map((r) => `${h[r]} ${RESOURCE_LABEL[r]}`)
    .join(', ');
}

function pay(p: Player, cost: Hand) {
  for (const r of RESOURCES) p.resources[r] -= cost[r];
}
function receive(p: Player, h: Partial<Hand>) {
  for (const r of RESOURCES) p.resources[r] += h[r] ?? 0;
}

/** Anything with players' roles: works for both GameState and the per-player GameView. */
type WithRoles = { players: { id: string; role: RoleId }[] };

export function costFor(s: WithRoles, pid: string, piece: PieceKind): Hand {
  const base = BASE_COSTS[piece];
  const role = ROLES[s.players.find((p) => p.id === pid)!.role];
  return role.cost ? role.cost(piece, base) : { ...base };
}

export function bankRatioFor(s: WithRoles, pid: string, give: Resource): number {
  const role = ROLES[s.players.find((p) => p.id === pid)!.role];
  return role.bankRatio ? role.bankRatio(4, give) : 4;
}

function countPieces(s: Pick<GameState, 'roads' | 'buildings'>, pid: string): Record<PieceKind, number> {
  const out = { road: 0, settlement: 0, city: 0 };
  for (const o of Object.values(s.roads)) if (o === pid) out.road++;
  for (const b of Object.values(s.buildings)) if (b.owner === pid) out[b.kind]++;
  return out;
}

/* ------------------------------------------------------------------ */
/* geometry-based legality (shared with the client for highlighting)   */
/* ------------------------------------------------------------------ */

export type BoardLike = Pick<GameState, 'phase' | 'current' | 'setup' | 'buildings' | 'roads'>;

const distanceOk = (s: BoardLike, v: number) => T.vertices[v].neighbors.every((n) => !s.buildings[n]);
const touchesOwnRoad = (s: BoardLike, v: number, pid: string) => T.vertices[v].edges.some((e) => s.roads[e] === pid);

function roadConnected(s: BoardLike, edge: number, pid: string): boolean {
  const e = T.edges[edge];
  return [e.a, e.b].some((v) => {
    const b = s.buildings[v];
    if (b) return b.owner === pid;
    return touchesOwnRoad(s, v, pid);
  });
}

export function legalSettlementVertices(s: BoardLike, pid: string): number[] {
  if (s.current !== pid) return [];
  const all = T.vertices.map((v) => v.id).filter((v) => !s.buildings[v] && distanceOk(s, v));
  if (s.phase === 'setup') return s.setup?.step === 'settlement' ? all : [];
  if (s.phase === 'main') {
    if (countPieces(s, pid).settlement >= PIECE_LIMITS.settlement) return [];
    return all.filter((v) => touchesOwnRoad(s, v, pid));
  }
  return [];
}

export function legalRoadEdges(s: BoardLike, pid: string): number[] {
  if (s.current !== pid) return [];
  const free = T.edges.map((e) => e.id).filter((e) => s.roads[e] === undefined);
  if (s.phase === 'setup') {
    if (s.setup?.step !== 'road' || s.setup.lastSettlement === null) return [];
    const near = new Set(T.vertices[s.setup.lastSettlement].edges);
    return free.filter((e) => near.has(e));
  }
  if (s.phase === 'main') {
    if (countPieces(s, pid).road >= PIECE_LIMITS.road) return [];
    return free.filter((e) => roadConnected(s, e, pid));
  }
  return [];
}

export function legalCityVertices(s: BoardLike, pid: string): number[] {
  if (s.phase !== 'main' || s.current !== pid) return [];
  if (countPieces(s, pid).city >= PIECE_LIMITS.city) return [];
  return T.vertices.map((v) => v.id).filter((v) => s.buildings[v]?.owner === pid && s.buildings[v].kind === 'settlement');
}

/* ------------------------------------------------------------------ */
/* scoring                                                             */
/* ------------------------------------------------------------------ */

export function longestRoadFor(s: Pick<GameState, 'roads' | 'buildings'>, pid: string): number {
  const byVertex = new Map<number, number[]>();
  for (const [eid, owner] of Object.entries(s.roads)) {
    if (owner !== pid) continue;
    const e = T.edges[Number(eid)];
    for (const v of [e.a, e.b]) {
      if (!byVertex.has(v)) byVertex.set(v, []);
      byVertex.get(v)!.push(e.id);
    }
  }
  if (!byVertex.size) return 0;
  const blocked = (v: number) => {
    const b = s.buildings[v];
    return !!b && b.owner !== pid;
  };
  const used = new Set<number>();
  let best = 0;
  const dfs = (v: number, len: number) => {
    if (len > best) best = len;
    if (len > 0 && blocked(v)) return;
    for (const eid of byVertex.get(v) ?? []) {
      if (used.has(eid)) continue;
      used.add(eid);
      const e = T.edges[eid];
      dfs(e.a === v ? e.b : e.a, len + 1);
      used.delete(eid);
    }
  };
  for (const v of byVertex.keys()) dfs(v, 0);
  return best;
}

export function victoryPoints(s: Pick<GameState, 'buildings' | 'longestRoad'>, pid: string): number {
  let vp = 0;
  for (const b of Object.values(s.buildings)) if (b.owner === pid) vp += b.kind === 'city' ? 2 : 1;
  if (s.longestRoad.holder === pid) vp += 2;
  return vp;
}

function updateLongestRoad(s: GameState) {
  const lens: Record<string, number> = {};
  for (const p of s.players) lens[p.id] = longestRoadFor(s, p.id);
  const max = Math.max(...Object.values(lens));
  let holder = s.longestRoad.holder;
  if (max < 5) {
    holder = null;
  } else if (!(holder && lens[holder] === max)) {
    const top = s.players.filter((p) => lens[p.id] === max);
    holder = top.length === 1 ? top[0].id : null;
  }
  if (holder !== s.longestRoad.holder && holder) {
    pushLog(s, `${getPlayer(s, holder).name} en uzun yolu aldı (${lens[holder]}).`);
  }
  s.longestRoad = { holder, length: max >= 5 ? max : 0 };
}

function checkWin(s: GameState) {
  if (s.phase === 'finished') return;
  const me = getPlayer(s, s.current);
  if (victoryPoints(s, me.id) >= s.vpToWin) {
    s.phase = 'finished';
    s.winner = me.id;
    pushLog(s, `${me.name} oyunu kazandı!`);
  }
}

/* ------------------------------------------------------------------ */
/* game creation                                                       */
/* ------------------------------------------------------------------ */

export function createGame(
  input: { id: string; name: string; role: RoleId }[],
  rng: Rng,
  opts: { vpToWin?: number } = {},
): GameState {
  const seats = shuffle(input, rng);
  const players: Player[] = seats.map((p, i) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    color: PLAYER_COLORS[i],
    resources: emptyHand(),
  }));
  const tiles = generateTiles(rng);
  const desert = tiles.find((t) => t.kind === 'desert')!;
  const ids = players.map((p) => p.id);
  const order = [...ids, ...[...ids].reverse()];
  return {
    tiles,
    buildings: {},
    roads: {},
    robber: desert.id,
    players,
    phase: 'setup',
    current: order[0],
    setup: { order, index: 0, step: 'settlement', lastSettlement: null },
    dice: null,
    pendingDiscards: {},
    stealFrom: [],
    offers: [],
    nextOfferId: 1,
    longestRoad: { holder: null, length: 0 },
    turn: 0,
    winner: null,
    vpToWin: opts.vpToWin ?? 10,
    log: [`Oyun başladı. Sıra: ${players.map((p) => p.name).join(', ')}.`],
  };
}

/* ------------------------------------------------------------------ */
/* reducer                                                             */
/* ------------------------------------------------------------------ */

const fail = (error: string): Result => ({ ok: false, error });

export function applyAction(prev: GameState, pid: string, action: Action, rng: Rng): Result {
  if (prev.phase === 'finished') return fail('Oyun bitti.');
  if (!prev.players.some((p) => p.id === pid)) return fail('Bu oyunda değilsin.');
  if (!action || typeof action !== 'object') return fail('Geçersiz hamle.');

  const s: GameState = structuredClone(prev);
  let err: string | null;
  switch (action.type) {
    case 'placeSettlement':
      err = placeSettlement(s, pid, action.vertex, rng);
      break;
    case 'placeRoad':
      err = placeRoad(s, pid, action.edge);
      break;
    case 'upgradeCity':
      err = upgradeCity(s, pid, action.vertex);
      break;
    case 'roll':
      err = roll(s, pid, rng);
      break;
    case 'discard':
      err = discard(s, pid, action.resources);
      break;
    case 'moveRobber':
      err = moveRobber(s, pid, action.tile, rng);
      break;
    case 'steal':
      err = steal(s, pid, action.victim, rng);
      break;
    case 'bankTrade':
      err = bankTrade(s, pid, action.give, action.get);
      break;
    case 'offerTrade':
      err = offerTrade(s, pid, action.give, action.want);
      break;
    case 'acceptTrade':
      err = acceptTrade(s, pid, action.offerId);
      break;
    case 'cancelTrade':
      err = cancelTrade(s, pid, action.offerId);
      break;
    case 'endTurn':
      err = endTurn(s, pid);
      break;
    default:
      return fail('Bilinmeyen hamle.');
  }
  return err ? fail(err) : { ok: true, state: s };
}

function placeSettlement(s: GameState, pid: string, v: unknown, rng: Rng): string | null {
  if (!isId(v, T.vertices.length)) return 'Geçersiz konum.';
  const me = getPlayer(s, pid);

  if (s.phase === 'setup') {
    if (s.current !== pid || s.setup?.step !== 'settlement') return 'Şu an yerleşim koyma sırası sende değil.';
    if (s.buildings[v]) return 'Burası dolu.';
    if (!distanceOk(s, v)) return 'Yanındaki kesişimde yapı var.';
    s.buildings[v] = { owner: pid, kind: 'settlement' };
    s.setup.step = 'road';
    s.setup.lastSettlement = v;
    if (s.setup.index >= s.players.length) {
      const got = emptyHand();
      for (const t of T.vertices[v].tiles) {
        const kind = s.tiles[t].kind;
        if (kind !== 'desert') got[kind]++;
      }
      receive(me, got);
    }
    pushLog(s, `${me.name} yerleşim kurdu.`);
    return null;
  }

  if (s.phase !== 'main' || s.current !== pid) return 'Şu an yapı kuramazsın.';
  if (s.buildings[v]) return 'Burası dolu.';
  if (!distanceOk(s, v)) return 'Yanındaki kesişimde yapı var.';
  if (!touchesOwnRoad(s, v, pid)) return 'Yerleşim kendi yoluna bağlı olmalı.';
  if (countPieces(s, pid).settlement >= PIECE_LIMITS.settlement) return 'Yerleşim hakkın bitti.';
  const cost = costFor(s, pid, 'settlement');
  if (!canAfford(me.resources, cost)) return 'Yeterli kaynağın yok.';

  pay(me, cost);
  s.buildings[v] = { owner: pid, kind: 'settlement' };
  const adjacent: Resource[] = [];
  for (const t of T.vertices[v].tiles) {
    const kind = s.tiles[t].kind;
    if (kind !== 'desert') adjacent.push(kind);
  }
  const bonus = ROLES[me.role].onSettlementBuilt?.({ adjacent, rng });
  if (bonus) receive(me, bonus);
  pushLog(s, `${me.name} yerleşim kurdu${bonus && describeHand({ ...emptyHand(), ...bonus }) ? ` (+${describeHand({ ...emptyHand(), ...bonus })})` : ''}.`);
  updateLongestRoad(s);
  checkWin(s);
  return null;
}

function placeRoad(s: GameState, pid: string, e: unknown): string | null {
  if (!isId(e, T.edges.length)) return 'Geçersiz konum.';
  const me = getPlayer(s, pid);
  if (s.roads[e] !== undefined) return 'Burada zaten yol var.';

  if (s.phase === 'setup') {
    if (s.current !== pid || s.setup?.step !== 'road') return 'Şu an yol koyma sırası sende değil.';
    if (!legalRoadEdges(s, pid).includes(e)) return 'Yol, az önce kurduğun yerleşime bağlı olmalı.';
    s.roads[e] = pid;
    pushLog(s, `${me.name} yol kurdu.`);
    const setup = s.setup;
    setup.index += 1;
    if (setup.index >= setup.order.length) {
      s.setup = null;
      s.phase = 'roll';
      s.current = setup.order[0];
      pushLog(s, `Kurulum bitti. Sıra ${getPlayer(s, s.current).name} oyuncusunda.`);
    } else {
      setup.step = 'settlement';
      setup.lastSettlement = null;
      s.current = setup.order[setup.index];
    }
    updateLongestRoad(s);
    return null;
  }

  if (s.phase !== 'main' || s.current !== pid) return 'Şu an yol kuramazsın.';
  if (!roadConnected(s, e, pid)) return 'Yol kendi yapına ya da yoluna bağlı olmalı.';
  if (countPieces(s, pid).road >= PIECE_LIMITS.road) return 'Yol hakkın bitti.';
  const cost = costFor(s, pid, 'road');
  if (!canAfford(me.resources, cost)) return 'Yeterli kaynağın yok.';
  pay(me, cost);
  s.roads[e] = pid;
  pushLog(s, `${me.name} yol kurdu.`);
  updateLongestRoad(s);
  checkWin(s);
  return null;
}

function upgradeCity(s: GameState, pid: string, v: unknown): string | null {
  if (!isId(v, T.vertices.length)) return 'Geçersiz konum.';
  if (s.phase !== 'main' || s.current !== pid) return 'Şu an şehir kuramazsın.';
  const me = getPlayer(s, pid);
  const b = s.buildings[v];
  if (!b || b.owner !== pid || b.kind !== 'settlement') return 'Burada yükseltilecek yerleşimin yok.';
  if (countPieces(s, pid).city >= PIECE_LIMITS.city) return 'Şehir hakkın bitti.';
  const cost = costFor(s, pid, 'city');
  if (!canAfford(me.resources, cost)) return 'Yeterli kaynağın yok.';
  pay(me, cost);
  b.kind = 'city';
  pushLog(s, `${me.name} şehir kurdu.`);
  checkWin(s);
  return null;
}

function roll(s: GameState, pid: string, rng: Rng): string | null {
  if (s.phase !== 'roll' || s.current !== pid) return 'Şu an zar atamazsın.';
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  const total = d1 + d2;
  s.dice = [d1, d2];
  pushLog(s, `${getPlayer(s, pid).name} zar attı: ${d1} + ${d2} = ${total}.`);

  if (total === 7) {
    s.pendingDiscards = {};
    for (const p of s.players) {
      const limit = ROLES[p.role].discardLimit ?? 7;
      const n = handCount(p.resources);
      if (n > limit) s.pendingDiscards[p.id] = Math.floor(n / 2);
    }
    if (Object.keys(s.pendingDiscards).length) {
      s.phase = 'discard';
      pushLog(s, 'Yedi geldi: kart atılacak.');
    } else {
      s.phase = 'robber';
      pushLog(s, 'Yedi geldi: haydut taşınacak.');
    }
    return null;
  }

  produce(s, total);
  s.phase = 'main';
  return null;
}

function produce(s: GameState, total: number) {
  const gains: Record<string, Hand> = {};
  for (const p of s.players) gains[p.id] = emptyHand();
  for (const tile of s.tiles) {
    if (tile.number !== total || tile.id === s.robber || tile.kind === 'desert') continue;
    for (const v of T.tiles[tile.id].corners) {
      const b = s.buildings[v];
      if (b) gains[b.owner][tile.kind] += b.kind === 'city' ? 2 : 1;
    }
  }
  for (const p of s.players) {
    const g = gains[p.id];
    const bonus = ROLES[p.role].onProduce?.({ gains: g, roll: total });
    if (bonus) for (const r of RESOURCES) g[r] += bonus[r] ?? 0;
    if (handCount(g) > 0) {
      receive(p, g);
      pushLog(s, `${p.name}: +${describeHand(g)}`);
    }
  }
}

function discard(s: GameState, pid: string, input: unknown): string | null {
  if (s.phase !== 'discard') return 'Şu an kart atılmıyor.';
  const need = s.pendingDiscards[pid];
  if (!need) return 'Kart atman gerekmiyor.';
  const h = sanitizeHand(input);
  if (!h) return 'Geçersiz kart seçimi.';
  if (handCount(h) !== need) return `Tam ${need} kart atmalısın.`;
  const me = getPlayer(s, pid);
  if (!canAfford(me.resources, h)) return 'Elinde olmayan kartı atamazsın.';
  pay(me, h);
  delete s.pendingDiscards[pid];
  pushLog(s, `${me.name} ${need} kart attı.`);
  if (!Object.keys(s.pendingDiscards).length) {
    s.phase = 'robber';
    pushLog(s, 'Haydut taşınacak.');
  }
  return null;
}

function moveRobber(s: GameState, pid: string, tile: unknown, rng: Rng): string | null {
  if (s.phase !== 'robber' || s.current !== pid) return 'Şu an haydutu taşıyamazsın.';
  if (!isId(tile, s.tiles.length)) return 'Geçersiz bölge.';
  if (tile === s.robber) return 'Haydut başka bir bölgeye gitmeli.';
  s.robber = tile;
  const me = getPlayer(s, pid);
  pushLog(s, `${me.name} haydutu taşıdı.`);
  const victims = new Set<string>();
  for (const v of T.tiles[tile].corners) {
    const b = s.buildings[v];
    if (b && b.owner !== pid && handCount(getPlayer(s, b.owner).resources) > 0) victims.add(b.owner);
  }
  if (victims.size === 0) {
    s.phase = 'main';
  } else if (victims.size === 1) {
    stealCard(s, pid, [...victims][0], rng);
    s.phase = 'main';
  } else {
    s.phase = 'steal';
    s.stealFrom = [...victims];
  }
  return null;
}

function stealCard(s: GameState, thiefId: string, victimId: string, rng: Rng) {
  const victim = getPlayer(s, victimId);
  const pool: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < victim.resources[r]; i++) pool.push(r);
  if (!pool.length) return;
  const r = pool[Math.floor(rng() * pool.length)];
  victim.resources[r] -= 1;
  getPlayer(s, thiefId).resources[r] += 1;
  pushLog(s, `${getPlayer(s, thiefId).name}, ${victim.name} oyuncusundan 1 kart çaldı.`);
}

function steal(s: GameState, pid: string, victim: unknown, rng: Rng): string | null {
  if (s.phase !== 'steal' || s.current !== pid) return 'Şu an kart çalamazsın.';
  if (typeof victim !== 'string' || !s.stealFrom.includes(victim)) return 'Bu oyuncudan çalamazsın.';
  stealCard(s, pid, victim, rng);
  s.stealFrom = [];
  s.phase = 'main';
  return null;
}

function bankTrade(s: GameState, pid: string, give: unknown, get: unknown): string | null {
  if (s.phase !== 'main' || s.current !== pid) return 'Şu an takas yapamazsın.';
  if (!isResource(give) || !isResource(get) || give === get) return 'Geçersiz takas.';
  const me = getPlayer(s, pid);
  const ratio = bankRatioFor(s, pid, give);
  if (me.resources[give] < ratio) return `${RESOURCE_LABEL[give]} için ${ratio} kart gerekir.`;
  me.resources[give] -= ratio;
  me.resources[get] += 1;
  pushLog(s, `${me.name} bankayla takas yaptı: ${ratio} ${RESOURCE_LABEL[give]} → 1 ${RESOURCE_LABEL[get]}.`);
  return null;
}

function offerTrade(s: GameState, pid: string, giveIn: unknown, wantIn: unknown): string | null {
  if (s.phase !== 'main' || s.current !== pid) return 'Şu an teklif veremezsin.';
  const give = sanitizeHand(giveIn);
  const want = sanitizeHand(wantIn);
  if (!give || !want) return 'Geçersiz teklif.';
  if (handCount(give) === 0 || handCount(want) === 0) return 'İki tarafta da kart olmalı.';
  if (RESOURCES.some((r) => give[r] > 0 && want[r] > 0)) return 'Aynı kaynağı hem verip hem isteyemezsin.';
  const me = getPlayer(s, pid);
  if (!canAfford(me.resources, give)) return 'Teklif ettiğin kartlar elinde yok.';
  s.offers = s.offers.filter((o) => o.from !== pid);
  s.offers.push({ id: s.nextOfferId++, from: pid, give, want });
  pushLog(s, `${me.name} takas teklif etti: ${describeHand(give)} karşılığında ${describeHand(want)}.`);
  return null;
}

function acceptTrade(s: GameState, pid: string, offerId: unknown): string | null {
  if (s.phase !== 'main') return 'Şu an takas yapılamaz.';
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer) return 'Bu teklif artık yok.';
  if (offer.from === pid) return 'Kendi teklifini kabul edemezsin.';
  const me = getPlayer(s, pid);
  const from = getPlayer(s, offer.from);
  if (!canAfford(me.resources, offer.want)) return 'İstenen kartlar sende yok.';
  if (!canAfford(from.resources, offer.give)) return 'Teklif sahibinin kartları artık yetmiyor.';
  pay(from, offer.give);
  receive(me, offer.give);
  pay(me, offer.want);
  receive(from, offer.want);
  s.offers = [];
  pushLog(s, `${me.name}, ${from.name} ile takas yaptı.`);
  return null;
}

function cancelTrade(s: GameState, pid: string, offerId: unknown): string | null {
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer || offer.from !== pid) return 'Bu teklifi iptal edemezsin.';
  s.offers = s.offers.filter((o) => o.id !== offerId);
  return null;
}

function endTurn(s: GameState, pid: string): string | null {
  if (s.phase !== 'main' || s.current !== pid) return 'Şu an turu bitiremezsin.';
  const i = s.players.findIndex((p) => p.id === pid);
  s.current = s.players[(i + 1) % s.players.length].id;
  s.phase = 'roll';
  s.dice = null;
  s.offers = [];
  s.turn += 1;
  return null;
}
