import { expect, test } from './test';
import { DESKTOP, MOBILE, SMALL, shot } from './helpers';
import { newTable, playSetup } from './table';

// screenshots of the new screens at the three sizes; they run on the timed server of timer.spec (4 s turns, 60 s game)
for (const [size, viewport] of [['mobile', MOBILE], ['small', SMALL], ['desktop', DESKTOP]] as const) {
  test(`timed mode screens (${size}): lobby with custom target and timer, countdowns, costs with points, a tie at the end`, async ({ browser }) => {
    const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport);
    const [host, guest] = seats;

    // lobby: custom mode with a target, timer on with the short limits
    await host.page.getByRole('radio', { name: /Özel/ }).click();
    for (let i = 0; i < 3; i++) await host.page.getByRole('button', { name: 'Hedef puanı azalt' }).click();
    await expect(host.page.locator('.target-picker')).toHaveAttribute('data-target', '7');
    await host.page.getByRole('switch', { name: 'Zamanlı mod' }).click();
    await host.page.locator('[data-limit="turn"] [data-seconds="4"]').click();
    await host.page.locator('[data-limit="game"] [data-seconds="60"]').click();
    await host.page.locator('.target-picker').scrollIntoViewIfNeeded();
    await shot(host.page, '28-lobby-custom-timer', size);
    await host.page.locator('[data-timer]').scrollIntoViewIfNeeded();
    await shot(host.page, '29-lobby-timer-settings', size);
    await expect(guest.page.locator('.target-picker')).toHaveAttribute('data-target', '7');
    await host.page.getByRole('button', { name: 'Oyunu başlat' }).click();
    for (const s of seats) await s.page.locator('.game').waitFor();
    await playSetup(seats);

    // countdowns
    await expect(host.page.locator('.timer-bar')).toBeVisible();
    await shot(host.page, '30-countdowns', size);
    // the costs sheet: points column
    await host.action('costs').click();
    await expect(host.page.getByRole('dialog', { name: 'Maliyetler' }).locator('.cost-points').first()).toBeVisible();
    await shot(host.page, '31-costs-points', size);
    await host.page.getByRole('button', { name: 'Kapat' }).click();

    // the end: nobody built, so both stand level
    await expect(host.page.locator('.winner')).toBeVisible({ timeout: 90_000 });
    await expect(host.page.locator('.winner')).toContainText('berabere kazandı');
    await shot(host.page, '32-game-over-tie', size);
  });
}
