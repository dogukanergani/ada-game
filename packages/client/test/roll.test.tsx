import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { GamePayload } from '@ada/protocol';
import { I18nProvider } from '../src/i18n/context';
import { ROLL_TIMING, TUMBLE_FACES, heldBack, heldTotal, rollMachine, visibleLog, type Run } from '../src/game/roll';
import { initialState, reducer, type AppState, type Msg, type RollRecord } from '../src/net/store';
import { DiceTray, Die } from '../src/ui/DiceTray';
import { Board } from '../src/board/Board';
import { HandBar } from '../src/ui/HandBar';
import { viewFor } from '@ada/game-core';
import { newGame } from './fixtures';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});

const roll = (over: Partial<RollRecord> = {}): RollRecord => ({
  seq: 1, dice: [3, 4], total: 7, hitTiles: [2], robbedTile: 9, logId: 5, gains: { a: { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 } }, ...over,
});
const view = (dice: [number, number] | null = null) => ({ me: 'a', phase: 'main', dice }) as never;
const payload = (events: GamePayload['events'], dice: [number, number] | null = [3, 4]): GamePayload => ({ view: view(dice), legal: { phase: 'main' } as never, events, clock: { elapsedMs: 0, running: true }, timerClock: null });
const run = (msgs: Msg[], from: AppState = initialState) => msgs.reduce(reducer, from);
const rolledEvents: GamePayload['events'] = [
  { type: 'diceRolled', player: 'a', dice: [3, 4], total: 7, hitTiles: [2], robbedTile: 9 },
  { type: 'produced', player: 'a', gains: { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 } },
  { type: 'roleBonus', player: 'a', role: 'harvester', gains: { lumber: 0, brick: 0, wool: 1, grain: 0, ore: 0 } },
];

const tray = (props: Parameters<typeof DiceTray>[0]) => renderToStaticMarkup(<I18nProvider><DiceTray {...props} /></I18nProvider>);

describe('the dice faces', () => {
  it('draw as many dots as the value, 1 to 6', () => {
    for (let v = 1; v <= 6; v++) expect(renderToStaticMarkup(<Die value={v} />).match(/<circle/g)).toHaveLength(v);
  });
});

describe('the dice at rest', () => {
  it('show the result faces, the total and the announcement', () => {
    const html = tray({ dice: [3, 4], stage: 'still' });
    expect(html).toContain('data-faces="3,4"');
    expect(html).toContain('data-total="7"');
    expect(html).toContain('Dice: 3 and 4, total 7');
    expect(html).not.toContain('Rolling');
  });

  it('mark a seven with the robber warning, and only a seven', () => {
    expect(tray({ dice: [3, 4], stage: 'still' })).toContain('Robber!');
    expect(tray({ dice: [3, 5], stage: 'still' })).not.toContain('Robber!');
    expect(tray({ dice: [3, 4], stage: 'still' })).toContain('data-seven="true"');
  });

  it('draw nothing when there has been no roll this turn', () => {
    expect(tray({ dice: null, stage: 'still' })).toBe('');
  });
});

describe('the dice while tumbling', () => {
  it('say nothing about the result: same page for any roll, no total, no announcement, no robber warning', () => {
    const a = tray({ dice: [3, 4], stage: 'rolling', stageLayer: true });
    const b = tray({ dice: [1, 1], stage: 'rolling', stageLayer: true });
    const c = tray({ dice: [6, 6], stage: 'rolling' });
    expect(a).toBe(b);
    expect(a).not.toContain('data-total');
    expect(a).not.toContain('Robber');
    expect(a).not.toContain('data-faces');
    expect(c).not.toContain('total');
    // the faces shown are the fixed sequence's, whatever was rolled
    expect(a).toContain(`data-value="${TUMBLE_FACES[0]}"`);
  });

  it('the roll plays within 1.5 seconds', () => {
    expect(ROLL_TIMING.tumble + ROLL_TIMING.hold + ROLL_TIMING.dock).toBeLessThanOrEqual(1500);
  });

  it('the big copy is silent; only the corner copy announces (after the dice stop)', () => {
    expect(tray({ dice: [3, 4], stage: 'hold', stageLayer: true })).not.toContain('role="status"');
    expect(tray({ dice: [3, 4], stage: 'hold' })).toContain('role="status"');
  });
});

