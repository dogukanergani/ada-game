import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_CARD_KINDS, GAME_ERROR_TYPES, GAME_EVENT_TYPES, MODES, PIECE_LIMITS, RESOURCES, ROLE_LIST,
  type GameError, type GameEvent,
} from '@ada/game-core';
import { ERROR_KEYS } from '@ada/protocol';
import { LOCALES, detectLocale, dictionaries, fill, translate, type Locale, type MessageKey } from '../src/i18n';
import { describeError, describeGameError, formatEvent, handText } from '../src/i18n/format';

const keys = Object.keys(dictionaries.tr) as MessageKey[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the two dictionaries', () => {
  it('have exactly the same keys, no empty text (except the unknown-role description), and the same placeholders', () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      for (const l of LOCALES) {
        if (k !== 'role.unknown.desc') expect(dictionaries[l][k].trim(), `${l} ${k} is empty`).not.toBe('');
      }
      expect(placeholders(dictionaries.en[k]), `placeholders of ${k}`).toEqual(placeholders(dictionaries.tr[k]));
    }
  });
});

describe('translations cover everything the core and the server can say', () => {
  const has = (k: string) => Object.hasOwn(dictionaries.tr, k);

  it('every event type the core emits', () => {
    for (const type of GAME_EVENT_TYPES) {
      const ok = has(`event.${type}`) || keys.some((k) => k.startsWith(`event.${type}.`));
      expect(ok, `no message for event ${type}`).toBe(true);
    }
  });

  it('every error type the core returns', () => {
    for (const type of GAME_ERROR_TYPES) expect(has(`error.${type}`), `no message for error ${type}`).toBe(true);
  });

  it('every detail "reason" the core attaches to an error', () => {
    const dir = join(__dirname, '..', '..', 'game-core', 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(dir);
    const reasons = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/err\('\w+',\s*\{[^}]*reason:\s*'(\w+)'/g)) reasons.add(m[1]);
    expect(reasons.size).toBeGreaterThan(3);
    for (const r of reasons) expect(keys.some((k) => k.startsWith('error.') && k.endsWith(`.${r}`)), `no message for reason ${r}`).toBe(true);
  });

  it('every error key of the server', () => {
    for (const key of ERROR_KEYS) expect(has(`server.${key}`), `no message for server error ${key}`).toBe(true);
  });

  it('role names and descriptions for every role in the data', () => {
    for (const r of ROLE_LIST) {
      expect(has(`role.${r.id}.name`), r.id).toBe(true);
      expect(has(`role.${r.id}.desc`), r.id).toBe(true);
    }
  });

  it('resources, terrains, cards, pieces, modes and phases', () => {
    for (const r of RESOURCES) expect(has(`resource.${r}`) && has(`terrain.${r}`), r).toBe(true);
    expect(has('terrain.desert')).toBe(true);
    for (const k of DEV_CARD_KINDS) expect(has(`devCard.${k}`) && has(`devCardDesc.${k}`), k).toBe(true);
    for (const p of Object.keys(PIECE_LIMITS)) expect(has(`piece.${p}`), p).toBe(true);
    for (const m of Object.keys(MODES)) expect(has(`mode.${m}`), m).toBe(true);
    for (const ph of ['setup', 'roll', 'discard', 'robber', 'steal', 'roadBuilding', 'main', 'finished']) expect(has(`phase.${ph}`), ph).toBe(true);
  });
});

const hand = (h: Partial<Record<(typeof RESOURCES)[number], number>> = {}) => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...h });

