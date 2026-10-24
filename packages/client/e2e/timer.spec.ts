import { expect, test } from './test';
import { DESKTOP, MOBILE, shot } from './helpers';
import { newTable, playSetup, type Seat } from './table';

// this project's server adds a 4-second turn and a 60-second game to the lists of the lobby (test-only switches)

/** The host picks the short mode, turns the timer on with the test server's short limits, and starts. */
async function startTimed(seats: Seat[]) {
  const [host] = seats;
  await host.page.getByRole('radio', { name: /Kısa/ }).click();
  await host.page.getByRole('switch', { name: 'Zamanlı mod' }).click();
  await host.page.locator('[data-limit="turn"] [data-seconds="4"]').click();
  await host.page.locator('[data-limit="game"] [data-seconds="60"]').click();
  await expect(host.page.locator('[data-limit="turn"] [data-seconds="4"]')).toHaveAttribute('aria-checked', 'true');
  // the guest sees the same settings, but cannot change them
  await expect(seats[1].page.locator('[data-limit="game"] [data-seconds="60"]')).toHaveAttribute('aria-checked', 'true');
  await expect(seats[1].page.locator('[data-limit="game"] [data-seconds="60"]')).toBeDisabled();
  await shot(host.page, '24-lobby-timer', host.page.viewportSize()!.width > 900 ? 'desktop' : 'mobile');
  await host.page.getByRole('button', { name: 'Oyunu başlat' }).click();
  for (const s of seats) await s.page.locator('.game').waitFor();
}

const turnOf = (seat: Seat) => seat.page.locator('.pseat[data-turn="true"]').first().getAttribute('data-player');

test('a turn nobody plays ends by itself when its time is up, and the countdown is on screen', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], DESKTOP);
  await startTimed(seats);
  await playSetup(seats);

  for (const s of seats) {
    await expect(s.page.locator('.timer-bar')).toBeVisible();
    await expect(s.page.locator('.timer-turn')).toBeVisible();
    await expect(s.page.locator('.timer-progress')).toHaveAttribute('aria-valuenow', /\d+/);
  }
  const first = await turnOf(seats[0]);
  expect(first).toBeTruthy();
  // in the last 10 seconds the countdown is urgent: a 4 second turn is urgent from the start
  await expect(seats[0].page.locator('.timer-bar')).toHaveAttribute('data-urgent', 'true');
  await expect(seats[0].page.locator('.timer-hurry')).toBeVisible();
  await shot(seats[0].page, '25-timer-urgent', 'desktop');

  // nobody does anything: the server ends the turn and both screens move on to the other player
  await expect.poll(() => turnOf(seats[0]), { timeout: 20_000 }).not.toBe(first);
  await expect.poll(() => turnOf(seats[1]), { timeout: 5_000 }).not.toBe(first);
  await expect(seats[0].page.locator('.game-log')).toContainText('süre doldu');
  // the countdown starts again for the next player
  await expect(seats[0].page.locator('.timer-value')).toHaveText(/0:0[0-4]/);
});

test('when the game time runs out the game ends and players level on the top score are shown as winning together', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], MOBILE);
  await startTimed(seats);
  await playSetup(seats);
  await shot(seats[0].page, '26-timer-game', 'mobile');

  // nobody builds, so both stand on the two settlements of the setup: a tie when the 60 seconds are up
  for (const s of seats) await expect(s.page.locator('.winner')).toBeVisible({ timeout: 90_000 });
  const text = await seats[0].page.locator('.winner').innerText();
  expect(text).toMatch(/Ayşe ve Çağlar|Çağlar ve Ayşe/);
  expect(text).toContain('berabere kazandı');
  expect(await seats[1].page.locator('.winner').innerText()).toBe(text);
  for (const s of seats) await expect(s.page.locator('[data-over="time-up"]')).toBeVisible();
  await expect(seats[0].page.locator('.score-list li[data-winner="true"]')).toHaveCount(2);
  await expect(seats[0].page.locator('.timer-bar')).toHaveCount(0);
  await shot(seats[0].page, '27-game-over-tie', 'mobile');
});
