import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RESOURCES, canAfford, type GameState } from '@ada/game-core';
import { NO_MODE, capturePieces, controlsFor, missingFor } from '../src/game/controls';
import { dictionaries } from '../src/i18n';
import { I18nProvider } from '../src/i18n/context';
import { DevCardsSheet } from '../src/screens/sheets/DevCardsSheet';
import { DiscardSheet, StealSheet } from '../src/screens/sheets/InfoSheets';
import { TradeSheet } from '../src/screens/sheets/TradeSheet';
import { ActionDock } from '../src/ui/ActionDock';
import { CapturePanel } from '../src/ui/CapturePanel';
import { HandBar } from '../src/ui/HandBar';
import { PlayerStrip } from '../src/ui/PlayerStrip';
import { reach } from './fixtures';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});
const en = dictionaries.en;
const render = (el: React.ReactElement) => renderToStaticMarkup(<I18nProvider>{el}</I18nProvider>);
const noop = () => {};
const asyncNoop = async () => true;

/** The opening tag of the button whose `data-action` is `id`. */
const tagOf = (html: string, id: string): string => {
  const m = new RegExp(`<button[^>]*data-action="${id}"[^>]*>`).exec(html);
  if (!m) throw new Error(`no button ${id}`);
  return m[0];
};
const dock = (c: ReturnType<typeof controlsFor>, extra: Partial<React.ComponentProps<typeof ActionDock>> = {}) =>
  render(<ActionDock controls={c} mode={NO_MODE} selection={null} busy={false} onRoll={noop} onEnd={noop} onBuyCard={noop} onMode={noop} onSheet={noop} onConfirm={noop} onCancel={noop} {...extra} />);

describe('controls: the setup', () => {
  const m = reach((s) => s.phase === 'setup' && s.setup!.step === 'settlement' && s.turn >= 0 && Object.keys(s.buildings).length === 1);
  const mover = m.state.current;
  const other = m.state.players.find((p) => p.id !== mover)!.id;

  it('asks the player to move for a corner, highlighted from the legal list, and turns everything else off', () => {
    const { view, legal } = m.of(mover);
    const c = controlsFor(view, legal);
    expect(c.intent?.target).toEqual({ kind: 'vertex', ids: legal.settlements });
    expect(c.intent!.target.kind === 'vertex' && c.intent!.target.ids.length).toBeGreaterThan(0);
    expect(c.hint.key).toBe('game.hint.setup.settlement');
    expect(c.intent!.action({ kind: 'vertex', id: legal.settlements[0] })).toEqual({ type: 'placeSettlement', vertex: legal.settlements[0] });
    expect(c.intent!.action({ kind: 'edge', id: 3 })).toBeNull();
    expect(c.roll.enabled).toBe(false);
    expect(c.build.road.enabled).toBe(false);
    expect(c.build.city.reason).toMatchObject({ code: 'phase', phase: 'setup' });
    expect(c.forced).toBeNull();
  });

  it('shows the others nothing to tap, and who is playing', () => {
    const { view, legal } = m.of(other);
    const c = controlsFor(view, legal);
    expect(c.intent).toBeNull();
    expect(c.myTurn).toBe(false);
    expect(c.hint.key).toBe('game.hint.waiting');
    expect(c.build.settlement.reason).toEqual({ code: 'notYourTurn' });
    expect(c.roll.reason).toEqual({ code: 'notYourTurn' });
  });
});

describe('controls: the dice', () => {
  const m = reach((s) => s.phase === 'roll' && s.turn > 3);
  it('the mover can roll, the others cannot, and nobody builds before the roll', () => {
    const mover = m.state.current;
    const c = controlsFor(m.of(mover).view, m.of(mover).legal);
    expect(c.roll).toEqual({ enabled: true, reason: null });
    expect(c.hint.key).toBe('game.hint.roll');
    expect(c.build.road.enabled).toBe(false);
    expect(c.endTurn.enabled).toBe(false);
    const other = m.state.players.find((p) => p.id !== mover)!.id;
    expect(controlsFor(m.of(other).view, m.of(other).legal).roll.enabled).toBe(false);
  });
});

