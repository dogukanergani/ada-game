import { RESOURCES, type Action, type GameMode, type Hand, type Resource } from '@ada/game-core';

/**
 * Shape checks for everything a client sends. They only decide whether the
 * data is well-formed; whether a move is legal is the core's business. Every
 * parser builds a fresh object, so unexpected extra fields never travel on.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false };
const bad = { ok: false } as const;
const good = <T>(value: T): Parsed<T> => ({ ok: true, value });

const isPlain = (x: unknown): x is Record<string, unknown> => {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};
const isInt = (x: unknown, max = 100_000): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max;
const isResource = (x: unknown): x is Resource => typeof x === 'string' && (RESOURCES as readonly string[]).includes(x);
const isShortString = (x: unknown, max: number): x is string => typeof x === 'string' && x.length >= 1 && x.length <= max;

function parseHand(x: unknown): Partial<Hand> | null {
  if (!isPlain(x)) return null;
  const out: Partial<Hand> = {};
  for (const k of Object.keys(x)) {
    if (!isResource(k) || !isInt(x[k], 99)) return null;
    out[k] = x[k] as number;
  }
  return out;
}

export function parseAction(x: unknown): Parsed<Action> {
  if (!isPlain(x) || typeof x.type !== 'string') return bad;
  switch (x.type) {
    case 'roll':
    case 'buyDevCard':
    case 'playKnight':
    case 'playRoadBuilding':
    case 'endTurn':
      return good({ type: x.type });
    case 'placeSettlement':
    case 'upgradeCity':
      return isInt(x.vertex) ? good({ type: x.type, vertex: x.vertex }) : bad;
    case 'placeRoad':
      return isInt(x.edge) ? good({ type: 'placeRoad', edge: x.edge }) : bad;
    case 'moveRobber':
      return isInt(x.tile) ? good({ type: 'moveRobber', tile: x.tile }) : bad;
    case 'steal':
      return isShortString(x.victim, 64) ? good({ type: 'steal', victim: x.victim }) : bad;
    case 'discard': {
      const resources = parseHand(x.resources);
      return resources ? good({ type: 'discard', resources }) : bad;
    }
    case 'bankTrade':
      return isResource(x.give) && isResource(x.get) ? good({ type: 'bankTrade', give: x.give, get: x.get }) : bad;
    case 'offerTrade': {
      const give = parseHand(x.give);
      const want = parseHand(x.want);
      return give && want ? good({ type: 'offerTrade', give, want }) : bad;
    }
    case 'teamGift': {
      const cards = parseHand(x.cards);
      return isShortString(x.to, 64) && cards ? good({ type: 'teamGift', to: x.to, cards }) : bad;
    }
    case 'acceptTrade':
    case 'cancelTrade':
      return isInt(x.offerId, 1_000_000_000) ? good({ type: x.type, offerId: x.offerId }) : bad;
    case 'playYearOfPlenty':
      return isResource(x.a) && isResource(x.b) ? good({ type: 'playYearOfPlenty', a: x.a, b: x.b }) : bad;
    case 'playMonopoly':
      return isResource(x.resource) ? good({ type: 'playMonopoly', resource: x.resource }) : bad;
    case 'roleAction': {
      if (!isShortString(x.name, 32)) return bad;
      if (x.params === undefined) return good({ type: 'roleAction', name: x.name });
      if (!isPlain(x.params)) return bad;
      const json = JSON.stringify(x.params);
      if (json.length > 1000) return bad;
      return good({ type: 'roleAction', name: x.name, params: JSON.parse(json) as Record<string, unknown> });
    }
    default:
      return bad;
  }
}

export interface HelloPayload { token?: string; /** null when the client sent none (an old client) */ protocolVersion: number | null }

export function parseHello(x: unknown): Parsed<HelloPayload> {
  if (x === undefined || x === null) return good({ protocolVersion: null });
  if (!isPlain(x)) return bad;
  const protocolVersion = isInt(x.protocolVersion, 1_000_000) ? x.protocolVersion : null;
  if (x.token === undefined) return good({ protocolVersion });
  return typeof x.token === 'string' && x.token.length <= 200 ? good({ token: x.token, protocolVersion }) : bad;
}

export const parseNameOnly = (x: unknown): Parsed<{ name: unknown }> => (isPlain(x) && 'name' in x ? good({ name: x.name }) : bad);
export const parseJoin = (x: unknown): Parsed<{ code: unknown; name: unknown }> =>
  isPlain(x) && 'code' in x && 'name' in x ? good({ code: x.code, name: x.name }) : bad;
export const parseRole = (x: unknown): Parsed<{ role: string | null }> =>
  isPlain(x) && (x.role === null || isShortString(x.role, 32)) ? good({ role: x.role as string | null }) : bad;
export const parseMode = (x: unknown): Parsed<{ mode: GameMode; targetScore?: number }> => {
  if (!isPlain(x) || !(x.mode === 'standard' || x.mode === 'short' || x.mode === 'custom')) return bad;
  if (x.targetScore === undefined) return good({ mode: x.mode });
  // the lobby decides whether the number is allowed; here it only has to be a number
  return typeof x.targetScore === 'number' && Number.isFinite(x.targetScore) ? good({ mode: x.mode, targetScore: x.targetScore }) : bad;
};

export const parseTeamMode = (x: unknown): Parsed<{ on: boolean }> => (isPlain(x) && typeof x.on === 'boolean' ? good({ on: x.on }) : bad);
export const parseTeam = (x: unknown): Parsed<{ team: 'A' | 'B' | null }> =>
  isPlain(x) && (x.team === null || x.team === 'A' || x.team === 'B') ? good({ team: x.team as 'A' | 'B' | null }) : bad;

/** `{timer: null}` or `{timer: {turnSeconds, gameSeconds}}` with whole numbers; whether the limits are on offer is the lobby's call. */
export const parseTimer = (x: unknown): Parsed<{ timer: { turnSeconds: number; gameSeconds: number } | null }> => {
  if (!isPlain(x) || !('timer' in x)) return bad;
  if (x.timer === null) return good({ timer: null });
  const t = x.timer;
  if (!isPlain(t) || !isInt(t.turnSeconds, 1_000_000) || !isInt(t.gameSeconds, 1_000_000)) return bad;
  return good({ timer: { turnSeconds: t.turnSeconds as number, gameSeconds: t.gameSeconds as number } });
};