/** One sample of every event, and of the variants that choose another message. Typed so a new event type forces a new sample. */
const samples: Record<GameEvent['type'], GameEvent[]> = {
  gameStarted: [{ type: 'gameStarted', mode: 'short', mapId: 'short14', order: ['a', 'b'] }],
  settlementBuilt: [{ type: 'settlementBuilt', player: 'a', vertex: 1, setup: false }],
  roadBuilt: [{ type: 'roadBuilt', player: 'a', edge: 1, free: false }, { type: 'roadBuilt', player: 'a', edge: 1, free: true }],
  cityBuilt: [{ type: 'cityBuilt', player: 'a', vertex: 1 }],
  setupResources: [{ type: 'setupResources', player: 'a', gains: hand({ ore: 1 }) }],
  diceRolled: [{ type: 'diceRolled', player: 'a', dice: [3, 4], total: 7, hitTiles: [], robbedTile: null }],
  produced: [{ type: 'produced', player: 'a', gains: hand({ wool: 2 }) }],
  productionBlocked: [
    { type: 'productionBlocked', resource: 'ore', reason: 'multiple' },
    { type: 'productionBlocked', resource: 'ore', reason: 'short' },
  ],
  roleBonus: [{ type: 'roleBonus', player: 'a', role: 'harvester', gains: hand({ ore: 1 }) }, { type: 'roleBonus', player: 'a', role: 'nonsense', gains: hand() }],
  discardRequired: [{ type: 'discardRequired', players: { a: 4, b: 5 } }],
  discarded: [{ type: 'discarded', player: 'a', count: 4 }],
  robberMoved: [{ type: 'robberMoved', player: 'a', tile: 5 }],
  stolen: [
    { type: 'stolen', thief: 'a', victim: 'b', resource: 'ore' },
    { type: 'stolen', thief: 'a', victim: 'b', resource: null },
    { type: 'stolen', thief: 'b', victim: 'c', resource: null },
  ],
  bankTraded: [{ type: 'bankTraded', player: 'a', give: 'ore', get: 'wool', ratio: 3 }],
  tradeOffered: [{ type: 'tradeOffered', offer: { id: 1, from: 'a', give: hand({ ore: 1 }), want: hand({ wool: 1 }) } }],
  tradeAccepted: [{ type: 'tradeAccepted', offerId: 1, from: 'a', to: 'b', give: hand({ ore: 1 }), want: hand({ wool: 1 }) }],
  tradeCancelled: [{ type: 'tradeCancelled', offerId: 1 }],
  devCardBought: [{ type: 'devCardBought', player: 'a', kind: 'knight' }, { type: 'devCardBought', player: 'b', kind: null }],
  devCardPlayed: [{ type: 'devCardPlayed', player: 'a', kind: 'monopoly' }],
  yearOfPlentyTaken: [{ type: 'yearOfPlentyTaken', player: 'a', gains: hand({ ore: 2 }) }],
  monopolyCollected: [{ type: 'monopolyCollected', player: 'a', resource: 'grain', count: 3 }],
  roadBuildingEnded: [{ type: 'roadBuildingEnded', player: 'a', unused: 1 }],
  longestRoadChanged: [{ type: 'longestRoadChanged', holder: 'a', length: 5 }, { type: 'longestRoadChanged', holder: null, length: 0 }],
  largestArmyChanged: [{ type: 'largestArmyChanged', holder: 'a', size: 3 }, { type: 'largestArmyChanged', holder: null, size: 0 }],
  demolished: [
    { type: 'demolished', player: 'a', from: 'b', kind: 'city', id: 3, cost: hand({ wool: 2, grain: 2, ore: 3 }) },
    { type: 'demolished', player: 'a', from: 'b', kind: 'settlement', id: 3, cost: hand({ wool: 1, grain: 1, ore: 2 }) },
    { type: 'demolished', player: 'a', from: 'b', kind: 'road', id: 3, cost: hand({ wool: 1, ore: 1 }) },
  ],
  turnEnded: [{ type: 'turnEnded', player: 'a' }],
  turnStarted: [{ type: 'turnStarted', player: 'a', turn: 4 }],
  gameWon: [{ type: 'gameWon', player: 'a', points: 10 }],
};

