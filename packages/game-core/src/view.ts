import type { GameEvent } from './events';
import type { MapDef } from './maps/mapdef';
import { hiddenPoints, longestRoadFor, publicPoints } from './scoring';
import { handCount } from './state';
import { bankRatioFor } from './trade';
import { costFor, devCardCostFor } from './validate';
import {
  RESOURCES,
  type Building, type DevCardInHand, type DevCardKind, type GameMode, type GameState, type Harbor, type Hand, type Phase,
  type PieceKind, type Resource, type RoleId, type SetupState, type Tile, type TradeOffer,
} from './types';

/** What one player may know about a seat. Secrets are `null` for everyone but the owner. */
export interface PlayerView {
  id: string;
  name: string;
  role: RoleId;
  seat: number;
  handCount: number;
  devCardCount: number;
  knightsPlayed: number;
  /** points everyone can see (no hidden cards) */
  points: number;
  roadLength: number;
  hand: Hand | null;
  devCards: DevCardInHand[] | null;
  /** victory point cards in hand */
  hiddenPoints: number | null;
}

/**
 * The only thing ever sent to a client. Opponents' hands, development cards
 * and the deck's content and order are replaced by counts.
 */
export interface GameView {
  me: string;
  mode: GameMode;
  vpToWin: number;
  map: MapDef;
  tiles: Tile[];
  harbors: Harbor[];
  robber: number;
  buildings: Record<number, Building>;
  roads: Record<number, string>;
  players: PlayerView[];
  bank: Hand;
  devDeckCount: number;
  devPlayed: Record<DevCardKind, number>;
  phase: Phase;
  returnPhase: 'roll' | 'main' | null;
  current: string;
  turn: number;
  dice: [number, number] | null;
  setup: SetupState | null;
  pendingDiscards: Record<string, number>;
  stealFrom: string[];
  roadBuildingLeft: number;
  offers: TradeOffer[];
  turnFlags: { devPlayed: boolean; counters: Record<string, number> };
  protectedUntil: { roads: Record<number, number>; buildings: Record<number, number> };
  longestRoad: { holder: string | null; length: number };
  largestArmy: { holder: string | null; size: number };
  winner: string | null;
  /** the viewer's own costs and bank ratios, already adjusted by their role and harbors (null for spectators) */
  mine: { costs: Record<PieceKind | 'devCard', Hand>; bankRatios: Record<Resource, number> } | null;
}

export function viewFor(state: GameState, playerId: string): GameView {
  const finished = state.phase === 'finished';
  const seated = state.players.some((p) => p.id === playerId);
  return structuredClone({
    me: playerId,
    mode: state.mode,
    vpToWin: state.vpToWin,
    map: state.map,
    tiles: state.tiles,
    harbors: state.harbors,
    robber: state.robber,
    buildings: state.buildings,
    roads: state.roads,
    players: state.players.map((p): PlayerView => {
      const reveal = p.id === playerId || finished;
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        seat: p.seat,
        handCount: handCount(p.hand),
        devCardCount: p.devCards.length,
        knightsPlayed: p.knightsPlayed,
        points: publicPoints(state, p.id),
        roadLength: longestRoadFor(state, p.id),
        hand: reveal ? p.hand : null,
        devCards: reveal ? p.devCards : null,
        hiddenPoints: reveal ? hiddenPoints(state, p.id) : null,
      };
    }),
    bank: state.bank,
    devDeckCount: state.devDeck.length,
    devPlayed: state.devPlayed,
    phase: state.phase,
    returnPhase: state.returnPhase,
    current: state.current,
    turn: state.turn,
    dice: state.dice,
    setup: state.setup,
    pendingDiscards: state.pendingDiscards,
    stealFrom: state.stealFrom,
    roadBuildingLeft: state.roadBuildingLeft,
    offers: state.offers,
    turnFlags: state.turnFlags,
    protectedUntil: state.protectedUntil,
    longestRoad: state.longestRoad,
    largestArmy: state.largestArmy,
    winner: state.winner,
    mine: seated
      ? {
          costs: {
            road: costFor(state, playerId, 'road'),
            settlement: costFor(state, playerId, 'settlement'),
            city: costFor(state, playerId, 'city'),
            devCard: devCardCostFor(state, playerId),
          },
          bankRatios: Object.fromEntries(RESOURCES.map((r) => [r, bankRatioFor(state, playerId, r)])) as Record<Resource, number>,
        }
      : null,
  });
}

/**
 * Events as one player may see them: what was stolen is known only to thief
 * and victim; a bought card's kind only to its buyer.
 */
export function eventFor(event: GameEvent, playerId: string): GameEvent {
  if (event.type === 'stolen' && event.thief !== playerId && event.victim !== playerId) return { ...event, resource: null };
  if (event.type === 'devCardBought' && event.player !== playerId) return { ...event, kind: null };
  return event;
}

export const eventsFor = (events: GameEvent[], playerId: string): GameEvent[] => events.map((e) => eventFor(e, playerId));
