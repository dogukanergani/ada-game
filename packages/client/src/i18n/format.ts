import { RESOURCES } from '@ada/game-core';
import type { GameError, GameEvent, Hand, ServerError } from '@ada/protocol';
import { hasKey, type MessageKey, type Params, type Translate } from './index';

/** "2 wood, 1 brick", or a word for nothing. */
export function handText(t: Translate, hand: Partial<Hand> | null | undefined): string {
  const parts = RESOURCES.filter((r) => (hand?.[r] ?? 0) > 0).map((r) => `${hand![r]} ${t(`resource.${r}`)}`);
  return parts.length ? parts.join(', ') : t('list.none');
}

export interface FormatContext {
  t: Translate;
  /** a player's display name from their id */
  name: (id: string) => string;
  /** the viewer's own id: decides how much of a censored event they may see */
  me: string;
}

const key = (k: string): MessageKey => {
  if (!hasKey(k)) throw new Error(`missing translation key: ${k}`);
  return k;
};

/** One event as a sentence. Every event type the core can emit has a message (test/i18n.test.ts). */
export function formatEvent(e: GameEvent, { t, name, me }: FormatContext): string {
  const resource = (r: string) => t(key(`resource.${r}`));
  switch (e.type) {
    case 'gameStarted':
      return t('event.gameStarted', { mode: t(key(`mode.${e.mode}`)), order: e.order.map(name).join(', ') });
    case 'settlementBuilt':
      return t('event.settlementBuilt', { player: name(e.player) });
    case 'roadBuilt':
      return t(e.free ? 'event.roadBuilt.free' : 'event.roadBuilt', { player: name(e.player) });
    case 'cityBuilt':
      return t('event.cityBuilt', { player: name(e.player) });
    case 'setupResources':
      return t('event.setupResources', { player: name(e.player), gains: handText(t, e.gains) });
    case 'diceRolled':
      return t('event.diceRolled', { player: name(e.player), d1: e.dice[0], d2: e.dice[1], total: e.total });
    case 'produced':
      return t('event.produced', { player: name(e.player), gains: handText(t, e.gains) });
    case 'productionBlocked':
      return t(e.reason === 'multiple' ? 'event.productionBlocked.multiple' : 'event.productionBlocked.short', { resource: resource(e.resource) });
    case 'roleBonus':
      return t('event.roleBonus', {
        player: name(e.player),
        role: hasKey(`role.${e.role}.name`) ? t(key(`role.${e.role}.name`)) : t('role.unknown.name'),
        gains: handText(t, e.gains),
      });
    case 'discardRequired':
      return t('event.discardRequired', { players: Object.entries(e.players).map(([id, n]) => `${name(id)} (${n})`).join(', ') });
    case 'discarded':
      return t('event.discarded', { player: name(e.player), count: e.count });
    case 'robberMoved':
      return t('event.robberMoved', { player: name(e.player), tile: e.tile });
    case 'stolen': {
      const base = { thief: name(e.thief), victim: name(e.victim) };
      if (e.resource) return t('event.stolen.known', { ...base, resource: resource(e.resource) });
      // a missing card is either "nothing to steal" (thief and victim know that) or hidden from everyone else
      return t(e.thief === me || e.victim === me ? 'event.stolen.nothing' : 'event.stolen.hidden', base);
    }
    case 'bankTraded':
      return t('event.bankTraded', { player: name(e.player), ratio: e.ratio, give: resource(e.give), get: resource(e.get) });
    case 'tradeOffered':
      return t('event.tradeOffered', { player: name(e.offer.from), give: handText(t, e.offer.give), want: handText(t, e.offer.want) });
    case 'tradeAccepted':
      return t('event.tradeAccepted', { from: name(e.from), to: name(e.to), give: handText(t, e.give), want: handText(t, e.want) });
    case 'tradeCancelled':
      return t('event.tradeCancelled');
    case 'devCardBought':
      return e.kind
        ? t('event.devCardBought.own', { player: name(e.player), kind: t(key(`devCard.${e.kind}`)) })
        : t('event.devCardBought.other', { player: name(e.player) });
    case 'devCardPlayed':
      return t('event.devCardPlayed', { player: name(e.player), kind: t(key(`devCard.${e.kind}`)) });
    case 'yearOfPlentyTaken':
      return t('event.yearOfPlentyTaken', { player: name(e.player), gains: handText(t, e.gains) });
    case 'monopolyCollected':
      return t('event.monopolyCollected', { player: name(e.player), count: e.count, resource: resource(e.resource) });
    case 'roadBuildingEnded':
      return t('event.roadBuildingEnded', { player: name(e.player), unused: e.unused });
    case 'longestRoadChanged':
      return e.holder ? t('event.longestRoadChanged.some', { holder: name(e.holder), length: e.length }) : t('event.longestRoadChanged.none');
    case 'largestArmyChanged':
      return e.holder ? t('event.largestArmyChanged.some', { holder: name(e.holder), size: e.size }) : t('event.largestArmyChanged.none');
    case 'captured':
      return t('event.captured', { player: name(e.player), from: name(e.from), kind: t(key(`piece.${e.kind}`)) });
    case 'turnEnded':
      return t('event.turnEnded', { player: name(e.player) });
    case 'turnStarted':
      return t('event.turnStarted', { player: name(e.player), turn: e.turn });
    case 'gameWon':
      return t('event.gameWon', { player: name(e.player), points: e.points });
  }
}

/** A refusal from the game core, with the detail that makes it useful. */
export function describeGameError(t: Translate, e: GameError): string {
  const params: Params = {};
  if (typeof e.piece === 'string' && hasKey(`piece.${e.piece}`)) params.piece = t(key(`piece.${e.piece}`));
  if (typeof e.phase === 'string' && hasKey(`phase.${e.phase}`)) params.phase = t(key(`phase.${e.phase}`));
  if (e.cost && typeof e.cost === 'object') params.cost = handText(t, e.cost as Hand);
  const reasoned = typeof e.reason === 'string' ? `error.${e.type}.${e.reason}` : '';
  if (reasoned && hasKey(reasoned)) return t(reasoned, params);
  const base = `error.${e.type}`;
  return hasKey(base) ? t(base, params) : t('server.game');
}

/** Any error the server returns, in the player's language. */
export function describeError(t: Translate, error: ServerError | undefined): string {
  if (!error) return t('server.internal');
  if (error.timeout === true) return t('net.timeout');
  if (error.key === 'game' && error.error) return describeGameError(t, error.error);
  const params: Params = {};
  if (typeof error.code === 'string') params.code = error.code;
  const k = `server.${error.key}`;
  return hasKey(k) ? t(k, params) : t('server.internal');
}
