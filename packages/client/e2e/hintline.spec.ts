import { expect, test } from './test';
import { MOBILE } from './helpers';
import { doForced, mover, newTable, playSetup, startShort } from './table';

/**
 * A tap on a button that is off explains itself in an amber line. That line
 * belongs to the moment it was asked in: when the turn comes round it must not
 * sit under "your turn" and say the opposite.
 */
test('the amber "not your turn" line is gone once the turn is yours', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], MOBILE);
  await startShort(seats);
  await playSetup(seats);

  const first = await mover(seats);
  const second = seats.find((s) => s !== first)!;

  // not the second player's turn: tap a button that is off
  await second.action('build').click({ force: true });
  const line = second.page.locator('.hint.blocked');
  await expect(line).toBeVisible();
  await expect(line).toContainText('Sıra sende değil');

  // the first player plays their turn through
  await first.action('roll').click();
  for (let i = 0; i < 30 && (await first.action('end').count()) === 0; i++) {
    let moved = false;
    for (const s of seats) moved = (await doForced(s)) || moved;
    if (!moved) await first.page.waitForTimeout(100);
  }
  await first.action('end').click();

  // the turn is the second player's: the leftover line is gone, the hint says it is their turn
  await expect(second.action('roll')).toBeVisible();
  await expect(second.page.locator('.hint.blocked')).toHaveCount(0);
  await second.action('roll').click();
  for (let i = 0; i < 30 && (await second.action('end').count()) === 0; i++) {
    let moved = false;
    for (const s of seats) moved = (await doForced(s)) || moved;
    if (!moved) await second.page.waitForTimeout(100);
  }
  await expect(second.page.locator('.hint.blocked')).toHaveCount(0);
  await expect(second.page.locator('p.hint').first()).toContainText('Tur sende');
});
