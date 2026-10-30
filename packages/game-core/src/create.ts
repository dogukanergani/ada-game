import { err, type GameError } from './events';
import { generateHarbors, generateTiles, shuffle } from './maps/generate';
import type { MapDef } from './maps/mapdef';
import { mapFor } from './maps/defs';
import { validateMap } from './maps/topology';
import { CUSTOM_TARGET_MAX, CUSTOM_TARGET_MIN, DEV_DECK_COMPOSITION, MAX_PLAYERS, MIN_PLAYERS, MODES, TEAM_MODE_PLAYERS, TEAM_SIZE, bankStockFor } from './constants';
import { emptyHand } from './state';
import { isRoleId } from './roles/registry';
import {
  DEV_CARD_KINDS, RESOURCES, TEAMS,
  type DevCardKind, type GameMode, type GameState, type Player, type RoleId, type Rng, type Team, type TimerConfig,
} from './types';

export interface GameConfig {
  players: { id: string; name: string; role: RoleId }[];
  mode: GameMode;
  /** custom map; defaults to the map chosen for the mode and player count */
  map?: MapDef;
  /** points to win; required (an integer from 5 to 15) in a custom game and not allowed in the others */
  targetScore?: number;
  /** timed mode: limits in seconds. Needs `now` passed to createGame. Omitted or null = untimed. */
  timer?: TimerConfig | null;
  /** team mode: every player's team. Present = team mode (exactly 4 players, two on each team); absent = no teams. */
  teams?: Record<string, Team>;
}

export type CreateResult = { ok: true; state: GameState } | { ok: false; error: GameError };

const positiveInt = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0;

/** `now` (ms) is read only for a timed game, where it starts the game clock. */
export function createGame(config: GameConfig, rng: Rng, now?: number): CreateResult {
  const n = config.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return { ok: false, error: err('invalidSetup', { reason: 'playerCount', count: n }) };
  if (!(config.mode in MODES)) return { ok: false, error: err('invalidSetup', { reason: 'mode' }) };
  if (new Set(config.players.map((p) => p.id)).size !== n) return { ok: false, error: err('invalidSetup', { reason: 'duplicateId' }) };
  if (config.players.some((p) => typeof p.id !== 'string' || !p.id)) return { ok: false, error: err('invalidSetup', { reason: 'badId' }) };
  if (config.players.some((p) => !isRoleId(p.role))) return { ok: false, error: err('invalidSetup', { reason: 'unknownRole' }) };
  if (new Set(config.players.map((p) => p.role)).size !== n) return { ok: false, error: err('invalidSetup', { reason: 'duplicateRole' }) };

  if (config.mode === 'custom') {
    const t = config.targetScore;
    if (!Number.isInteger(t) || t! < CUSTOM_TARGET_MIN || t! > CUSTOM_TARGET_MAX) return { ok: false, error: err('invalidSetup', { reason: 'targetScore' }) };
  } else if (config.targetScore !== undefined) {
    return { ok: false, error: err('invalidSetup', { reason: 'targetScore' }) };
  }
  const teams = config.teams;
  if (teams !== undefined) {
    if (n !== TEAM_MODE_PLAYERS) return { ok: false, error: err('invalidSetup', { reason: 'teamPlayerCount', count: n }) };
    const sizes: Record<Team, number> = { A: 0, B: 0 };
    for (const p of config.players) {
      const t = teams[p.id];
      if (!(TEAMS as readonly unknown[]).includes(t)) return { ok: false, error: err('invalidSetup', { reason: 'teamAssignment' }) };
      sizes[t]++;
    }
    if (sizes.A !== TEAM_SIZE || sizes.B !== TEAM_SIZE) return { ok: false, error: err('invalidSetup', { reason: 'teamAssignment' }) };
  }
  const timer = config.timer ?? null;
  if (timer && (!positiveInt(timer.turnSeconds) || !positiveInt(timer.gameSeconds) || !Number.isFinite(now))) {
    return { ok: false, error: err('invalidSetup', { reason: 'timer' }) };
  }

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
    team: teams ? teams[p.id] : null,
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
    vpToWin: config.mode === 'custom' ? config.targetScore! : MODES[config.mode].vpToWin,
    teamMode: teams !== undefined,
    teamTarget: null,
    timer: timer ? { turnSeconds: timer.turnSeconds, gameSeconds: timer.gameSeconds } : null,
    gameStartedAt: timer ? now! : null,
    turnStartedAt: null,
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
    demolishShield: {},
    longestRoad: { holder: null, length: 0 },
    largestArmy: { holder: null, size: 0 },
    winners: [],
  };
  if (state.teamMode) state.teamTarget = state.vpToWin * 2;
  return { ok: true, state };
}
