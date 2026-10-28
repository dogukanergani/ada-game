import type { Page } from '@playwright/test';
import { expect, test } from './test';
import { DESKTOP, MOBILE, SMALL, setAnimationsOff, shot } from './helpers';
import { doForced, mover, newTable, playSetup, startShort, type Seat } from './table';

/**
 * The cards of a roll flying from the producing tiles to the seats. Every page records, from before the app loads,
 * each flier that appears (where it started, where it was last seen, whether it is gone again), so a flight that
 * lasts well under a second cannot be missed between two polls.
 */
interface Seen {
  player: string;
  first: { x: number; y: number };
  last: { x: number; y: number };
  gone: boolean;
}

function track(page: Page) {
  void page.addInitScript(() => {
    const w = window as unknown as { __fl: { el: Element; player: string; first: { x: number; y: number }; last: { x: number; y: number }; gone: boolean }[] };
    w.__fl = [];
    const centre = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          // the fliers arrive inside their layer, which is the node that was added
          for (const el of n.matches('[data-flight]') ? [n] : n.querySelectorAll('[data-flight]')) {
            const c = centre(el);
            w.__fl.push({ el, player: el.getAttribute('data-player')!, first: c, last: c, gone: false });
          }
        }
    }).observe(document, { childList: true, subtree: true });
    const tick = () => {
      for (const f of w.__fl) {
        if (f.gone) continue;
        if (f.el.isConnected) f.last = centre(f.el);
        else f.gone = true;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const seen = (page: Page): Promise<Seen[]> =>
  page.evaluate(() => (window as unknown as { __fl: Seen[] }).__fl.map((f) => ({ player: f.player, first: f.first, last: f.last, gone: f.gone })));

const avatar = (page: Page, player: string) =>
  page.evaluate((id) => {
    const r = document.querySelector(`.pseat[data-player="${id}"] .pseat-avatar`)!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, player);

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

async function finishTurn(seats: Seat[], who: Seat) {
  for (let i = 0; i < 6; i++) if (!(await doForced(who))) break;
  for (let i = 0; i < 20 && !(await who.can('end')); i++) {
    let moved = false;
    for (const s of seats) moved = (await doForced(s)) || moved;
    if (!moved) await who.page.waitForTimeout(100);
  }
  await who.action('end').click();
  await expect(who.action('end')).toHaveCount(0);
}

/** Rolls turn after turn until a roll marks producing tiles; returns the roller, with that roll's picture still on screen. */
async function rollUntilProduces(seats: Seat[]): Promise<Seat> {
  for (let turn = 0; turn < 40; turn++) {
    const who = await mover(seats);
    await who.action('roll').click();
    await expect(who.page.locator('.dice-tray')).toHaveAttribute('data-stage', /dock|still/, { timeout: 4000 });
    if ((await who.page.locator('.prod-ring').count()) > 0) return who;
    await finishTurn(seats, who);
  }
  throw new Error('no roll in 40 turns produced anything');
}

/** 'system': the browser reports reduced motion (which must change nothing); 'off': the players turned the animations off in Settings */
async function table(browser: import('@playwright/test').Browser, viewport = MOBILE, mode: 'on' | 'system' | 'off' = 'on') {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport, (page) => {
    track(page);
    if (mode === 'system') void page.emulateMedia({ reducedMotion: 'reduce' });
  });
  if (mode === 'off') for (const s of seats) await setAnimationsOff(s.page);
  await startShort(seats);
  await playSetup(seats);
  return seats;
}

for (const zoomed of [false, true]) {
  test(`production flight: cards leave the tiles toward the seats that got them, then are gone, ${zoomed ? 'board zoomed in' : 'board fitted'}`, async ({ browser }) => {
    const seats = await table(browser);
    if (zoomed) for (const s of seats) for (let i = 0; i < 3; i++) await s.page.getByRole('button', { name: 'Yakınlaştır' }).click();
    const who = await rollUntilProduces(seats);
    for (const s of seats) {
      await s.page.waitForFunction(() => (window as unknown as { __fl: unknown[] }).__fl.length > 0, null, { timeout: 4000 });
    }
    const rings = await who.page.locator('.prod-ring').count();
    expect(rings).toBeGreaterThan(0);
    // every page (own gain or a rival's: it is all public) saw the same cards fly
    await who.page.waitForTimeout(1500);
    const all = await Promise.all(seats.map((s) => seen(s.page)));
    expect(all[0].length).toBeGreaterThan(0);
    expect(all[1].length).toBe(all[0].length);
    for (const [i, s] of seats.entries()) {
      for (const f of all[i]) {
        const end = await avatar(s.page, f.player);
        expect(f.gone, 'the flier is removed again').toBe(true);
        // it moved toward that player's seat: nearer at the last sighting than at the start, and nearly there
        expect(dist(f.last, end)).toBeLessThan(dist(f.first, end));
        expect(dist(f.last, end)).toBeLessThan(Math.max(60, dist(f.first, end) * 0.5));
      }
      await expect(s.page.locator('[data-flight]')).toHaveCount(0);
    }
    await finishTurn(seats, who);
  });
}

test('production flight: the system reduced-motion setting no longer matters, the cards still fly', async ({ browser }) => {
  const seats = await table(browser, MOBILE, 'system');
  const who = await rollUntilProduces(seats);
  await who.page.waitForFunction(() => (window as unknown as { __fl: unknown[] }).__fl.length > 0, null, { timeout: 4000 });
  await who.page.waitForTimeout(1500);
  expect((await seen(who.page)).length).toBeGreaterThan(0);
  await finishTurn(seats, who);
});

test('production flight: with the animations turned off in Settings nothing flies and the tiles are still marked', async ({ browser }) => {
  const seats = await table(browser, MOBILE, 'off');
  const who = await rollUntilProduces(seats);
  await who.page.waitForTimeout(1800);
  for (const s of seats) expect(await seen(s.page)).toHaveLength(0);
  await finishTurn(seats, who);
});

test('production flight: a reload or a late arrival does not replay the last roll', async ({ browser }) => {
  const seats = await table(browser);
  const who = await rollUntilProduces(seats);
  await who.page.waitForTimeout(1500);
  const rival = seats.find((s) => s !== who)!;
  expect((await seen(rival.page)).length).toBeGreaterThan(0);
  await rival.page.reload();
  await rival.page.locator('.game').waitFor();
  await rival.page.waitForTimeout(2000);
  expect(await seen(rival.page)).toHaveLength(0);
  await expect(rival.page.locator('[data-flight]')).toHaveCount(0);
  await finishTurn(seats, who);
});

for (const [label, viewport] of [['mobile', MOBILE], ['small', SMALL], ['desktop', DESKTOP]] as const) {
  test(`production flight: a frame of the flight, ${label}`, async ({ browser }) => {
    const seats = await table(browser, viewport);
    const who = await rollUntilProduces(seats);
    // the roller's page recorded it; look for a page that has a cards-in-flight frame up right now
    await who.page.waitForSelector('[data-flight]', { state: 'attached', timeout: 4000 }).catch(() => undefined);
    await shot(who.page, '24-production-flight', label);
    await who.page.waitForTimeout(1500);
    await finishTurn(seats, who);
  });
}
