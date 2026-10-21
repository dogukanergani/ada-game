import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, MOBILE, SMALL, shot } from './helpers';
import { doForced, mover, newTable, playSetup, startShort, type Seat } from './table';

const sizes = [
  { label: 'mobile' as const, viewport: MOBILE },
  { label: 'small' as const, viewport: SMALL },
  { label: 'desktop' as const, viewport: DESKTOP },
];

/** The open sheet must sit inside the screen, keep its action bar in reach, not scroll sideways, and keep every control at least 44 px. */
async function checkSheetFits(page: Page, viewport: { width: number; height: number }) {
  const sheet = page.locator('.sheet');
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  const overflowX = await sheet.evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(overflowX).toBeLessThanOrEqual(1);
  const foot = (await page.locator('.sheet-foot').boundingBox())!;
  expect(foot.y + foot.height).toBeLessThanOrEqual(viewport.height + 1);
  // the pinned bar does not cover the tiles it belongs to: the scrolling body ends where the bar begins
  const body = (await page.locator('.sheet-body').boundingBox())!;
  expect(body.y + body.height).toBeLessThanOrEqual(foot.y + 1);
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

async function playToOffer(seats: Seat[]) {
  for (let turns = 0; turns < 60; turns++) {
    const who = await mover(seats);
    const other = seats.find((s) => s !== who)!;
    await who.action('roll').click();
    for (let i = 0; i < 20 && (await who.action('end').count()) === 0; i++) {
      let moved = false;
      for (const s of seats) moved = (await doForced(s)) || moved;
      if (!moved) await who.page.waitForTimeout(100);
    }
    // the counts on screen are held back while the dice tumble: read them once the roll has played
    await expect(who.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
    const mine = await who.hand();
    const theirs = await other.hand();
    const give = Object.keys(mine).find((r) => mine[r] > 0);
    const want = Object.keys(theirs).find((r) => theirs[r] > 0 && r !== give);
    if (give && want) return { who, other, give, want, mine };
    await who.action('end').click();
    await expect(who.action('end')).toHaveCount(0);
  }
  throw new Error('the players never held cards the other lacked');
}

for (const { label, viewport } of sizes) {
  test(`the trade sheet and an offer between two players, ${label} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
    const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport);
    await startShort(seats);
    await playSetup(seats);
    const { who, other, give, want } = await playToOffer(seats);
    const whoName = who.name;
    await expect(who.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');

    // ---- with the bank ----
    await who.action('trade').click();
    await expect(who.page.getByRole('tab', { name: 'Bankayla' })).toHaveAttribute('aria-selected', 'true');
    await expect(who.page.locator('.trade-summary')).toContainText('Vereceğin ve alacağın kaynağı seç');
    // each tile that is off says why; the ratio is on every "give" tile
    for (const tile of await who.page.locator('.rtile[data-block="give"]').all()) {
      await expect(tile.locator('.rtile-badge')).toHaveText(/^[234]:1$/);
      if ((await tile.getAttribute('aria-disabled')) === 'true') await expect(tile.locator('.rtile-sub')).toHaveText(/eksik|Bankada yok|Sıra sende değil/);
    }
    await expect(who.action('bank-trade')).toHaveAttribute('aria-disabled', 'true');
    await checkSheetFits(who.page, viewport);
    await shot(who.page, '30-trade-bank', label);

    // ---- with a player ----
    await who.page.getByRole('tab', { name: 'Oyuncuyla' }).click();
    await expect(who.page.locator('.trade-summary')).toContainText('Vereceğin ve istediğin kaynakları seç');
    await expect(who.action('send-offer')).toHaveAttribute('aria-disabled', 'true');
    await checkSheetFits(who.page, viewport);
    await shot(who.page, '32-trade-players', label);
    const giveRes = give;
    await who.page.locator(`.rtile[data-block="offer-give"][data-resource="${giveRes}"]`).click();
    // a resource given cannot be asked for, and the tile says so
    const clash = who.page.locator(`.rtile[data-block="offer-want"][data-resource="${giveRes}"]`);
    await expect(clash).toHaveAttribute('aria-disabled', 'true');
    await expect(clash.locator('.rtile-sub')).toHaveText('Veriyorsun');
    await who.page.locator(`.rtile[data-block="offer-want"][data-resource="${want}"]`).click();
    await expect(who.page.locator('.trade-summary')).toContainText(/verip .* istersin$/);
    await expect(who.page.locator('.rtile-count')).toHaveCount(2);
    await expect(who.action('send-offer')).toHaveAttribute('aria-disabled', 'false');
    await checkSheetFits(who.page, viewport);
    await shot(who.page, '33-trade-players-chosen', label);
    await who.action('send-offer').click();
    await expect(who.page.locator('.offer-card.mine')).toHaveCount(1);
    await expect(who.page.locator('.offer-card.mine [data-action="withdraw"]')).toBeVisible();
    await expect(who.page.locator('.trade-note')).toContainText('Açık teklifin var');
    await checkSheetFits(who.page, viewport);
    await shot(who.page, '34-trade-own-offer', label);
    await who.page.getByRole('button', { name: 'Kapat' }).click();

    // ---- the other player: a notice on the game screen, then the offer with accept ----
    const banner = other.page.locator('.offer-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`${whoName} bir teklif verdi`);
    expect((await banner.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await shot(other.page, '35-offer-banner', label);
    await banner.click();
    await expect(other.page.getByRole('tab', { name: 'Oyuncuyla' })).toHaveAttribute('aria-selected', 'true');
    const card = other.page.locator('.offer-card:not(.mine)');
    await expect(card).toContainText(`${whoName} bir teklif verdi`);
    await expect(card.locator('.seat')).toHaveText(whoName.slice(0, 1));
    await checkSheetFits(other.page, viewport);
    await shot(other.page, '36-trade-incoming', label);
    await other.page.locator('[data-action="accept"]').click();
    await expect(other.page.locator('.offer-banner')).toHaveCount(0);
    await other.page.getByRole('button', { name: 'Kapat' }).click();
    await expect(other.page.locator('.log-list, .last-text').first()).toBeVisible();
    await expect(other.page.locator('.offer-banner')).toHaveCount(0);
  });
}

test('an offer that the receiver cannot afford: accept is off and says what is missing; the owner can cancel', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar']);
  await startShort(seats);
  await playSetup(seats);
  const { who, other, give, want } = await playToOffer(seats);
  await who.action('trade').click();
  await who.page.getByRole('tab', { name: 'Oyuncuyla' }).click();
  await who.page.locator(`.rtile[data-block="offer-give"][data-resource="${give}"]`).click();
  // ask for far more than the other can hold
  const askTile = who.page.locator(`.rtile[data-block="offer-want"][data-resource="${want}"]`);
  for (let i = 0; i < 9; i++) await askTile.click();
  await who.action('send-offer').click();
  await expect(who.page.locator('.offer-card.mine')).toHaveCount(1);
  await who.page.getByRole('button', { name: 'Kapat' }).click();
  await other.page.locator('.offer-banner').click();
  await expect(other.page.locator('[data-action="accept"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(other.page.locator('.sheet-foot .trade-note.off')).toContainText('Kabul edemezsin');
  await shot(other.page, '37-trade-cannot-accept', 'mobile');
  await other.page.getByRole('button', { name: 'Kapat' }).click();
  await who.action('trade').click();
  await who.page.locator('[data-action="withdraw"]').click();
  await expect(who.page.locator('.offer-card.mine')).toHaveCount(0);
  await expect(other.page.locator('.offer-banner')).toHaveCount(0);
});

test('a trade with the bank: pick what to give and get, read the sentence, trade, and the hand changes by the ratio', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar']);
  await startShort(seats);
  await playSetup(seats);
  let done = false;
  for (let turns = 0; turns < 80 && !done; turns++) {
    const who = await mover(seats);
    await who.action('roll').click();
    for (let i = 0; i < 20 && (await who.action('end').count()) === 0; i++) {
      let moved = false;
      for (const s of seats) moved = (await doForced(s)) || moved;
      if (!moved) await who.page.waitForTimeout(100);
    }
    await expect(who.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
    const before = await who.hand();
    await who.action('trade').click();
    const giveTile = who.page.locator('.rtile[data-block="give"][aria-disabled="false"]').first();
    if ((await giveTile.count()) > 0) {
      const giveRes = (await giveTile.getAttribute('data-resource'))!;
      const ratio = Number((await giveTile.locator('.rtile-badge').innerText()).split(':')[0]);
      await giveTile.click();
      await expect(giveTile).toHaveAttribute('aria-pressed', 'true');
      await expect(who.page.locator('.trade-summary')).toContainText('ne alacağını seç');
      // the tile of the same resource is off and says so
      await expect(who.page.locator(`.rtile[data-block="get"][data-resource="${giveRes}"] .rtile-sub`)).toHaveText('Aynı kaynak');
      const getTile = who.page.locator('.rtile[data-block="get"][aria-disabled="false"]').first();
      const getRes = (await getTile.getAttribute('data-resource'))!;
      await getTile.click();
      await expect(who.page.locator('.trade-summary')).toContainText(new RegExp(`^${ratio} .* verip 1 .* alırsın$`));
      await expect(who.action('bank-trade')).toHaveAttribute('aria-disabled', 'false');
      await shot(who.page, '31-trade-bank-chosen', 'mobile');
      await who.action('bank-trade').click();
      await expect(who.page.locator('.trade-summary')).toHaveText('Takas yapıldı.');
      const after = await who.hand();
      expect(after[giveRes]).toBe(before[giveRes] - ratio);
      expect(after[getRes]).toBe(before[getRes] + 1);
      done = true;
    }
    await who.page.getByRole('button', { name: 'Kapat' }).click();
    if (!done) {
      await who.action('end').click();
      await expect(who.action('end')).toHaveCount(0);
    }
  }
  expect(done, 'no player could trade with the bank in 80 turns').toBe(true);
});