describe('controls: the main phase', () => {
  const m = reach((s) => s.phase === 'main' && s.turn > 8);
  const mover = m.state.current;
  const { view, legal } = m.of(mover);
  const c = controlsFor(view, legal);

  it('a build button is on exactly when the server lists a legal place, and says what is missing when it is off', () => {
    for (const [piece, list] of [['road', legal.roads], ['settlement', legal.settlements], ['city', legal.cities]] as const) {
      expect(c.build[piece].enabled, piece).toBe(list.length > 0);
      if (!c.build[piece].enabled) {
        const hand = view.players.find((p) => p.id === view.me)!.hand!;
        const missing = missingFor(hand, view.mine!.costs[piece]);
        const lacks = RESOURCES.some((r) => missing[r] > 0);
        expect(c.build[piece].reason, piece).toEqual(lacks ? { code: 'missing', missing } : { code: 'noSpot' });
        // what is missing is exactly what the hand cannot pay
        expect(canAfford(hand, view.mine!.costs[piece])).toBe(!lacks);
      }
    }
    expect(c.buyDevCard.enabled).toBe(legal.canBuyDevCard);
    expect(c.endTurn.enabled).toBe(true);
    expect(c.trade.enabled).toBe(true);
  });

  it('entering a build mode asks the board for the matching places, and a tap names the action', () => {
    const road = controlsFor(view, legal, { kind: 'build', piece: 'road' });
    expect(road.intent?.target).toEqual({ kind: 'edge', ids: legal.roads });
    expect(road.intent!.action({ kind: 'edge', id: 5 })).toEqual({ type: 'placeRoad', edge: 5 });
    const city = controlsFor(view, legal, { kind: 'build', piece: 'city' });
    expect(city.intent?.target).toEqual({ kind: 'vertex', ids: legal.cities });
    expect(city.intent!.action({ kind: 'vertex', id: 2 })).toEqual({ type: 'upgradeCity', vertex: 2 });
    const settlement = controlsFor(view, legal, { kind: 'build', piece: 'settlement' });
    expect(settlement.intent!.action({ kind: 'vertex', id: 2 })).toEqual({ type: 'placeSettlement', vertex: 2 });
  });

  it('the dock renders each disabled button as disabled with its reason, and an enabled one as enabled', () => {
    const html = dock(c);
    for (const piece of ['road', 'settlement', 'city'] as const) {
      expect(tagOf(html, piece)).toContain(`aria-disabled="${!c.build[piece].enabled}"`);
    }
    expect(tagOf(html, 'end')).toContain('aria-disabled="false"');
    const off = (['road', 'settlement', 'city'] as const).find((p) => !c.build[p].enabled && c.build[p].reason?.code === 'missing');
    if (off) expect(html).toContain('action-sub');
  });

  it('a role with no ability has no capture button, and the others do not see one out of turn', () => {
    expect(controlsFor(view, legal).capture === null).toBe(view.players.find((p) => p.id === mover)!.role !== 'soldier');
  });
});

describe('controls: forced steps', () => {
  it('a 7 asks players over the limit to discard, and tells the others who they are waiting for', () => {
    const m = reach((s) => s.phase === 'discard', { n: 4, seeds: 200 });
    const must = Object.keys(m.state.pendingDiscards);
    const asked = controlsFor(m.of(must[0]).view, m.of(must[0]).legal);
    expect(asked.forced).toBe('discard');
    expect(asked.hint.key).toBe('game.hint.discard');
    const free = m.state.players.find((p) => !must.includes(p.id))!;
    const waiting = controlsFor(m.of(free.id).view, m.of(free.id).legal);
    expect(waiting.forced).toBeNull();
    expect(waiting.hint.key).toBe('game.hint.waitDiscard');
    // the dock offers no builds while a forced step is open
    expect(dock(asked)).not.toContain('data-action="road"');
  });

  it('the discard sheet keeps its button off until exactly the right number is chosen', () => {
    const m = reach((s) => s.phase === 'discard', { n: 4, seeds: 200 });
    const pid = Object.keys(m.state.pendingDiscards)[0];
    const { view, legal } = m.of(pid);
    const html = render(<DiscardSheet view={view} legal={legal} send={asyncNoop} />);
    expect(tagOf(html, 'discard')).toContain('aria-disabled="true"');
    expect(html).toContain(en['discard.body'].replace('{n}', String(legal.mustDiscard)));
    expect(html).not.toContain('Close'); // a forced sheet cannot be dismissed
  });

  it('the robber asks for a tile, then a victim', () => {
    const m = reach((s) => s.phase === 'robber', { n: 3, seeds: 200 });
    const mover = m.state.current;
    const c = controlsFor(m.of(mover).view, m.of(mover).legal);
    expect(c.intent?.target).toEqual({ kind: 'tile', ids: m.of(mover).legal.robberTiles });
    expect(c.intent!.action({ kind: 'tile', id: 4 })).toEqual({ type: 'moveRobber', tile: 4 });
    const s = reach((x) => x.phase === 'steal', { n: 4, seeds: 300 });
    const stealer = s.state.current;
    const { view, legal } = s.of(stealer);
    expect(controlsFor(view, legal).forced).toBe('steal');
    const html = render(<StealSheet view={view} legal={legal} send={asyncNoop} />);
    for (const id of legal.stealVictims) expect(html).toContain(`data-victim="${id}"`);
    // only card counts are shown for the victims
    expect(html).toMatch(/\d+ cards/);
  });
});

