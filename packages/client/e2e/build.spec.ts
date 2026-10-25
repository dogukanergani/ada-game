import { expect, test } from './test';
import type { Page } from '@playwright/test';
import { DESKTOP, MOBILE, SMALL, shot } from './helpers';
import { bankTowardRoad, doForced, mover, newTable, playSetup, startShort } from './table';

/** The sheet sits inside the screen, does not scroll sideways, and every control in it is at least 44 px. */
async function checkFits(page: Page, viewport: { width: number; height: number }) {
  const box = (await page.locator('.sheet').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(await page.locator('.sheet').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  const small = await page.locator('.sheet button').evaluateAll((els) =>
    els
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.height < 43.5 || r.width < 43.5);
      })
      .map((e) => `${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
  );
  expect(small, 'controls under 44 px').toEqual([]);
}

/**
 * Building starts from one "İnşa" button and its sheet. The sheet only changes the way in:
 * a tap on a row starts the usual build mode on the board, a tap on a "?" only shows the rule.
 */
const sizes = [
  { label: 'mobile' as const, viewport: MOBILE },
  { label: 'small' as const, viewport: SMALL },
  { label: 'desktop' as const, viewport: DESKTOP },
];

for (const { label, viewport } of sizes) test(`the build sheet: three rows, rules behind the "?", a row starts the build mode, ${label} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport);
  await startShort(seats);
  await playSetup(seats);

  // the three piece buttons are gone from the dock; one build button is there
  const first = await mover(seats);
  await expect(first.action('build')).toBeVisible();
  for (const piece of ['road', 'settlement', 'city']) await expect(first.page.locator(`.dock [data-action="${piece}"]`)).toHaveCount(0);

  let shown = false;
  for (let turns = 0; turns < 60 && !shown; turns++) {
    const who = await mover(seats);
    if ((await who.action('roll').count()) > 0) await who.action('roll').click();
    for (let i = 0; i < 30 && (await who.action('end').count()) === 0; i++) {
      let moved = false;
      for (const s of seats) moved = (await doForced(s)) || moved;
      if (!moved) await who.page.waitForTimeout(100);
    }
    if (!(await who.can('road'))) {
      await bankTowardRoad(who);
      if (!(await who.can('road'))) {
        await who.action('end').click();
        await expect(who.action('end')).toHaveCount(0);
        continue;
      }
    }
    await who.action('build').click();
    const dialog = who.page.getByRole('dialog');
    await expect(dialog.locator('.build-row')).toHaveCount(3);
    await expect(dialog.locator('[data-rule]')).toHaveCount(0);
    await checkFits(who.page, viewport);
    await shot(who.page, '42-build-sheet', label);

    // the "?" shows the rule and leaves the sheet open
    await dialog.locator('[data-info="settlement"]').click();
    await expect(dialog.locator('[data-rule="settlement"]')).toContainText('5');
    await expect(dialog).toBeVisible();
    await checkFits(who.page, viewport);
    await shot(who.page, '43-build-sheet-info', label);
    await dialog.locator('[data-info="settlement"]').click();
    await expect(dialog.locator('[data-rule]')).toHaveCount(0);

    // a tap on the row closes the sheet and the board asks for an edge, as before
    await dialog.locator('[data-build="road"]').click();
    await expect(who.page.getByRole('dialog')).toHaveCount(0);
    await expect(who.page.locator('.spot-edge').first()).toBeVisible();
    await expect(who.action('confirm')).toBeVisible();
    await who.action('cancel').click();
    shown = true;
  }
  expect(shown, 'no road became affordable').toBe(true);
});
