import type { MapDef } from './maps/mapdef';

export type Rng = () => number;

export const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Hand = Record<Resource, number>;
export type TileKind = Resource | 'desert';
export type PieceKind = 'road' | 'settlement' | 'city';
export type GameMode = 'standard' | 'short';

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

export interface GameState {
  mode: GameMode;
  vpToWin: number;
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
  /** captured pieces cannot be captured again before this `turn` value */
  protectedUntil: { roads: Record<number, number>; buildings: Record<number, number> };
  longestRoad: { holder: string | null; length: number };
  largestArmy: { holder: string | null; size: number };
  winner: string | null;
}