describe('the store and live rolls', () => {
  it('a live update with a roll records it, with what each player got', () => {
    const s = run([{ t: 'game', kind: 'update', payload: payload(rolledEvents) }]);
    expect(s.lastRoll).toMatchObject({ seq: 1, dice: [3, 4], total: 7, hitTiles: [2], robbedTile: 9 });
    expect(s.lastRoll!.gains.a).toEqual({ lumber: 1, brick: 0, wool: 1, grain: 0, ore: 0 });
    expect(s.log[s.log.length - 3 + 0].id).toBe(s.lastRoll!.logId);
  });

  it('a snapshot never starts a roll: reload, late join and reconnect show the dice at rest', () => {
    expect(run([{ t: 'game', kind: 'snapshot', payload: payload([]) }]).lastRoll).toBeNull();
    // even a snapshot that carries events (it should not) is not a live roll
    expect(run([{ t: 'game', kind: 'snapshot', payload: payload(rolledEvents) }]).lastRoll).toBeNull();
  });

  it('every payload bumps the revision; the sequence grows only with rolls', () => {
    const s = run([
      { t: 'game', kind: 'update', payload: payload(rolledEvents) },
      { t: 'game', kind: 'update', payload: payload([{ type: 'turnEnded', player: 'a' }]) },
      { t: 'game', kind: 'update', payload: payload(rolledEvents) },
    ]);
    expect(s.rev).toBe(3);
    expect(s.lastRoll!.seq).toBe(2);
  });

  it('leaving the room forgets the roll', () => {
    expect(run([{ t: 'game', kind: 'update', payload: payload(rolledEvents) }, { t: 'leftRoom' }]).lastRoll).toBeNull();
  });
});

describe('the roll stages', () => {
  const step = (r: Run | null, ...a: Parameters<typeof rollMachine>[1][]) => a.reduce(rollMachine, r);
  const started = step(null, { t: 'arrive', roll: roll(), rev: 4, reduced: false })!;

  it('start tumbling with the result hidden', () => {
    expect(started).toMatchObject({ stage: 'rolling', highlight: false });
  });

  it('go rolling, hold, dock, still; the producing tiles are marked once the big dice leave the middle (not while they cover it)', () => {
    const hold = step(started, { t: 'stage', seq: 1, stage: 'hold' })!;
    expect(hold).toMatchObject({ stage: 'hold', highlight: false });
    const dock = step(hold, { t: 'stage', seq: 1, stage: 'dock', highlight: true })!;
    expect(dock).toMatchObject({ stage: 'dock', highlight: true });
    const still = step(dock, { t: 'stage', seq: 1, stage: 'still' }, { t: 'highlightOff', seq: 1 })!;
    expect(still).toMatchObject({ stage: 'still', highlight: false });
  });

  it('end at once when anything newer arrives: the game does not wait for the picture', () => {
    expect(step(started, { t: 'rev', rev: 5 })).toMatchObject({ stage: 'still', highlight: false });
    // the payload the roll itself came in does not count as newer
    expect(step(started, { t: 'rev', rev: 4 })).toBe(started);
  });

  it('a tap sends the dice to the corner at once and marks the tiles they covered, from then on', () => {
    expect(step(started, { t: 'skip' })).toMatchObject({ stage: 'still', highlight: true });
    // a tap when nothing is playing changes nothing
    const rest = step(started, { t: 'rev', rev: 5 })!;
    expect(step(rest, { t: 'skip' })).toBe(rest);
  });

  it('ignore a late timer from an older roll', () => {
    const next = step(started, { t: 'arrive', roll: roll({ seq: 2 }), rev: 5, reduced: false })!;
    expect(step(next, { t: 'stage', seq: 1, stage: 'still' })).toBe(next);
  });

  it('with reduced motion: no tumble, the result shows at once, the marking is a short colour change', () => {
    const r = step(null, { t: 'arrive', roll: roll(), rev: 4, reduced: true })!;
    expect(r).toMatchObject({ stage: 'still', highlight: true });
    expect(step(r, { t: 'highlightOff', seq: 1 })).toMatchObject({ stage: 'still', highlight: false });
  });
});

