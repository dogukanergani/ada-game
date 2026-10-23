import { expect, test } from './test';
import { MOBILE, SHOTS, SMALL } from './helpers';
import { join } from 'node:path';
import { newTable } from './table';

/**
 * The seats with real numbers in them: the test server deals everyone cards of each resource (ADA_TEST_RESOURCES=6, as far as the bank goes), so every seat shows a two-digit number of cards
 * (24 in a five-player game, whose bank holds 24 of each) from the first move. At the narrowest width (360 px) the four rivals' seats share one row, and nothing in a seat may
 * stick out of it or be cut off.
 */
for (const { label, viewport } of [
  { label: 'small', viewport: SMALL },
  { label: 'mobile', viewport: MOBILE },
] as const) {
  test(`two-digit card counts fit in five seats, ${label} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
    const names = ['P1', 'P2', 'P3', 'P4', 'P5'];
    const { seats } = await newTable(browser, names, viewport);
    const page = seats[0].page;
    await expect(page.getByRole('heading', { name: /Oyuncular \(5\/5\)/ })).toBeVisible();
    await page.getByRole('radio', { name: /Standart/ }).click();
    await page.getByRole('button', { name: 'Oyunu başlat' }).click();
    for (const s of seats) await s.page.locator('.game').waitFor();
    await page.waitForTimeout(500);

    await page.screenshot({ path: join(SHOTS, `seats-full-${label}.png`) });
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.pseat-btn')].map((btn) => {
        const b = btn.getBoundingClientRect();
        const kids = [...btn.querySelectorAll('.pseat-points, .pseat-count, .pseat-avatar')].map((e) => {
          const k = e.getBoundingClientRect();
          return { cls: e.getAttribute('class'), text: (e as HTMLElement).innerText, over: Math.max(0, k.right - b.right + 2, b.left + 2 - k.left) };
        });
        return { label: btn.getAttribute('aria-label'), fits: btn.scrollWidth - btn.clientWidth, width: Math.round(b.width), kids };
      }),
    );
    expect(r).toHaveLength(5);
    for (const seat of r) {
      expect(seat.label, 'the seat reads a two-digit number of cards').toMatch(/\d\d kart/);
      expect(seat.fits, `${seat.label}: the seat holds its content`).toBeLessThanOrEqual(1);
      for (const k of seat.kids) expect(k.over, `${seat.label}: "${k.text}" sticks out of the seat by ${k.over}px (${k.cls})`).toBeLessThanOrEqual(0.5);
    }
  });
}