describe('capture', () => {
  const m = reach((s) => s.phase === 'main' && s.current === 'p0' && s.turn > 10 && Object.keys(s.buildings).length > 4);
  const { view, legal } = m.of('p0');

  it('only a role that has the ability sees the button', () => {
    // p0 is the soldier in these fixtures
    expect(view.players.find((p) => p.id === 'p0')!.role).toBe('soldier');
    expect(controlsFor(view, legal).capture).not.toBeNull();
    const other = m.of('p1');
    expect(controlsFor(other.view, other.legal).capture).toBeNull();
  });

  it('lists every rival piece as a target, valid exactly where the server lists the capture as legal', () => {
    const pieces = capturePieces(view, legal);
    expect(pieces.length).toBe(Object.values(view.buildings).filter((b) => b.owner !== 'p0').length + Object.values(view.roads).filter((o) => o !== 'p0').length);
    const legalKeys = new Set(legal.roleActions.map((a) => (a.type === 'roleAction' ? `${a.params?.kind}:${a.params?.id}` : '')));
    for (const p of pieces) expect(p.valid, `${p.kind} ${p.id}`).toBe(legalKeys.has(`${p.kind}:${p.id}`));
    expect(pieces.every((p) => view.buildings[p.id]?.owner !== 'p0' || p.kind === 'road')).toBe(true);
  });

  it('in capture mode the board offers those pieces and a tap becomes the role action', () => {
    const c = controlsFor(view, legal, { kind: 'capture' });
    expect(c.intent?.target.kind).toBe('piece');
    expect(c.intent!.action({ kind: 'city', id: 9 })).toEqual({ type: 'roleAction', name: 'capture', params: { kind: 'city', id: 9 } });
    expect(c.intent!.action({ kind: 'vertex', id: 9 })).toBeNull();
  });

  it('the panel shows the server\'s cost and point changes, or its reason', () => {
    const base = { view, picked: { kind: 'city' as const, id: 1 }, anyTargets: true };
    const ok = render(
      <CapturePanel
        {...base}
        state={{ status: 'ok', preview: { restricted: false, cost: { lumber: 0, brick: 0, wool: 3, grain: 3, ore: 5 }, points: { p0: { before: 2, after: 4 }, p1: { before: 3, after: 1 } }, events: [] } }}
      />,
    );
    expect(ok).toContain('3 grain');
    expect(ok).toContain('5 ore');
    expect(ok).toContain('Player0: 2 → 4 points');
    expect(ok).toContain('Player1: 3 → 1 points');
    const bad = render(<CapturePanel {...base} state={{ status: 'error', error: { key: 'game', error: { type: 'roleActionRefused', reason: 'protected' } } }} />);
    expect(bad).toContain(en['error.roleActionRefused.protected']);
    expect(render(<CapturePanel {...base} picked={null} state={{ status: 'idle' }} />)).toContain(en['capture.legendInvalid']);
    expect(render(<CapturePanel {...base} picked={null} anyTargets={false} state={{ status: 'idle' }} />)).toContain(en['capture.noTargets']);
  });
});

describe('development cards', () => {
  const m = reach((s) => s.phase === 'main' && s.players.some((p) => p.devCards.some((c) => c.kind === 'knight' && c.boughtTurn === s.turn) && p.id === s.current), { n: 3, seeds: 200 });
  const mover = m.state.current;

  it('a card bought this turn is shown with the reason it cannot be played yet', () => {
    const { view, legal } = m.of(mover);
    const html = render(<DevCardsSheet view={view} legal={legal} onClose={noop} onBuy={noop} send={asyncNoop} />);
    expect(html).toContain(en['dev.reason.bought']);
    expect(tagOf(html, 'play-knight')).toContain('aria-disabled="true"');
    expect(html).toContain(en['devCard.knight']);
  });

  it('victory point cards are listed but have no play button', () => {
    const v = reach((s) => s.players.some((p) => p.devCards.some((c) => c.kind === 'victoryPoint')), { n: 3, seeds: 200 });
    const owner = v.state.players.find((p) => p.devCards.some((c) => c.kind === 'victoryPoint'))!.id;
    const { view, legal } = v.of(owner);
    const html = render(<DevCardsSheet view={view} legal={legal} onClose={noop} onBuy={noop} send={asyncNoop} />);
    expect(html).toContain(en['devCard.victoryPoint']);
    expect(html).not.toContain('data-action="play-victoryPoint"');
    expect(html).toContain(en['dev.reason.victory']);
  });
});

