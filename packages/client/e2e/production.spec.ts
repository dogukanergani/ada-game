import { expect, test } from './test';
import { DESKTOP, MOBILE, SMALL, shot } from './helpers';
import { doForced, mover, newTable, playSetup, startShort } from './table';

const sizes = [
  { label: 'mobile' as const, viewport: MOBILE },
  { label: 'small' as const, viewport: SMALL },
  { label: 'desktop' as const, viewport: DESKTOP },
];

const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];

/** After a roll that produces, the producing tiles are ringed and each player sees "+n" only for their own gain. */
for (const { label, viewport } of sizes) test(`the production highlight: ringed tiles carry the rolled number, "+n" is only my own gain, ${label}`, async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport);
  await startShort(seats);
  await playSetup(seats);

  let seen = false;
  for (let turn = 0; turn < 40 && !seen; turn++) {
    const who = await mover(seats);
    const before = await Promise.all(seats.map((s) => s.hand()));
    await who.action('roll').click();
    await expect(who.page.locator('.dice-tray')).toHaveAttribute('data-stage', /dock|still/, { timeout: 4000 });
    const total = Number(await who.page.locator('.dice-tray [data-total]').getAttribute('data-total'));
    const rings = await Promise.all(seats.map((s) => s.page.locator('.prod-ring').count()));
    if (rings.some((n) => n > 0)) {
      seen = true;
      for (const s of seats) {
        const numbers = await s.page.locator('.prod-ring').evaluateAll((els) => els.map((e) => Number(e.closest('.tile')?.querySelector('.token')?.getAttribute('data-number'))));
        for (const n of numbers) expect(n).toBe(total);
        await expect(s.page.locator('.dice-tray')).toHaveAttribute('data-stage', /dock|still/);
      }
      // each seat's "+n" equals what its own hand gained, and a seat that gained nothing shows none
      await Promise.all(seats.map((s) => s.page.waitForTimeout(0)));
      for (const [i, s] of seats.entries()) {
        const after = await s.hand();
        const gained = RES.reduce((n, r) => n + (after[r] - before[i][r]), 0);
        const shown = await s.page.locator('.hand-gain').evaluateAll((els) => els.reduce((n, e) => n + Number(e.getAttribute('data-gain')), 0));
        if (total !== 7) expect(shown).toBe(gained);
      }
      // the picture of the screen that shows a "+n" if any does (it is the player who gained), else the roller's
      let shown = who;
      for (const s of seats) if ((await s.page.locator('.hand-gain').count()) > 0) shown = s;
      await shot(shown.page, '23-production-highlight', label);
    }
    for (let i = 0; i < 6; i++) if (!(await doForced(who))) break;
    for (let i = 0; i < 20 && !(await who.can('end')); i++) {
      let moved = false;
      for (const s of seats) moved = (await doForced(s)) || moved;
      if (!moved) await who.page.waitForTimeout(100);
    }
    await who.action('end').click();
    await expect(who.action('end')).toHaveCount(0);
  }
  expect(seen, 'no roll in 40 turns produced anything').toBe(true);
});
