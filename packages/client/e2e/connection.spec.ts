import { expect, test } from '@playwright/test';
import { MOBILE, openPlayer, shot } from './helpers';
import { newTable, startShort, playSetup } from './table';

test('losing the connection shows it plainly, the others see the player as offline, and coming back restores the game', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], MOBILE);
  await startShort(seats);
  await playSetup(seats);
  const [a, b] = seats;

  await a.player.context.setOffline(true);
  await expect(a.page.locator('.status-line')).toBeVisible({ timeout: 40_000 });
  await shot(a.page, '20-offline', 'mobile');
  // the other player sees the dropped player marked in words, not only by colour
  await expect(b.page.locator('.chip[data-online="false"]')).toHaveCount(1, { timeout: 40_000 });
  await expect(b.page.locator('.chip[data-online="false"] .badge.offline')).toContainText('çevrimdışı');

  await a.player.context.setOffline(false);
  await expect(a.page.locator('.status-line')).toHaveCount(0, { timeout: 40_000 });
  await expect(a.page.locator('.game')).toBeVisible();
  await expect(b.page.locator('.chip[data-online="false"]')).toHaveCount(0, { timeout: 20_000 });
  void openPlayer;
});
