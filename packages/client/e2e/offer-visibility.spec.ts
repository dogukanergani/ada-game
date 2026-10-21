import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, MOBILE, SMALL } from './helpers';
import { doForced, mover, newTable, playSetup, startShort, type Seat } from './table';

/**
 * A trade offer must reach the other player's screen, whatever that screen is
 * doing: idle, while the dice tumble, after they stopped, or with a sheet open.
 * Runs on both servers (the usual one, and the one that deals every player
 * cards, project "offers-res").
 */
const viewports = [
  { label: 'desktop', viewport: DESKTOP },
  { label: 'mobile', viewport: MOBILE },
  { label: 'small', viewport: SMALL },
];

/** the recipient's page runs its timers slowly, so the dice are still tumbling when the offer arrives */
const slowTimers = (page: Page) =>
  void page.addInitScript(() => {
    const real = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => real(fn, ms !== undefined && ms >= 400 && ms <= 1500 ? ms * 12 : ms, ...rest)) as typeof window.setTimeout;
  });

/** rolls for the mover and answers whatever a 7 asks, until the mover is in the main phase */
async function rollToMain(seats: Seat[], who: Seat) {
  await who.action('roll').click();
  for (let i = 0; i < 30 && (await who.action('end').count()) === 0; i++) {
    let moved = false;
    for (const s of seats) moved = (await doForced(s)) || moved;
    if (!moved) await who.page.waitForTimeout(100);
  }
}

/** a resource the sender holds, and one the other holds and the sender does not (read from the screens) */
async function pairFor(who: Seat, other: Seat): Promise<{ give: string; want: string } | null> {
  const mine = await who.hand();
  const theirs = await other.hand();
  const give = Object.keys(mine).find((r) => mine[r] > 0);
  const want = Object.keys(theirs).find((r) => theirs[r] > 0 && r !== give);
  return give && want ? { give, want } : null;
}

/** plays turns until seat 0 is in the main phase holding something seat 1 lacks and the other way round; returns what to offer */
async function toOfferMoment(seats: Seat[]): Promise<{ give: string; want: string }> {
  for (let turns = 0; turns < 60; turns++) {
    const who = await mover(seats);
    await rollToMain(seats, who);
    if (who === seats[0]) {
      const pair = await pairFor(who, seats[1]);
      if (pair) return pair;
    }
    await who.action('end').click();
    await expect(who.action('end')).toHaveCount(0);
  }
  throw new Error('the players never held cards the other lacked');
}

async function sendOffer(who: Seat, give: string, want: string) {
  await who.action('trade').click();
  await who.page.getByRole('tab', { name: 'Oyuncuyla' }).click();
  await who.page.locator(`.rtile[data-block="offer-give"][data-resource="${give}"]`).click();
  await who.page.locator(`.rtile[data-block="offer-want"][data-resource="${want}"]`).click();
  await who.action('send-offer').click();
  await expect(who.page.locator('.offer-card.mine')).toBeVisible();
  await who.page.getByRole('button', { name: 'Kapat' }).click();
}

type Scenario = 'idle' | 'tumbling' | 'afterDice' | 'bankSheetOpen' | 'costsSheetOpen';
const scenarios: Scenario[] = ['idle', 'tumbling', 'afterDice', 'bankSheetOpen', 'costsSheetOpen'];

for (const { label, viewport } of viewports) {
  for (const scenario of scenarios) {
    test(`an offer reaches the other player: ${scenario}, recipient ${label} (${viewport.width}x${viewport.height})`, async ({ browser }, info) => {
      const slow = scenario === 'tumbling';
      const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport, (page, i) => {
        if (slow && i === 1) slowTimers(page);
      });
      await startShort(seats);
      await playSetup(seats);
      // seat 0 makes the offer, seat 1 (the slow-timer page, the viewport under test) receives it
      const who = seats[0];
      const other = seats[1];
      const pair = await toOfferMoment(seats);
      if (scenario === 'afterDice') await expect(other.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
      const stage = await other.page.locator('.dice-tray').first().getAttribute('data-stage');

      if (scenario === 'bankSheetOpen') {
        await other.action('trade').click();
        await expect(other.page.getByRole('tab', { name: 'Bankayla' })).toHaveAttribute('aria-selected', 'true');
      }
      if (scenario === 'costsSheetOpen') await other.action('costs').click();

      await sendOffer(who, pair.give, pair.want);

      // what the recipient sees: the notice on whatever they are looking at, the count on the trade button and in the tab title
      const bar = other.page.locator('.offer-banner');
      await expect(bar).toHaveCount(1);
      await expect(bar).toBeVisible();
      await expect(other.action('trade').first()).toContainText('1 teklif');
      await expect(other.page).toHaveTitle('(1) Ada');
      if (scenario === 'bankSheetOpen' || scenario === 'costsSheetOpen') await expect(other.page.getByRole('dialog').locator('.offer-banner')).toBeVisible();

      // one tap on the notice leads to the offer itself, which can be accepted: both sides trade
      await bar.click();
      await expect(other.page.getByRole('tab', { name: 'Oyuncuyla' })).toHaveAttribute('aria-selected', 'true');
      await expect(other.page.locator('.offer-card:not(.mine)')).toBeVisible();
      await expect(other.page.locator('.offer-banner')).toHaveCount(0); // the sheet already shows the offer
      // the counts on screen are held back while the dice tumble: read them once both pages are at rest
      for (const x of seats) await expect(x.page.locator('.dice-tray').first()).toHaveAttribute('data-stage', 'still');
      const before = { me: await who.hand(), you: await other.hand() };
      await other.action('accept').click();
      await expect(other.page.getByRole('dialog')).toHaveCount(1);
      await expect(other.page).toHaveTitle('Ada');
      await other.page.getByRole('button', { name: 'Kapat' }).click();
      await expect(async () => {
        const after = { me: await who.hand(), you: await other.hand() };
        // the receiver gets what was offered and gives what was asked; the sender gets at least what they asked (a role bonus may add a random card)
        expect(after.you[pair.give] ?? 0).toBe((before.you[pair.give] ?? 0) + 1);
        expect(after.you[pair.want] ?? 0).toBe(before.you[pair.want] - 1);
        expect(after.me[pair.want] ?? 0).toBeGreaterThanOrEqual((before.me[pair.want] ?? 0) + 1);
        expect(after.me[pair.give] ?? 0).toBeLessThanOrEqual(before.me[pair.give]);
      }).toPass();
      void stage;
    });
  }
}