describe('what is held back while the dice tumble (visual only)', () => {
  const entries = (...types: string[]) => types.map((type, i) => ({ id: i + 1, event: { type } as never }));
  const log = entries('turnEnded', 'turnStarted', 'diceRolled', 'produced');

  it('hides the roll and what follows it from the log, and only while tumbling', () => {
    const r = roll({ logId: 3 });
    expect(visibleLog(log, { rolling: true, roll: r }).map((l) => l.id)).toEqual([1, 2]);
    expect(visibleLog(log, { rolling: false, roll: r })).toBe(log);
    expect(visibleLog(log, { rolling: true, roll: null })).toBe(log);
  });

  it('holds the received cards back from the counts only while tumbling', () => {
    const r = roll();
    expect(heldTotal(heldBack({ rolling: true, roll: r }, 'a'))).toBe(1);
    expect(heldBack({ rolling: false, roll: r }, 'a')).toBeNull();
    expect(heldBack({ rolling: true, roll: r }, 'someone-else')).toBeNull();
  });
});

describe('production marks', () => {
  const v = viewFor(newGame(3), 'p0');
  const withNumber = v.tiles.map((t, i) => [t, i] as const).filter(([t]) => t.number !== null).map(([, i]) => i);
  const board = (production: { hit: number[]; robbed: number | null } | null) =>
    renderToStaticMarkup(<I18nProvider><Board view={v} target={null} production={production} /></I18nProvider>);

  it('rings every hit tile and shows the "blocked" mark on the robbed one, only while marked', () => {
    const html = board({ hit: [withNumber[0], withNumber[1]], robbed: withNumber[2] });
    expect(html.match(/class="prod-ring"/g)).toHaveLength(2);
    expect(html.match(/class="prod-blocked"/g)).toHaveLength(1);
    expect(html).toContain('Blocked by the robber');
    const quiet = board(null);
    expect(quiet).not.toContain('prod-ring');
    expect(quiet).not.toContain('prod-blocked');
  });
});

describe('the "+n" on my hand', () => {
  const me = viewFor(newGame(3), 'p0');
  const html = (gain: Parameters<typeof HandBar>[0]['gain']) => renderToStaticMarkup(<I18nProvider><HandBar view={me} onOpenCards={() => {}} gain={gain} /></I18nProvider>);

  it('shows what I got, per resource, and nothing without a gain', () => {
    const h = html({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 2 });
    expect(h.match(/class="hand-gain"/g)).toHaveLength(1);
    expect(h).toContain('data-gain="2"');
    expect(html(null)).not.toContain('hand-gain');
  });

  it('is held back from the count while tumbling, and the real hand is what shows afterwards', () => {
    const real = me.players.find((p) => p.id === 'p0')!.hand!;
    const total = Object.values(real).reduce((a, b) => a + b, 0);
    const held = renderToStaticMarkup(<I18nProvider><HandBar view={me} onOpenCards={() => {}} holdBack={{ lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 }} /></I18nProvider>);
    const counts = (s: string) => [...s.matchAll(/class="hand-n">(\d+)</g)].map((m) => Number(m[1]));
    // the last count is the development cards; the five before it are the resources
    expect(counts(html(null)).slice(0, 5).reduce((a, b) => a + b, 0)).toBe(total);
    expect(counts(held).slice(0, 5).reduce((a, b) => a + b, 0)).toBe(Math.max(0, total - Math.min(1, real.lumber)));
  });
});
