import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEV_DECK_SIZE, viewFor, BASE_COSTS, DEMOLISH_COSTS, DEV_CARD_COST, DEV_DECK_COMPOSITION, DEV_CARD_KINDS, RESOURCES, ROLE_LIST } from '@ada/game-core';
import { I18nProvider } from '../src/i18n/context';
import { dictionaries, translate } from '../src/i18n';
import { createStorage, forgetIdentity } from '../src/net/storage';
import { DeckInfoButton, DeckInfoSheet } from '../src/ui/DeckInfo';
import { HeaderButtons } from '../src/ui/HeaderButtons';
import { CostsSheet } from '../src/screens/sheets/InfoSheets';
import { RulesSheet } from '../src/screens/sheets/RulesSheet';
import { newGame, reach } from './fixtures';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});

const en = dictionaries.en;
const render = (el: React.ReactElement) => renderToStaticMarkup(<I18nProvider>{el}</I18nProvider>);
const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('RulesSheet', () => {
  let html = '';
  let text = '';
  beforeAll(() => {
    html = render(<RulesSheet onClose={() => undefined} />);
    text = strip(html);
  });

  it('tells the game loop, every role and card from the existing texts, the scoring and the base costs', () => {
    for (const k of ['rules.loop.setup', 'rules.loop.main', 'rules.cards.limit', 'rules.costs.base'] as const) expect(text).toContain(en[k]);
    for (const r of ROLE_LIST) {
      expect(text).toContain(en[`role.${r.id}.name` as keyof typeof en]);
      expect(text).toContain(en[`role.${r.id}.desc` as keyof typeof en]);
    }
    for (const k of DEV_CARD_KINDS) {
      expect(text).toContain(en[`devCard.${k}`]);
      expect(text).toContain(en[`devCardDesc.${k}`]);
      expect(text).toContain(translate('en', 'rules.cards.count', { n: DEV_DECK_COMPOSITION[k] }));
    }
    expect((html.match(/data-cost="[a-zA-Z]+"/g) ?? []).length).toBe(4); // the base rows; the demolition rows are tagged action:kind
    expect(html).toContain('data-rules="score"');
    // the base costs come from the core data, not a copy
    expect(BASE_COSTS.city.ore).toBe(3);
    expect(DEV_CARD_COST.ore).toBe(1);
    expect(text).toContain(`3 ${en['resource.ore']}`);
  });

  it('shows what a role demolition costs, from the core table', () => {
    expect(html).toContain('data-action-costs="demolish"');
    for (const kind of ['road', 'settlement', 'city'] as const) expect(html).toContain(`data-cost="demolish:${kind}"`);
    expect(DEMOLISH_COSTS.city.ore).toBe(3);
  });

  it('has no leftover placeholder', () => {
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).not.toContain('undefined');
  });

  it('knows nothing of any game: the same markup next to different games, and nothing a rival holds', () => {
    // it takes no game state, so what a game looks like cannot change it
    expect(render(<RulesSheet onClose={() => undefined} />)).toBe(html);
    const rich = reach((s) => s.players.every((p) => RESOURCES.reduce((n, r) => n + p.hand[r], 0) >= 4) && s.devDeck.length < 25);
    const other = newGame(3);
    const marks = new Set<string>();
    for (const s of [rich.state, other]) {
      for (const p of s.players) marks.add(p.name);
      for (const c of s.devDeck.slice(0, 5)) marks.add(`>${c}<`);
    }
    for (const m of marks) expect(html, m).not.toContain(m);
    expect(html).not.toMatch(/data-resource=|hand-chip|devDeck|handCount/);
  });
});

describe('how the game ends', () => {
  it('says both targets on the home screen, and the real one when opened from a game', () => {
    expect(strip(render(<RulesSheet onClose={() => undefined} />))).toContain(translate('en', 'rules.score.winBoth', { standard: 10, short: 7 }));
    const short = strip(render(<RulesSheet onClose={() => undefined} vpToWin={7} />));
    expect(short).toContain(translate('en', 'rules.score.win', { vp: 7 }));
    expect(short).not.toContain(translate('en', 'rules.score.winBoth', { standard: 10, short: 7 }));
    expect(strip(render(<RulesSheet onClose={() => undefined} vpToWin={3} />))).toContain(translate('en', 'rules.score.win', { vp: 3 }));
  });
});

describe('CostsSheet for a role with a priced action', () => {
  const s = newGame(3); // p0 Soldier, p1 Sage, p2 Sailor
  const sheet = (pid: string) => render(<CostsSheet view={viewFor(s, pid)} onClose={() => undefined} />);

  it('lists the demolition prices of the Soldier next to the build costs, exactly as the core pays them', () => {
    const html = sheet('p0');
    expect((html.match(/data-cost="/g) ?? []).length).toBe(4 + 3);
    for (const kind of ['road', 'settlement', 'city'] as const) {
      const row = html.match(new RegExp(`<tr data-cost="demolish:${kind}">(.*?)</tr>`))![1];
      for (const r of RESOURCES) {
        const n = DEMOLISH_COSTS[kind][r];
        expect(row.includes(`> ${n} ${en[`resource.${r}`]}<`), `${kind} ${r}`).toBe(n > 0);
      }
    }
    expect(strip(html)).toContain(en['costs.action.demolish']);
  });

  it('shows nothing extra to roles without one', () => {
    for (const pid of ['p1', 'p2']) expect(sheet(pid)).not.toContain('data-action-costs');
  });
});

describe('the header buttons', () => {
  it('are two reachable buttons, and both go off (with the reason) while the game forces a sheet open', () => {
    const free = render(<HeaderButtons />);
    expect(free).toContain('data-action="settings"');
    expect(free).toContain('data-action="rules"');
    expect(free).not.toContain('aria-disabled="true"');
    const duty = render(<HeaderButtons locked />);
    expect((duty.match(/aria-disabled="true"/g) ?? []).length).toBe(2);
    expect(duty).toContain(en['sheet.lockedByDuty']);
    // and they open nothing: no dialog is rendered over the duty
    expect(duty).not.toContain('role="dialog"');
  });
});

describe('forgetting the identity', () => {
  it('clears the token and the name, keeps the language', () => {
    const data = new Map<string, string>();
    const store = createStorage(() => ({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    }));
    store.set('token', 'abc');
    store.set('name', 'Ada');
    store.set('locale', 'tr');
    forgetIdentity(store);
    expect(store.get('token')).toBeNull();
    expect(store.get('name')).toBeNull();
    expect(store.get('locale')).toBe('tr');
  });
});

describe('the development deck info', () => {
  it('tells the mix of the whole deck and how many are left, and nothing about what comes next', () => {
    const text = strip(render(<DeckInfoSheet left={17} onClose={() => undefined} />));
    expect(text).toContain('25 cards: 14 Knight, 5 Victory point, 2 Road building, 2 Year of plenty, 2 Monopoly.');
    expect(text).toContain(translate('en', 'dev.deck', { n: 17 }));
    expect(DEV_DECK_SIZE).toBe(25);
  });
  it('is one button beside the buy button, closed until tapped', () => {
    const html = render(<DeckInfoButton left={25} />);
    expect(html).toContain('data-action="deck-info"');
    expect(html).toContain(en['deck.info.open']);
    expect(html).not.toContain('role="dialog"');
  });
});
