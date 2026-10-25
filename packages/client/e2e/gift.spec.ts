import { expect, test } from './test';
import { DESKTOP, MOBILE, SMALL, shot } from './helpers';
import { newTable, playSetup, playToOffer, startShort } from './table';

const sizes = [
  { label: 'mobile' as const, viewport: MOBILE },
  { label: 'small' as const, viewport: SMALL },
  { label: 'desktop' as const, viewport: DESKTOP },
];

const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const sum = (h: Record<string, number>) => RES.reduce((n, r) => n + (h[r] ?? 0), 0);

for (const { label, viewport } of sizes) {
  test(`a gift: giving a card for nothing, offered, read and accepted, ${label} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
    const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport);
    await startShort(seats);
    await playSetup(seats);
    const { who, other, give, mine } = await playToOffer(seats);
    const otherBefore = await other.hand();
    await who.action('trade').click();
    await who.page.getByRole('tab', { name: 'Oyuncuyla' }).click();
    // only the "you give" side is filled; the other side stays empty
    await who.page.locator(`.rrow[data-block="offer-give"][data-resource="${give}"]`).click();
    await expect(who.page.locator('.trade-summary')).toContainText(/^Karşılıksız 1 .* verirsin$/);
    await expect(who.page.locator('.rrow-count')).toHaveCount(1);
    await expect(who.action('send-offer')).toHaveAttribute('aria-disabled', 'false');
    await shot(who.page, '38-trade-gift', label);
    await who.action('send-offer').click();
    await expect(who.page.locator('.offer-card.mine .exchange[data-kind="gift"]')).toContainText('Karşılıksız verir');
    await who.page.getByRole('button', { name: 'Kapat' }).click();

    await other.page.locator('.offer-banner').click();
    const card = other.page.locator('.offer-card:not(.mine)');
    await expect(card.locator('.exchange[data-kind="gift"]')).toContainText('Karşılıksız verir');
    // there is nothing to pay, so accepting is on
    await expect(other.page.locator('[data-action="accept"]')).toHaveAttribute('aria-disabled', 'false');
    await shot(other.page, '39-trade-gift-incoming', label);
    await other.page.locator('[data-action="accept"]').click();
    await expect(other.page.locator('.offer-card')).toHaveCount(0);
    await other.page.getByRole('button', { name: 'Kapat' }).click();
    // one card moved from the giver to the accepter and nothing came back
    await expect.poll(async () => (await other.hand())[give] ?? 0).toBe((otherBefore[give] ?? 0) + 1);
    await expect.poll(async () => (await who.hand())[give] ?? 0).toBe((mine[give] ?? 0) - 1);
    expect(sum(await who.hand())).toBe(sum(mine) - 1);
    await expect(other.page.locator('.last-text, .log-list').first()).toContainText(/karşılıksız/i);
  });
}

test('asking for a gift: only the "you ask" side is filled, the accepter pays and the offerer gives nothing', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar']);
  await startShort(seats);
  await playSetup(seats);
  const { who, other, want, mine } = await playToOffer(seats);
  const otherBefore = await other.hand();
  await who.action('trade').click();
  await who.page.getByRole('tab', { name: 'Oyuncuyla' }).click();
  await who.page.locator(`.rrow[data-block="offer-want"][data-resource="${want}"]`).click();
  await expect(who.page.locator('.trade-summary')).toContainText(/^Karşılıksız 1 .* istersin$/);
  await shot(who.page, '40-trade-ask', 'mobile');
  await who.action('send-offer').click();
  await expect(who.page.locator('.offer-card.mine .exchange[data-kind="ask"]')).toContainText('Karşılıksız ister');
  await who.page.getByRole('button', { name: 'Kapat' }).click();
  await other.page.locator('.offer-banner').click();
  await expect(other.page.locator('.offer-card:not(.mine) .exchange[data-kind="ask"]')).toContainText('Karşılıksız ister');
  await shot(other.page, '41-trade-ask-incoming', 'mobile');
  await other.page.locator('[data-action="accept"]').click();
  await other.page.getByRole('button', { name: 'Kapat' }).click();
  await expect.poll(async () => (await who.hand())[want] ?? 0).toBe((mine[want] ?? 0) + 1);
  await expect.poll(async () => (await other.hand())[want] ?? 0).toBe((otherBefore[want] ?? 0) - 1);
});