describe('formatEvent', () => {
  for (const locale of LOCALES) {
    it(`turns every event into a finished sentence in ${locale}`, () => {
      const t = (k: MessageKey, p?: Record<string, string | number>) => translate(locale, k, p);
      const name = (id: string) => ({ a: 'Ada', b: 'Bora', c: 'Cem' })[id] ?? id;
      for (const type of GAME_EVENT_TYPES) {
        expect(samples[type]?.length, `no sample for ${type}`).toBeGreaterThan(0);
        for (const e of samples[type]) {
          const s = formatEvent(e, { t, name, me: 'a' });
          expect(s.trim().length, JSON.stringify(e)).toBeGreaterThan(5);
          expect(s, `leftover placeholder in ${JSON.stringify(e)}`).not.toMatch(/\{\w+\}/);
          expect(s).not.toContain('undefined');
        }
      }
    });
  }

  it('shows a hidden steal differently to a bystander and to the people involved', () => {
    const t = (k: MessageKey, p?: Record<string, string | number>) => translate('en', k, p);
    const name = (id: string) => id.toUpperCase();
    const e: GameEvent = { type: 'stolen', thief: 'a', victim: 'b', resource: null };
    expect(formatEvent(e, { t, name, me: 'c' })).toBe('A stole 1 card from B.');
    expect(formatEvent(e, { t, name, me: 'a' })).toContain('no cards');
  });
});

describe('errors', () => {
  const sampleErrors: GameError[] = GAME_ERROR_TYPES.map((type) => ({ type, piece: 'road', phase: 'main', cost: hand({ ore: 2 }), reason: undefined }));

  it('every core error type reads as a sentence in both languages, with its detail filled in', () => {
    for (const l of LOCALES) {
      const t = (k: MessageKey, p?: Record<string, string | number>) => translate(l, k, p);
      for (const e of sampleErrors) {
        const s = describeGameError(t, e);
        expect(s, `${l} ${e.type}`).not.toMatch(/\{\w+\}/);
        expect(s.length).toBeGreaterThan(8);
      }
      expect(describeGameError(t, { type: 'cannotAfford', cost: hand({ ore: 2, wool: 1 }) })).toContain('2');
      expect(describeGameError(t, { type: 'roleActionRefused', reason: 'protected' })).not.toBe(describeGameError(t, { type: 'roleActionRefused' }));
    }
  });

  it('server errors, a wrapped game error, a timeout, and an unknown key all give a sentence', () => {
    const t = (k: MessageKey, p?: Record<string, string | number>) => translate('en', k, p);
    expect(describeError(t, { key: 'roomNotFound' })).toContain('no room');
    expect(describeError(t, { key: 'alreadyInRoom', code: 'KMTP' })).toContain('KMTP');
    expect(describeError(t, { key: 'game', error: { type: 'notYourTurn' } })).toContain('not your turn');
    expect(describeError(t, { key: 'internal', timeout: true })).toContain('did not answer');
    expect(describeError(t, { key: 'whatever' as never })).toContain('went wrong');
    expect(describeError(t, undefined)).toContain('went wrong');
    for (const key of ERROR_KEYS.filter((k) => k !== 'alreadyInRoom')) expect(describeError(t, { key }), key).not.toMatch(/\{\w+\}/);
  });
});

describe('helpers', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
  it('lists a hand, or a word for nothing', () => {
    const t = (k: MessageKey) => translate('en', k);
    expect(handText(t, hand({ ore: 2, wool: 1 }))).toBe('1 wool, 2 ore');
    expect(handText(t, hand())).toBe('nothing');
    expect(handText(t, null)).toBe('nothing');
  });
  it('picks the language: saved choice, then the browser, then English', () => {
    expect(detectLocale(['tr-TR', 'en'], null)).toBe('tr');
    expect(detectLocale(['de', 'en-GB'], null)).toBe('en');
    expect(detectLocale(['de'], null)).toBe('en');
    expect(detectLocale(undefined, null)).toBe('en');
    expect(detectLocale(['tr'], 'en')).toBe('en');
    expect(detectLocale(['en'], 'xx')).toBe('en');
    const l: Locale = detectLocale(['TR'], null);
    expect(l).toBe('tr');
  });
});
