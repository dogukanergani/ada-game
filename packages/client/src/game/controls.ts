import {
  RESOURCES, ROLES, canAfford, type Action, type GameView, type Hand, type LegalMoves, type Phase, type PieceKind, type PlayerViewLike,
} from './types';
import type { BoardTarget, Pick } from '../board/Board';
import type { MessageKey } from '../i18n';

/**
 * What the player can do right now, worked out from the view and the legal
 * moves the server sent. Nothing here decides legality: whether a button is
 * enabled comes from `LegalMoves`. The reasons only explain a disabled button
 * (it is not your turn, you lack these cards...), they never enable one.
 */
export type BuildKind = 'road' | 'settlement' | 'city';

export type Mode = { kind: 'none' } | { kind: 'build'; piece: BuildKind } | { kind: 'capture' };
export const NO_MODE: Mode = { kind: 'none' };

export type Reason =
  | { code: 'notYourTurn' }
  | { code: 'phase'; phase: Phase }
  | { code: 'missing'; missing: Hand }
  | { code: 'noSpot' }
  | { code: 'deckEmpty' };

export interface Control {
  enabled: boolean;
  reason: Reason | null;
}

export interface Hint {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface Intent {
  /** what the board highlights */
  target: BoardTarget;
  /** the action a tap on `pick` asks for */
  action: (pick: Pick) => Action | null;
  /** the hint to show while choosing */
  hint: Hint;
}

export interface GameControls {
  me: PlayerViewLike;
  myTurn: boolean;
  phase: Phase;
  hint: Hint;
  roll: Control;
  endTurn: Control;
  build: Record<BuildKind, Control>;
  buyDevCard: Control;
  trade: Control;
  /** offers from other players that are open now (to mark the trade button) */
  openOffers: number;
  /** null when this player's role has no capture ability */
  capture: Control | null;
  /** a sheet the game forces open: this player must discard, or choose whom to steal from */
  forced: 'discard' | 'steal' | null;
  intent: Intent | null;
}

const on: Control = { enabled: true, reason: null };
const off = (reason: Reason): Control => ({ enabled: false, reason });

/** The cards still missing to pay `cost`. */
export function missingFor(hand: Hand, cost: Hand): Hand {
  const m = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 } as Hand;
  for (const r of RESOURCES) m[r] = Math.max(0, cost[r] - hand[r]);
  return m;
}
const hasAny = (h: Hand) => RESOURCES.some((r) => h[r] > 0);

