import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { GameView } from '@ada/game-core';
import { NO_MODE, blockMoment, blockedNow } from '../src/game/controls';
import { noticesFor, noticesOn, surfaceShows, titleFor, type Surface } from '../src/game/notices';
import { I18nProvider } from '../src/i18n/context';
import { TradeSheet } from '../src/screens/sheets/TradeSheet';
import { NoticeBar, NoticeSlotProvider } from '../src/ui/NoticeBar';
import { Sheet } from '../src/ui/Sheet';
import { reach } from './fixtures';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});
const render = (el: React.ReactElement) => renderToStaticMarkup(<I18nProvider>{el}</I18nProvider>);
const noop = () => {};

const m = reach((s) => s.phase === 'main' && s.turn > 10, { n: 3, seeds: 100 });
const mover = m.state.current;
const rival = m.state.players.find((p) => p.id !== mover)!.id;
const zero = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
const offer = { id: 7, from: mover, give: { ...zero, lumber: 1 }, want: { ...zero, brick: 1 } };
const withOffer = (view: GameView): GameView => ({ ...view, offers: [offer] });
const theirs = withOffer(m.of(rival).view);
const mine = withOffer(m.of(mover).view);

const surface = (over: Partial<Surface> = {}): Surface => ({ sheet: null, tradeTab: 'bank', ...over });

describe('notices are derived from the view', () => {
  it('an open offer from another player is a notice for the others, never for the one who made it', () => {
    expect(noticesFor(theirs)).toEqual([{ key: 'offer:7', kind: 'offer', from: mover, offerId: 7 }]);
    expect(noticesFor(mine)).toEqual([]);
    expect(noticesFor(m.of(rival).view)).toEqual([]);
  });

  it('are shown on every surface, except one that already shows the notice itself (the trade sheet on the players tab)', () => {
    for (const sheet of [null, 'cards', 'costs', 'log'] as const) expect(noticesOn(theirs, surface({ sheet }))).toHaveLength(1);
    expect(noticesOn(theirs, surface({ sheet: 'trade', tradeTab: 'bank' }))).toHaveLength(1);
    expect(noticesOn(theirs, surface({ sheet: 'trade', tradeTab: 'players' }))).toHaveLength(0);
    expect(surfaceShows(noticesFor(theirs)[0], surface({ sheet: 'trade', tradeTab: 'players' }))).toBe(true);
  });

  it('put a count in front of the tab title while something waits', () => {
    expect(titleFor(theirs)).toBe('(1) Ada');
    expect(titleFor(mine)).toBe('Ada');
    expect(titleFor(null)).toBe('Ada');
  });
});

describe('the notice bar', () => {
  it('shows who made the offer and one button to open it', () => {
    const html = render(<NoticeBar view={theirs} surface={surface()} onOpen={noop} />);
    expect(html).toContain('class="offer-banner"');
    expect(html).toContain('data-offer="7"');
    expect(html).toContain('made an offer');
  });
  it('is empty when there is nothing to say', () => {
    expect(render(<NoticeBar view={mine} surface={surface()} onOpen={noop} />)).not.toContain('offer-banner');
  });
});

describe('a sheet never hides a notice', () => {
  const bar = <NoticeBar view={theirs} surface={surface({ sheet: 'trade', tradeTab: 'bank' })} onOpen={noop} />;
  const legal = m.of(rival).legal;

  it('the trade sheet on the bank tab carries the bar', () => {
    const html = render(
      <NoticeSlotProvider value={bar}>
        <TradeSheet view={theirs} legal={legal} onClose={noop} send={async () => true} tab="bank" onTab={noop} />
      </NoticeSlotProvider>,
    );
    expect(html).toContain('offer-banner');
  });

  it('every closable sheet carries it; a sheet the game forces open does not', () => {
    const closable = render(
      <NoticeSlotProvider value={bar}>
        <Sheet title="x" onClose={noop}>
          body
        </Sheet>
      </NoticeSlotProvider>,
    );
    expect(closable).toContain('offer-banner');
    const forced = render(
      <NoticeSlotProvider value={bar}>
        <Sheet title="x">body</Sheet>
      </NoticeSlotProvider>,
    );
    expect(forced).not.toContain('offer-banner');
  });
});

describe('the line that explains a button that was off (bug b)', () => {
  const note = { text: 'Not your turn.', at: blockMoment('4:main:p1', NO_MODE) };

  it('shows in the moment it was asked in', () => {
    expect(blockedNow(note, blockMoment('4:main:p1', NO_MODE))).toBe('Not your turn.');
  });

  it('is gone when the turn, the phase, the mover or the mode changes', () => {
    expect(blockedNow(note, blockMoment('5:roll:p0', NO_MODE))).toBeNull(); // the turn came round
    expect(blockedNow(note, blockMoment('4:roll:p1', NO_MODE))).toBeNull(); // the phase changed
    expect(blockedNow(note, blockMoment('4:main:p0', NO_MODE))).toBeNull(); // the mover changed
    expect(blockedNow(note, blockMoment('4:main:p1', { kind: 'build', piece: 'road' }))).toBeNull(); // another mode
    expect(blockedNow(null, 'x')).toBeNull();
  });
});
