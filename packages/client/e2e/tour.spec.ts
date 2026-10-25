import { expect, test } from './test';
import { DESKTOP, MOBILE, shot } from './helpers';
import { bankTowardRoad, doForced, mover, newTable, playSetup, startShort } from './table';

/**
 * A walk through every screen at both sizes, saving a picture of each
 * (docs/screenshots, not committed) so the layout can be looked at: home,
 * lobby, setup, main phase, the sheets, the end of the game.
 */
for (const [size, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]] as const) {
  test(`every screen, ${size}`, async ({ browser }) => {
    const { seats } = await newTable(browser, ['Şükrü', 'Çağla', 'Öğüt'], viewport);
    const [a] = seats;
    await shot(a.page, '10-lobby-3-players', size);
    await a.page.getByRole('button', { name: /Bilge/ }).click();
    await startShort(seats);

    // the setup: a corner is highlighted and chosen, not yet confirmed
    for (let i = 0; i < 40; i++) {
      const asked = (await Promise.all(seats.map((s) => s.page.locator('.spot-vertex').count()))).findIndex((n) => n > 0);
      if (asked >= 0) {
        await seats[asked].tap('.spot-vertex');
        await expect(seats[asked].action('confirm')).toHaveAttribute('aria-disabled', 'false');
        await shot(seats[asked].page, '11-setup-choosing', size);
        await seats[asked].confirm();
        break;
      }
      await a.page.waitForTimeout(100);
    }
    await playSetup(seats);

    // main phase, with the roll answered
    const first = await mover(seats);
    await first.action('roll').click();
    // a 7 makes players discard, then the roller moves the robber and may steal
    for (let i = 0; i < 30 && (await first.action('end').count()) === 0; i++) {
      let moved = false;
      for (const s of seats) moved = (await doForced(s)) || moved;
      if (!moved) await first.page.waitForTimeout(100);
    }
    await expect(first.action('end')).toBeVisible();
    await shot(first.page, '12-main-phase', size);
    await shot(seats.find((s) => s !== first)!.page, '12-main-phase-waiting', size);

    // the sheets
    await first.action('costs').click();
    await shot(first.page, '13-costs-sheet', size);
    await first.page.getByRole('button', { name: 'Kapat' }).click();
    await first.action('trade').click();
    await shot(first.page, '14-trade-bank', size);
    await first.page.getByRole('tab', { name: 'Oyuncuyla' }).click();
    await shot(first.page, '15-trade-players', size);
    await first.page.getByRole('button', { name: 'Kapat' }).click();
    await first.page.locator('.hand-dev').click();
    await shot(first.page, '16-cards-sheet', size);
    await first.page.getByRole('button', { name: 'Kapat' }).click();
    await first.action('log').click();
    await shot(first.page, '17-log-sheet', size);
    await first.page.getByRole('button', { name: 'Kapat' }).click();

    // a build mode with a highlighted choice: take turns (exchanging with the bank toward a road) until a road is affordable
    await first.action('end').click();
    await expect(first.action('end')).toHaveCount(0);
    let shown = false;
    for (let turns = 0; turns < 60 && !shown; turns++) {
      const who = await mover(seats);
      if ((await who.action('roll').count()) > 0) await who.action('roll').click();
      for (let i = 0; i < 30 && (await who.action('end').count()) === 0; i++) {
        let moved = false;
        for (const s of seats) moved = (await doForced(s)) || moved;
        if (!moved) await who.page.waitForTimeout(100);
      }
      if (await who.can('road')) {
        await who.startBuild('road');
        await who.tap('.spot-edge');
        await shot(who.page, '18-build-road', size);
        await who.action('cancel').click();
        shown = true;
        break;
      }
      await bankTowardRoad(who);
      await who.action('end').click();
      await expect(who.action('end')).toHaveCount(0);
    }
    expect(shown, 'no road became affordable').toBe(true);
  });
}