export function controlsFor(view: GameView, legal: LegalMoves, mode: Mode = NO_MODE): GameControls {
  const me = view.players.find((p) => p.id === view.me)!;
  const myTurn = view.current === view.me;
  const phase = view.phase;
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const hand = me.hand!;

  /** why a move that needs `phase === main` and the player's turn is unavailable */
  const gate = (): Reason | null => (!myTurn ? { code: 'notYourTurn' } : phase !== 'main' ? { code: 'phase', phase } : null);

  const buildControl = (piece: BuildKind, enabledByLegal: boolean): Control => {
    if (enabledByLegal) return on;
    const g = gate();
    if (g) return off(g);
    const missing = missingFor(hand, view.mine!.costs[piece]);
    return off(hasAny(missing) ? { code: 'missing', missing } : { code: 'noSpot' });
  };

  const buyDev: Control = (() => {
    if (legal.canBuyDevCard) return on;
    const g = gate();
    if (g) return off(g);
    if (view.devDeckCount === 0) return off({ code: 'deckEmpty' });
    const missing = missingFor(hand, view.mine!.costs.devCard);
    return off(hasAny(missing) ? { code: 'missing', missing } : { code: 'noSpot' });
  })();

  const build: Record<BuildKind, Control> = {
    road: buildControl('road', legal.roads.length > 0),
    settlement: buildControl('settlement', legal.settlements.length > 0),
    city: buildControl('city', legal.cities.length > 0),
  };

  const rolesActions = ROLES[me.role]?.actions ?? {};
  const capture: Control | null = 'capture' in rolesActions ? (legal.roleActions.length > 0 ? on : off(gate() ?? { code: 'noSpot' })) : null;

  const forced: GameControls['forced'] = phase === 'discard' && legal.mustDiscard > 0 ? 'discard' : phase === 'steal' && myTurn && legal.stealVictims.length > 0 ? 'steal' : null;

  /* ---- what the board asks for ---- */
  let intent: Intent | null = null;
  if (myTurn && phase === 'setup' && view.setup) {
    intent =
      view.setup.step === 'settlement'
        ? { target: { kind: 'vertex', ids: legal.settlements }, action: (p) => (p.kind === 'vertex' ? { type: 'placeSettlement', vertex: p.id } : null), hint: { key: 'game.hint.setup.settlement' } }
        : { target: { kind: 'edge', ids: legal.roads }, action: (p) => (p.kind === 'edge' ? { type: 'placeRoad', edge: p.id } : null), hint: { key: 'game.hint.setup.road' } };
  } else if (myTurn && phase === 'roadBuilding') {
    intent = {
      target: { kind: 'edge', ids: legal.roads },
      action: (p) => (p.kind === 'edge' ? { type: 'placeRoad', edge: p.id } : null),
      hint: { key: 'game.hint.roadBuilding', params: { n: view.roadBuildingLeft } },
    };
  } else if (myTurn && phase === 'robber') {
    intent = { target: { kind: 'tile', ids: legal.robberTiles }, action: (p) => (p.kind === 'tile' ? { type: 'moveRobber', tile: p.id } : null), hint: { key: 'game.hint.robber' } };
  } else if (myTurn && phase === 'main' && mode.kind === 'build') {
    if (mode.piece === 'road') intent = { target: { kind: 'edge', ids: legal.roads }, action: (p) => (p.kind === 'edge' ? { type: 'placeRoad', edge: p.id } : null), hint: { key: 'game.hint.place' } };
    if (mode.piece === 'settlement') intent = { target: { kind: 'vertex', ids: legal.settlements }, action: (p) => (p.kind === 'vertex' ? { type: 'placeSettlement', vertex: p.id } : null), hint: { key: 'game.hint.place' } };
    if (mode.piece === 'city') intent = { target: { kind: 'vertex', ids: legal.cities }, action: (p) => (p.kind === 'vertex' ? { type: 'upgradeCity', vertex: p.id } : null), hint: { key: 'game.hint.place' } };
  } else if (myTurn && phase === 'main' && mode.kind === 'capture' && capture) {
    intent = {
      target: { kind: 'piece', pieces: capturePieces(view, legal) },
      action: (p) => (p.kind === 'vertex' || p.kind === 'edge' || p.kind === 'tile' ? null : captureAction(p.kind, p.id)),
      hint: { key: 'game.capture.hint' },
    };
  }

  /* ---- the line that says what is going on ---- */
  const hint: Hint = (() => {
    if (phase === 'finished') return { key: 'game.hint.finished' };
    if (phase === 'discard') {
      if (legal.mustDiscard > 0) return { key: 'game.hint.discard', params: { n: legal.mustDiscard } };
      return { key: 'game.hint.waitDiscard', params: { players: Object.keys(view.pendingDiscards).map(name).join(', ') } };
    }
    if (!myTurn) return { key: 'game.hint.waiting', params: { player: name(view.current) } };
    if (intent) return intent.hint;
    if (phase === 'steal') return { key: 'game.hint.steal' };
    if (phase === 'roll') return { key: 'game.hint.roll' };
    return { key: 'game.hint.main' };
  })();

  return {
    me,
    myTurn,
    phase,
    hint,
    roll: legal.canRoll ? on : off(gate() ?? (myTurn && phase !== 'roll' ? { code: 'phase', phase } : { code: 'notYourTurn' })),
    endTurn: legal.canEndTurn ? on : off(!myTurn ? { code: 'notYourTurn' } : { code: 'phase', phase }),
    build,
    buyDevCard: buyDev,
    // anyone may open the trade sheet during the main phase: a rival's open offer is answered there
    openOffers: view.offers.filter((o) => o.from !== view.me).length,
    trade: phase === 'main' ? on : off({ code: 'phase', phase }),
    capture,
    forced,
    intent,
  };
}

/* ---------------- capture (a role action; the targets are the rivals' pieces) ---------------- */

export const captureAction = (kind: PieceKind, id: number): Action => ({ type: 'roleAction', name: 'capture', params: { kind, id } });

/** Every rival piece, marked valid when the server lists capturing it as legal right now. */
export function capturePieces(view: GameView, legal: LegalMoves): { kind: PieceKind; id: number; valid: boolean }[] {
  const valid = new Set(
    legal.roleActions
      .filter((a): a is Extract<Action, { type: 'roleAction' }> => a.type === 'roleAction' && a.name === 'capture')
      .map((a) => `${a.params?.kind}:${a.params?.id}`),
  );
  const out: { kind: PieceKind; id: number; valid: boolean }[] = [];
  for (const [id, b] of Object.entries(view.buildings)) if (b.owner !== view.me) out.push({ kind: b.kind, id: Number(id), valid: valid.has(`${b.kind}:${id}`) });
  for (const [id, owner] of Object.entries(view.roads)) if (owner !== view.me) out.push({ kind: 'road', id: Number(id), valid: valid.has(`road:${id}`) });
  return out;
}

/** Which resource cards can still be discarded: what the player holds. */
export const holdings = (hand: Hand) => RESOURCES.filter((r) => hand[r] > 0);

/** Total of a hand. */
export const countHand = (h: Partial<Hand>) => RESOURCES.reduce((n, r) => n + (h[r] ?? 0), 0);

export { canAfford };
