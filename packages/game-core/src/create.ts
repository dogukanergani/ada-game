import { err, type GameError } from './events';
import { generateHarbors, generateTiles, shuffle } from './maps/generate';
import type { MapDef } from './maps/mapdef';
import { mapFor } from './maps/defs';
import { validateMap } from './maps/topology';
import { DEV_DECK_COMPOSITION, MAX_PLAYERS, MIN_PLAYERS, MODES, bankStockFor } from './constants';
import { emptyHand } from './state';
import { isRoleId } from './roles/registry';
import {
  DEV_CARD_KINDS, RESOURCES,
  type DevCardKind, type GameMode, type GameState, type Player, type RoleId, type Rng,
} from './types';

export interface GameConfig {
  players: { id: string; name: string; role: RoleId }[];
  mode: GameMode;
  /** custom map; defaults to the map chosen for the mode and player count */
  map?: MapDef;
}

export type CreateResult = { ok: true; state: GameState } | { ok: false; error: GameError };

export function createGame(config: GameConfig, rng: Rng): CreateResult {
  const n = config.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return { ok: false, error: err('invalidSetup', { reason: 'playerCount', count: n }) };
  if (!(config.mode in MODES)) return { ok: false, error: err('invalidSetup', { reason: 'mode' }) };
  if (new Set(config.players.map((p) => p.id)).size !== n) return { ok: false, error: err('invalidSetup', { reason: 'duplicateId' }) };
  if (config.players.some((p) => typeof p.id !== 'string' || !p.id)) return { ok: false, error: err('invalidSetup', { reason: 'badId' }) };
  if (config.players.some((p) => !isRoleId(p.role))) return { ok: false, error: err('invalidSetup', { reason: 'unknownRole' }) };
  if (new Set(config.players.map((p) => p.role)).size !== n) return { ok: false, error: err('invalidSetup', { reason: 'duplicateRole' }) };

  const map = structuredClone(config.map ?? mapFor(config.mode, n));
  const problems = validateMap(map);
  if (problems.length) return { ok: false, error: err('invalidSetup', { reason: 'badMap', problems }) };

  const seats = shuffle(config.players, rng);
  const players: Player[] = seats.map((p, i) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    seat: i,
    hand: emptyHand(),
    devCards: [],
    knightsPlayed: 0,
  }));
  const { tiles, robber } = generateTiles(map, rng);
  const stock = bankStockFor(config.mode, n);
  const bank = emptyHand();
  for (const r of RESOURCES) bank[r] = stock;
  const deck: DevCardKind[] = [];
  for (const k of DEV_CARD_KINDS) for (let i = 0; i < DEV_DECK_COMPOSITION[k]; i++) deck.push(k);
  const ids = players.map((p) => p.id);

  const state: GameState = {
    mode: config.mode,
    vpToWin: MODES[config.mode].vpToWin,
    map,
    tiles,
    harbors: generateHarbors(map, rng),
    robber,
    buildings: {},
    roads: {},
    players,
    bank,
    devDeck: shuffle(deck, rng),
    devPlayed: { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
    phase: 'setup',
    returnPhase: null,
    current: ids[0],
    turn: 0,
    dice: null,
    setup: { order: [...ids, ...[...ids].reverse()], index: 0, step: 'settlement', lastSettlement: null },
    pendingDiscards: {},
    stealFrom: [],
    roadBuildingLeft: 0,
    offers: [],
    nextOfferId: 1,
    turnFlags: { devPlayed: false, counters: {} },
    protectedUntil: { roads: {}, buildings: {} },
    longestRoad: { holder: null, length: 0 },
    largestArmy: { holder: null, size: 0 },
    winner: null,
  };
  return { ok: true, state };
}
