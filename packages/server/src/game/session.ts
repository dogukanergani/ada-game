import {
  RESOURCES, applyAction, createGame, tickTimers, dealTestHands, eventsFor, longestRoadFor, publicPoints, roleOf, validate,
  type Action, type GameEvent, type GameMode, type Hand, type Rng,
} from '@ada/game-core';
import type { PreviewResult } from '@ada/protocol';
import { fail, isActive, seatOf, type Room } from '../rooms/room';
import { commitStart, planStart } from '../rooms/lobby';

/**
 * The only place that joins rooms to the rule engine, and it uses nothing but
 * `createGame`, `applyAction` and the types. Rule checks stay in game-core.
 */
type Done = { ok: true; events: GameEvent[] } | ReturnType<typeof fail>;

/** Starts the game of a lobby; only the host may. */
export function startGame(room: Room, playerId: string, rng: Rng, now: number, testVp: number | null = null, testResources: number | null = null): Done {
  const plan = planStart(room, playerId, rng);
  if (!plan.ok) return plan;
  const created = createGame(
    {
      players: plan.players,
      mode: room.mode as GameMode,
      ...(room.mode === 'custom' ? { targetScore: room.targetScore } : {}),
      timer: room.timer,
    },
    rng,
    now,
  );
  if (!created.ok) return fail('game', { error: created.error });
  if (testVp !== null) created.state.vpToWin = testVp;
  if (testResources !== null) dealTestHands(created.state, testResources);
  commitStart(room, plan.players);
  room.game = created.state;
  return { ok: true, events: [] };
}

/** Runs one player's action on the room's game. */
export function playAction(room: Room, playerId: string, action: Action, rng: Rng, now: number): Done {
  const seat = seatOf(room, playerId);
  if (!seat || !isActive(seat)) return fail('notInRoom');
  if (room.phase !== 'playing' || !room.game) return fail('notInGame');
  const result = applyAction(room.game, playerId, action, rng, now);
  if (!result.ok) return fail('game', { error: result.error });
  room.game = result.state;
  if (result.state.phase === 'finished') room.phase = 'finished';
  return { ok: true, events: result.events };
}

/**
 * Asks a timed game whether a limit has run out (see `tickTimers`). Returns the events when something happened: a turn ended on its
 * own or the game ended. An untimed room, or one not playing, is left alone.
 */
export function tickGame(room: Room, rng: Rng, now: number): Done {
  if (room.phase !== 'playing' || !room.game?.timer) return { ok: true, events: [] };
  const result = tickTimers(room.game, rng, now);
  if (!result.ok) return fail('game', { error: result.error });
  room.game = result.state;
  if (result.state.phase === 'finished') room.phase = 'finished';
  return { ok: true, events: result.events };
}

/**
 * Actions whose preview may show everything it would do. All of them are
 * deterministic and involve nothing another player is hiding. Everything else
 * (the dice, buying a card, stealing, moving the robber onto a lone victim,
 * monopoly, accepting a trade that may carry a random bonus, a role action that
 * declares itself random, ...) is answered with the verdict and the cost only.
 */
const FULL_PREVIEW: ReadonlySet<Action['type']> = new Set([
  'placeSettlement', 'placeRoad', 'upgradeCity', 'bankTrade', 'offerTrade', 'cancelTrade', 'endTurn', 'discard',
  'playKnight', 'playRoadBuilding', 'playYearOfPlenty', 'roleAction',
]);

const flatRng: Rng = () => 0.5;
const zero = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });

/**
 * What an action would do for this player, without doing it: the state is not
 * touched (the core copies it) and the game's rng is not used (a fixed stand-in
 * is, and for restricted actions its outcome is thrown away).
 */
export function previewAction(room: Room, playerId: string, action: Action): { ok: true; preview: PreviewResult } | ReturnType<typeof fail> {
  const seat = seatOf(room, playerId);
  if (!seat || !isActive(seat)) return fail('notInRoom');
  if (room.phase !== 'playing' || !room.game) return fail('notInGame');
  const refused = validate(room.game, playerId, action);
  if (refused) return fail('game', { error: refused });
  const result = applyAction(room.game, playerId, action, flatRng);
  if (!result.ok) return fail('game', { error: result.error });

  const before = room.game.players.find((p) => p.id === playerId)!.hand;
  const after = result.state.players.find((p) => p.id === playerId)!.hand;
  const cost = zero();
  const gain = zero();
  for (const r of RESOURCES) {
    cost[r] = Math.max(0, before[r] - after[r]);
    gain[r] = Math.max(0, after[r] - before[r]);
  }
  const roleAction = action.type === 'roleAction' ? roleOf(room.game, playerId).actions?.[action.name] : undefined;
  if (!FULL_PREVIEW.has(action.type) || roleAction?.random) return { ok: true, preview: { restricted: true, cost } };

  const points: Record<string, { before: number; after: number }> = {};
  for (const p of room.game.players) points[p.id] = { before: publicPoints(room.game, p.id), after: publicPoints(result.state, p.id) };
  const roadLengths: Record<string, { before: number; after: number }> = {};
  for (const p of room.game.players) roadLengths[p.id] = { before: longestRoadFor(room.game, p.id), after: longestRoadFor(result.state, p.id) };
  return {
    ok: true,
    preview: {
      restricted: false,
      cost,
      gain,
      points,
      events: eventsFor(result.events, playerId),
      longestRoad: { before: { ...room.game.longestRoad }, after: { ...result.state.longestRoad } },
      roadLengths,
    },
  };
}
