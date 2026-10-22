import { expect, test } from './test';
import { DESKTOP, MOBILE, shot } from './helpers';
import { mover, newTable, playSetup, startShort, takeTurn } from './table';

// this project's server lowers the target score to 3 points (test-only switch), so a game ends quickly
for (const [size, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]] as const) {
  test(`a short game runs to the end from the interface (${size}): the winner and scores are shown, the host returns everyone to the lobby`, async ({ browser }) => {
    const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport);
    await startShort(seats);
    await playSetup(seats);
    for (let turns = 0; turns < 150; turns++) {
      if (await seats[0].gameOver()) break;
      const who = await mover(seats).catch(() => null);
      if (!who) break;
      await takeTurn(seats, who, { exchange: true });
    }
    for (const s of seats) await expect(s.page.locator('.winner')).toBeVisible();
    const winnerText = await seats[0].page.locator('.winner').innerText();
    expect(await seats[1].page.locator('.winner').innerText()).toBe(winnerText);
    await expect(seats[0].page.locator('.score-list li')).toHaveCount(2);
    await shot(seats[0].page, '19-game-over', size);

    // the host (first player) returns everyone to the lobby
    await seats[0].action('to-lobby').click();
    for (const s of seats) await expect(s.page.getByRole('heading', { name: 'Lobi' })).toBeVisible();
  });
}
