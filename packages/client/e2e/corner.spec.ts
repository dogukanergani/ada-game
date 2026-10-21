import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, MOBILE, SMALL, shot } from './helpers';
import { doForced, mover, newTable, playSetup, type Seat } from './table';

/**
 * Where the resting dice sit must not cover the board: on each of the three maps and on each screen size,
 * the corner tray must not overlap a number token, a harbour, a building, a road or the robber.
 */
const maps = [
  { id: 'classic19', players: 3, mode: /Standart/ },
  { id: 'large30', players: 5, mode: /Standart/ },
  { id: 'short14', players: 2, mode: /Kısa/ },
] as const;
const sizes = [
  { label: 'mobile' as const, viewport: MOBILE },
  { label: 'small' as const, viewport: SMALL },
  { label: 'desktop' as const, viewport: DESKTOP },
];

async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const tray = document.querySelector('.dice-tray')!.getBoundingClientRect();
    const hit = (r: DOMRect) => r.right > tray.left && r.left < tray.right && r.bottom > tray.top && r.top < tray.bottom;
    const out: string[] = [];
    for (const sel of ['.token', '.harbor', '.building', '.road', '.robber']) {
      document.querySelectorAll(sel).forEach((el) => {
        if (hit(el.getBoundingClientRect())) out.push(`${sel} ${el.getAttribute('data-tile') ?? el.getAttribute('data-vertex') ?? el.getAttribute('data-edge') ?? ''}`);
      });
    }
    return out;
  });
}

for (const map of maps) {
  for (const { label, viewport } of sizes) {
    test(`the resting dice cover nothing on ${map.id}, ${label} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
      const names = Array.from({ length: map.players }, (_, i) => `P${i + 1}`);
      const { seats } = await newTable(browser, names, viewport);
      await seats[0].page.getByRole('radio', { name: map.mode }).click();
      await seats[0].page.getByRole('button', { name: 'Oyunu başlat' }).click();
      for (const s of seats) await s.page.locator('.game').waitFor();
      await playSetup(seats);
      const first = await mover(seats);
      await first.action('roll').click();
      for (let i = 0; i < 40 && (await first.action('end').count()) === 0; i++) {
        let moved = false;
        for (const s of seats as Seat[]) moved = (await doForced(s)) || moved;
        if (!moved) await first.page.waitForTimeout(100);
      }
      await expect(first.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
      await first.page.waitForTimeout(300);
      // the map in this game is the one the test is about
      const tiles = await first.page.locator('.tile').count();
      expect(tiles).toBe({ classic19: 19, large30: 30, short14: 14 }[map.id]);
      await shot(first.page, `24-dice-corner-${map.id}`, label);
      expect(await overlaps(first.page), `the dice cover board parts on ${map.id}`).toEqual([]);
    });
  }
}
