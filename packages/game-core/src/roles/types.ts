import type { GameError } from '../events';
import type { Ctx, ValidateOpts } from '../state';
import type { GameState, Hand, PieceKind, Resource, RoleId, Rng } from '../types';

/**
 * An active ability of a role. The core never looks at which role it is; it
 * routes `{type:'roleAction', name}` to the acting player's own role.
 */
export interface RoleActionDef {
  /** what the action costs, by the kind it targets (public; the view lists it next to the build costs). The one table `check` and `apply` also read. */
  costs?: Record<string, Hand>;
  /** true when the outcome involves chance or other players' hidden cards; the server's preview then shows only the verdict and cost */
  random?: boolean;
  /** null when legal. Must check phase, turn, cost, limits: everything. */
  check(s: GameState, pid: string, params: Record<string, unknown>, opts: ValidateOpts): GameError | null;
  /** every legal parameter set right now (built from `check`) */
  list(s: GameState, pid: string, opts?: ValidateOpts): Record<string, unknown>[];
  /** called only after `check` passed; mutates ctx.s and pushes events */
  apply(ctx: Ctx, pid: string, params: Record<string, unknown>): void;
}

/**
 * Roles plug into the rules through small optional hooks. Core rules call a
 * hook at a well-defined moment and use its answer; they never test for a
 * specific role. Role names and descriptions live in the translation files.
 */
export interface RoleDef {
  id: RoleId;
  actions?: Record<string, RoleActionDef>;
  /** cost of a road, settlement or city for this player */
  cost?(piece: PieceKind, base: Hand): Hand;
  /** cost of a development card */
  devCardCost?(base: Hand): Hand;
  /** bank ratio when giving `resource`, given the best ratio from ports (core floors the result) */
  bankRatio?(ratio: number, resource: Resource): number;
  /** hand size above which the player discards on a 7 (default 7) */
  discardLimit?: number;
  /** extra resources after a dice production; `gains` is what the player already got; `matched` is whether the roll hit any of their buildings (robber and bank shortage still count as a hit). Clamped by bank stock. */
  onProduce?(c: {
    gains: Hand;
    matched: boolean;
    roll: number;
    bank: Hand;
    rng: Rng;
    /** the player's hand after this roll's production */
    hand: Hand;
    /** whose dice these are, and whose hook this is */
    roller: string;
    self: string;
  }): Partial<Hand> | void;
  /**
   * The role owner's trade offer was accepted. May return bank resources and
   * name a per-turn counter to bump (the hook itself reads `counters` to limit use).
   * `reciprocal` is true when both sides of the offer gave something; a one-sided offer (a gift) is false.
   */
  onTradeAccepted?(c: { counters: Record<string, number>; bank: Hand; rng: Rng; reciprocal: boolean }): { gains?: Partial<Hand>; counter?: string } | void;
}