describe('trading', () => {
  it('an open offer from a rival can be accepted only when the server says so, and says what is missing otherwise', () => {
    const m = reach((s) => s.phase === 'main' && s.offers.length === 0 && s.turn > 12 && s.players.every((p) => RESOURCES.some((r) => p.hand[r] > 0)), { n: 2 });
    const seller = m.state.current;
    const buyer = m.state.players.find((p) => p.id !== seller)!;
    // an offer that asks for more than the buyer holds
    const give = RESOURCES.find((r) => m.state.players.find((p) => p.id === seller)!.hand[r] > 0)!;
    const want = RESOURCES.find((r) => r !== give)!;
    const state: GameState = structuredClone(m.state);
    state.offers = [{ id: 1, from: seller, give: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, [give]: 1 }, want: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, [want]: 20 } }];
    const view = m.of(buyer.id).view;
    const v2 = { ...view, offers: state.offers };
    const html = render(<TradeSheet view={v2} legal={{ ...m.of(buyer.id).legal, acceptableOffers: [] }} onClose={noop} send={asyncNoop} />);
    // the bank tab is open first; the players tab shows the offer
    expect(html).toContain(en['trade.bank']);
    const players = render(<TradeSheetPlayers view={v2} legal={{ ...m.of(buyer.id).legal, acceptableOffers: [] }} />);
    expect(players).toContain('data-offer="1"');
    expect(players).toContain(en['trade.incomingFrom'].replace('{player}', seller === 'p0' ? 'Player0' : 'Player1'));
    expect(tagOf(players, 'accept')).toContain('aria-disabled="true"');
    expect(players).toContain('You cannot accept:');
  });
});

/** The trade sheet opened on its players tab (the sheet keeps the tab in state, so render it through a tiny wrapper that clicks nothing: the tab content is produced by the same component). */
function TradeSheetPlayers(props: { view: Parameters<typeof TradeSheet>[0]['view']; legal: Parameters<typeof TradeSheet>[0]['legal'] }) {
  return <TradeSheet {...props} onClose={noop} send={asyncNoop} initialTab="players" />;
}

describe('what a player can see of the others', () => {
  const m = reach((s) => s.phase === 'main' && s.turn > 12 && s.players.every((p) => p.hand.ore + p.hand.wool + p.hand.grain > 0));
  const { view } = m.of('p0');

  it('the strip shows rivals only as counts, and the hand bar only the player\'s own cards', () => {
    const html = render(<PlayerStrip view={view} connected={{}} />);
    for (const p of m.state.players.filter((x) => x.id !== 'p0')) {
      const total = RESOURCES.reduce((n, r) => n + p.hand[r], 0);
      expect(html).toContain(en['strip.cards'].replace('{n}', String(total)));
    }
    const bar = render(<HandBar view={view} onOpenCards={noop} />);
    expect(bar.match(/class="hand-chip"/g)).toHaveLength(5);
    const mine = m.state.players.find((p) => p.id === 'p0')!.hand;
    for (const r of RESOURCES) expect(bar).toMatch(new RegExp(`data-resource="${r}"[^>]*>.*?<span class="hand-n">${mine[r]}</span>`));
    // the view itself carries no rival hand
    for (const p of view.players.filter((x) => x.id !== 'p0')) {
      expect(p.hand).toBeNull();
      expect(p.devCards).toBeNull();
    }
  });

  it('shows who has dropped, in words, and marks a dropped player whose turn it is', () => {
    const other = m.state.players.find((p) => p.id !== 'p0')!.id;
    const html = render(<PlayerStrip view={view} connected={{ [other]: false }} />);
    expect(html).toContain(en['strip.offline']);
    expect(html).toContain('data-online="false"');
  });
});

describe('a player who dropped on their turn', () => {
  it('is named in a banner, in words, when it is not the viewer\'s turn', async () => {
    const { LastEvent } = await import('../src/ui/PlayerStrip');
    const m = reach((s) => s.phase === 'main' && s.turn > 8, { n: 3 });
    const mover = m.state.current;
    const viewer = m.state.players.find((p) => p.id !== mover)!.id;
    const { view } = m.of(viewer);
    const name = view.players.find((p) => p.id === mover)!.name;
    const html = render(<LastEvent view={view} log={[]} connected={{ [mover]: false }} />);
    expect(html).toContain(en['strip.waitingFor'].replace('{player}', name));
    expect(html).toContain('role="status"');
    // no banner when they are connected, nor when the dropped player is the viewer
    expect(render(<LastEvent view={view} log={[]} connected={{}} />)).not.toContain('waiting-banner');
    expect(render(<LastEvent view={view} log={[]} connected={{ [viewer]: false }} />)).not.toContain('waiting-banner');
  });
});
