export type Rng = () => number;

export const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Hand = Record<Resource, number>;
export type TileKind = Resource | 'desert';
export type PieceKind = 'road' | 'settlement' | 'city';

export const RESOURCE_LABEL: Record<Resource, string> = {
  lumber: 'Odun',
  brick: 'Tuğla',
  wool: 'Koyun',
  grain: 'Buğday',
  ore: 'Cevher',
};

export type RoleId = 'merchant' | 'architect' | 'farmer' | 'miner' | 'hunter' | 'explorer';

export type Phase = 'setup' | 'roll' | 'discard' | 'robber' | 'steal' | 'main' | 'finished';

export interface Tile {
  id: number;
  q: number;
  r: number;
  kind: TileKind;
  number: number | null;
}

export interface Building {
  owner: string;
  kind: 'settlement' | 'city';
}

export interface Player {
  id: string;
  name: string;
  color: string;
  role: RoleId;
  resources: Hand;
}

export interface SetupState {
  /** Snake order: p0..pn-1, pn-1..p0 */
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
  tiles: Tile[];
  /** vertex id -> building */
  buildings: Record<number, Building>;
  /** edge id -> owner player id */
  roads: Record<number, string>;
  robber: number;
  players: Player[];
  phase: Phase;
  current: string;
  setup: SetupState | null;
  dice: [number, number] | null;
  /** player id -> number of cards they must discard */
  pendingDiscards: Record<string, number>;
  stealFrom: string[];
  offers: TradeOffer[];
  nextOfferId: number;
  longestRoad: { holder: string | null; length: number };
  turn: number;
  winner: string | null;
  vpToWin: number;
  log: string[];
}

/** What a single player is allowed to see: opponents' hands are hidden. */
export interface PlayerView extends Omit<Player, 'resources'> {
  resources: Hand | null;
  cardCount: number;
  vp: number;
  roadLength: number;
}

export interface GameView extends Omit<GameState, 'players'> {
  players: PlayerView[];
  me: string;
}
