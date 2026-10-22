import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RESOURCES } from '@ada/game-core';
import { NEUTRAL_EMBLEM, ROLE_EMBLEMS, emblemFor } from '../src/board/emblems';
import { dictionaries } from '../src/i18n';
import { I18nProvider } from '../src/i18n/context';
import { ROLES } from '../src/game/types';
import { Seats, seatOrder } from '../src/ui/Seats';
import { newGame } from './fixtures';
import { viewFor } from '@ada/game-core';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});
const en = dictionaries.en;
const render = (el: React.ReactElement) => renderToStaticMarkup(<I18nProvider>{el}</I18nProvider>);

describe('role emblems', () => {
  it('every role has a picture of its own, drawn as lines', () => {
    const ids = Object.keys(ROLES);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      expect(ROLE_EMBLEMS[id], `the role ${id} has no emblem`).toBeDefined();
      expect(emblemFor(id).paths.length).toBeGreaterThan(0);
    }
    const drawn = new Set(ids.map((id) => emblemFor(id).paths.join('|')));
    expect(drawn.size, 'two roles share a picture').toBe(ids.length);
  });

  it('a role without an emblem still gets one: the neutral ring (roles can be added as data)', () => {
    expect(emblemFor('some-new-role')).toBe(NEUTRAL_EMBLEM);
  });
});

describe('where the seats are', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`${n} players: from every viewer the table runs clockwise, the next seat first, the viewer last and alone`, () => {
      const state = newGame(n, 'short', 4);
      for (const viewer of state.players) {
        const view = viewFor(state, viewer.id);
        const { me, opponents } = seatOrder(view);
        expect(me.id).toBe(viewer.id);
        expect(opponents).toHaveLength(n - 1);
        const seats = opponents.map((p) => p.seat);
        // each seat is the one after the previous (round the table), starting right after the viewer's
        let expected = viewer.seat;
        for (const s of seats) {
          expected = (expected + 1) % n;
          expect(s).toBe(expected);
        }
      }
    });
  }
});

describe('what a seat shows', () => {
  const state = newGame(3, 'short', 6);
  // give the first rival cards the viewer must not learn the kinds of
  state.players.find((p) => p.id === 'p1')!.hand = { lumber: 3, brick: 0, wool: 2, grain: 0, ore: 1 };
  const view = viewFor(state, 'p0');

  it('a rival\'s seat carries the total number of cards and the number of development cards, and nothing that names a resource', () => {
    const html = render(<Seats view={view} connected={{}} which="opponents" />);
    expect(html).toContain(en['seat.cards'].replace('{n}', '6'));
    for (const r of RESOURCES) expect(html).not.toContain(en[`resource.${r}` as const]);
    expect(html).not.toContain('data-resource');
    expect(html).not.toMatch(/lumber|brick|wool|grain|ore/i);
  });

  it('the viewer\'s own seat is alone in its row and is marked as theirs', () => {
    const html = render(<Seats view={view} connected={{}} which="me" />);
    expect(html.match(/class="pseat"/g)).toHaveLength(1);
    expect(html).toContain('data-me="true"');
    expect(html).toContain('data-player="p0"');
  });

  it('the seat\'s spoken label has the name, the role, the points and the cards, and says whose move it is and who is offline', () => {
    const html = render(<Seats view={view} connected={{ p1: false }} which="opponents" />);
    const label = (id: string) => new RegExp(`data-player="${id}"[^>]*>.*?aria-label="([^"]*)"`).exec(html)![1];
    const mover = state.current;
    for (const p of state.players.filter((x) => x.id !== 'p0')) {
      const l = label(p.id);
      expect(l.startsWith(`${p.name}, `)).toBe(true);
      expect(l).toMatch(/\d+ points?, \d+ cards?/);
      expect(l.includes(en['seat.turn'])).toBe(p.id === mover);
      expect(l.includes(en['seat.offline'])).toBe(p.id === 'p1');
    }
  });
});
