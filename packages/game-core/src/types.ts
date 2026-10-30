import type { MapDef } from './maps/mapdef';

export type Rng = () => number;

export const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Hand = Record<Resource, number>;
export type TileKind = Resource | 'desert';
export type PieceKind = 'road' | 'settlement' | 'city';
export type GameMode = 'standard' | 'short' | 'custom';

/** The two fixed teams of the team mode. */
export const TEAMS = ['A', 'B'] as const;
export type Team = (typeof TEAMS)[number];

/** Role ids are plain strings: the role list is data (see roles/defs.ts). */
export type RoleId = string;

export const DEV_CARD_KINDS = ['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly'] as const;
export type DevCardKind = (typeof DEV_CARD_KINDS)[number];

export type Phase = 'setup' | 'roll' | 'discard' | 'robber' | 'steal' | 'roadBuilding' | 'main' | 'finished';

export interface Tile {
  kind: TileKind;
  number: number | null;
}

export interface Harbor {
  edge: number;
  /** 'any' is a 3:1 harbor, a resource is a 2:1 harbor for that resource */
  type: Resource | 'any';
}

export interface Building {
  owner: string;
  kind: 'settlement' | 'city';
}

export interface DevCardInHand {
  kind: DevCardKind;
  /** value of `turn` when it was bought; it cannot be played during that turn */
  boughtTurn: number;
}

export interface Player {
  id: string;
  name: string;
  role: RoleId;
  seat: number;
  hand: Hand;
  devCards: DevCardInHand[];
  knightsPlayed: number;
  /** the player's team; null unless the game is in team mode */
  team: Team | null;
}

export interface SetupState {
  /** snake order: p0..pn-1, pn-1..p0 */
  order: string[];
  index: number;
  step: 'settlement' | 'road';
  lastSettlement: number | null;
}

export interface TradeOffer {
  id: number;
  from: string;
  give: Hand;
  want: Hand;
}

/** Time limits of a timed game, in seconds. `null` on the state means the game is untimed. */
export interface TimerConfig {
  turnSeconds: number;
  gameSeconds: number;
}

export interface GameState {
  mode: GameMode;
  /** points needed to win: fixed by the mode, or chosen (5-15) in a custom game */
  vpToWin: number;
  /** team mode (fixed 2v2, points are summed per team); off by default */
  teamMode: boolean;
  /** points a team needs: twice `vpToWin` in team mode, null otherwise */
  teamTarget: number | null;
  /** the timed mode's limits; null while the game is untimed (the default) */
  timer: TimerConfig | null;
  /** server time (ms) the game was created; null when untimed. Only ever set from the `now` the caller passes in. */
  gameStartedAt: number | null;
  /** server time (ms) the current turn began; null until the first turn (setup is not timed) and when untimed */
  turnStartedAt: number | null;
  map: MapDef;
  /** index = tile id of `map.tiles` */
  tiles: Tile[];
  harbors: Harbor[];
  robber: number;
  /** vertex id -> building */
  buildings: Record<number, Building>;
  /** edge id -> owner player id */
  roads: Record<number, string>;
  players: Player[];
  bank: Hand;
  /** hidden: the next card is the last element */
  devDeck: DevCardKind[];
  /** cards played so far, by kind (victory point cards never appear here) */
  devPlayed: Record<DevCardKind, number>;
  phase: Phase;
  /** where to go after robber/steal/roadBuilding finish */
  returnPhase: 'roll' | 'main' | null;
  current: string;
  turn: number;
  dice: [number, number] | null;
  setup: SetupState | null;
  /** player id -> number of cards they must discard */
  pendingDiscards: Record<string, number>;
  stealFrom: string[];
  roadBuildingLeft: number;
  offers: TradeOffer[];
  nextOfferId: number;
  turnFlags: { devPlayed: boolean; counters: Record<string, number> };
  /** player id -> a player who has been demolished cannot be demolished again before this `turn` value (public) */
  demolishShield: Record<string, number>;
  longestRoad: { holder: string | null; length: number };
  largestArmy: { holder: string | null; size: number };
  /** empty while the game runs; one id for a win by points, several when a timed game ends level */
  winners: string[];
}
