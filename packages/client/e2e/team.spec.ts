import { expect, test } from './test';
import { DESKTOP, MOBILE, SMALL, shot } from './helpers';
import { mover, newTable, playSetup, takeTurn, type Seat } from './table';

// this project's server lowers the target to 3 points (test-only switch): the team goal is then 6, and each team already holds 4 after the setup

const sizes = [
  { label: 'mobile' as const, viewport: MOBILE },
  { label: 'small' as const, viewport: SMALL },
  { label: 'desktop' as const, viewport: DESKTOP },
];

const sum = (h: Record<string, number>) => Object.values(h).reduce((a, b) => a + b, 0);
const idOf = (s: Seat) => s.page.locator('.pseat[data-me="true"]').first().getAttribute('data-player');
const mateIdOf = (s: Seat) => s.page.locator('.pseat[data-mate="true"]').first().getAttribute('data-player');

for (const { label, viewport } of sizes) {
  test(`a 2v2 team game from the lobby to a team win, with a gift sent off turn (${label} ${viewport.width}x${viewport.height})`, async ({ browser }) => {
    const names = ['Ayşe', 'Bora', 'Cem', 'Deniz'];
    const { seats } = await newTable(browser, names, viewport);
    const [host] = seats;

    /* ---- the lobby: switch the mode on, everyone picks a side, two and two ---- */
    await host.page.getByRole('radio', { name: /Kısa/ }).click();
    await expect(host.action('team-toggle')).toHaveAttribute('aria-checked', 'false');
    await host.action('team-toggle').click();
    for (const s of seats) await expect(s.action('team-join-A')).toBeVisible();
    const start = host.page.getByRole('button', { name: 'Oyunu başlat' });
    await expect(start).toBeDisabled();
    await expect(host.page.locator('#start-reason')).toContainText('4 oyuncu');
    // A, A, B, B: Ayşe and Bora against Cem and Deniz
    for (const [i, s] of seats.entries()) await s.action(i < 2 ? 'team-join-A' : 'team-join-B').click();
    await expect(seats[3].page.locator('.team-col[data-team="B"] .team-members li[data-empty="false"]')).toHaveCount(2);
    await seats[2].action('team-join-B').click(); // the same button steps out of the team again
    await expect(seats[3].page.locator('.team-col[data-team="B"] .team-members li[data-empty="false"]')).toHaveCount(1);
    await expect(start).toBeDisabled();
    await seats[2].action('team-join-B').click();
    await expect(start).toBeEnabled();
    await shot(host.page, '60-team-lobby', label);
    await start.click();
    for (const s of seats) await s.page.locator('.game').waitFor();
    await playSetup(seats);

    /* ---- in the game: team marks, the score strip ---- */
    const ids = await Promise.all(seats.map(idOf));
    const mates = await Promise.all(seats.map(mateIdOf));
    expect(mates[0]).toBe(ids[1]);
    expect(mates[1]).toBe(ids[0]);
    expect(mates[2]).toBe(ids[3]);
    expect(mates[3]).toBe(ids[2]);
    for (const s of seats) {
      await expect(s.page.locator('.team-bar')).toBeVisible();
      await expect(s.page.locator('.team-bar .team-goal')).toContainText('6');
      await expect(s.page.locator('.team-side[data-side="us"] .team-points')).toHaveText('4');
      await expect(s.page.locator('.pseat[data-team]')).toHaveCount(4);
    }
    await shot(seats[0].page, '61-team-game', label);

    /* ---- a gift, sent by someone whose turn it is not, arrives at once ---- */
    let gifted = false;
    for (let turns = 0; turns < 60 && !gifted; turns++) {
      const who = await mover(seats);
      if ((await who.action('roll').count()) > 0) await who.action('roll').click();
      for (let i = 0; i < 30 && (await who.action('end').count()) === 0; i++) await who.page.waitForTimeout(100);
      if ((await who.action('end').count()) === 0) {
        await takeTurn(seats, who); // a 7 or a forced sheet: let the helper settle it
        continue;
      }
      await expect(who.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
      for (const sender of seats.filter((s) => s !== who)) {
        const hand = await sender.hand();
        const mateId = await mateIdOf(sender);
        const mate = seats[ids.indexOf(mateId)];
        if (sum(hand) === 0 || mate === undefined) continue;
        const resource = Object.keys(hand).find((r) => hand[r] > 0)!;
        const mateBefore = await mate.hand();
        // not this player's turn: no roll, no end, and still the gift button is on
        await expect(sender.action('end')).toHaveCount(0);
        await expect(sender.action('gift')).toHaveAttribute('aria-disabled', 'false');
        await sender.action('gift').click();
        await sender.page.locator(`.rrow[data-block="gift"][data-resource="${resource}"]`).click();
        await expect(sender.page.locator('.trade-summary')).toContainText('gönderilecek');
        await shot(sender.page, '62-team-gift', label);
        await sender.action('send-gift').click();
        await expect(sender.page.locator('.trade-summary')).toContainText('Gönderildi');
        await sender.page.getByRole('button', { name: 'Kapat' }).click();
        // at once, with nobody accepting anything: the teammate holds one more, the sender one less
        await expect.poll(async () => (await mate.hand())[resource] ?? 0).toBe((mateBefore[resource] ?? 0) + 1);
        await expect.poll(async () => (await sender.hand())[resource] ?? 0).toBe(hand[resource] - 1);
        await expect(mate.page.locator('.last-text, .log-list').first()).toContainText('takım arkadaşı');
        // and the turn is still the mover's
        await expect(who.action('end')).toHaveCount(1);
        gifted = true;
        break;
      }
      await takeTurn(seats, who);
    }
    expect(gifted, 'nobody ever held a card off turn').toBe(true);

    /* ---- play on until a team reaches the goal ---- */
    for (let turns = 0; turns < 200; turns++) {
      if (await seats[0].gameOver()) break;
      const who = await mover(seats).catch(() => null);
      if (!who) break;
      await takeTurn(seats, who, { exchange: true });
    }
    for (const s of seats) await expect(s.page.locator('.winner[data-over="team-winner"]')).toBeVisible();
    const text = await seats[0].page.locator('.winner').innerText();
    for (const s of seats) expect(await s.page.locator('.winner').innerText()).toBe(text);
    // the winning team's two members are named together: exactly two names in the sentence
    expect(names.filter((n) => text.includes(n))).toHaveLength(2);
    await expect(seats[0].page.locator('.team-scores li')).toHaveCount(2);
    await expect(seats[0].page.locator('.team-scores li[data-winner="true"]')).toHaveCount(1);
    await expect(seats[0].page.locator('.score-list:not(.team-scores) li[data-winner="true"]')).toHaveCount(2);
    await shot(seats[0].page, '63-team-over', label);
  });
}
