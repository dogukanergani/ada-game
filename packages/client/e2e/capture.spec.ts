import { expect, test } from '@playwright/test';
import { shot } from './helpers';
import { doForced, mover, newTable, playSetup, type Seat } from './table';

/**
 * The Soldier's capture, by hand-like taps. The server runs with ADA_TEST_RESOURCES=6, so both players start with
 * six cards of every resource and the capture can be afforded from the first turn.
 */

const playerId = (seat: Seat) => seat.page.evaluate(() => document.querySelector('.chip .tag')?.closest('.chip')?.getAttribute('data-player') ?? '');

async function startWithRoles(seats: Seat[]) {
  const [host, guest] = seats;
  await host.page.getByRole('button', { name: /^Asker/ }).click();
  await guest.page.getByRole('button', { name: /^Bilge/ }).click();
  await host.page.getByRole('radio', { name: /Kısa/ }).click();
  await host.page.getByRole('button', { name: 'Oyunu başlat' }).click();
  for (const s of seats) await s.page.locator('.game').waitFor();
}

/** Plays whole turns (roll, answer a 7, end) until it is `seat`'s turn and they have rolled; returns with the roll played out. */
async function untilTurnOf(seats: Seat[], seat: Seat) {
  for (let turns = 0; turns < 20; turns++) {
    const who = await mover(seats);
    if ((await who.action('roll').count()) > 0) await who.action('roll').click();
    for (let i = 0; i < 40 && (await who.action('end').count()) === 0; i++) {
      let moved = false;
      for (const s of seats) moved = (await doForced(s)) || moved;
      if (!moved) await who.page.waitForTimeout(100);
    }
    await expect(who.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
    if (who === seat) return;
    await who.action('end').click();
    await expect(who.action('end')).toHaveCount(0);
  }
  throw new Error('it never became the soldier\'s turn');
}

test('the Soldier captures a rival settlement: mode, target, preview, confirm, and both screens agree; the rival\'s last settlement is refused with its reason', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Asker', 'Rakip']);
  const [soldier, rival] = seats;
  await startWithRoles(seats);
  await playSetup(seats);
  const soldierId = await playerId(soldier);
  const rivalId = await playerId(rival);
  expect(soldierId).not.toBe(rivalId);

  await untilTurnOf(seats, soldier);
  // the test deal: every kind of card in hand
  const before = await soldier.hand();
  for (const n of Object.values(before)) expect(n).toBeGreaterThanOrEqual(3);

  // ---- capture mode ----
  await soldier.action('capture').click();
  await expect(soldier.page.locator('.hint').first()).toContainText('Ele geçirmek istediğin');
  await expect(soldier.page.locator('.capture .legend')).toContainText('Seçilebilir');
  await expect(soldier.action('confirm')).toHaveAttribute('aria-disabled', 'true');
  await shot(soldier.page, '40-capture-mode', 'mobile');

  // ---- target and preview: a rival settlement ----
  const target = soldier.page.locator('.spot-piece[data-valid="true"][aria-label^="yerleşim"]').first();
  await expect(target).toBeVisible();
  const label = (await target.getAttribute('aria-label'))!;
  const vertex = Number(label.split(' ')[1]);
  await soldier.tap(`.spot-piece[aria-label="${label}"]`);
  const panel = soldier.page.locator('.capture[data-state="ok"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Maliyet: 2 koyun, 2 buğday, 3 cevher');
  const deltas = panel.locator('.points-delta li');
  await expect(deltas).toHaveCount(2);
  await expect(deltas.filter({ hasText: 'Asker: 2 → 3 puan' })).toHaveCount(1);
  await expect(deltas.filter({ hasText: 'Rakip: 2 → 1 puan' })).toHaveCount(1);
  await expect(soldier.action('confirm')).toHaveAttribute('aria-disabled', 'false');
  await shot(soldier.page, '41-capture-preview', 'mobile');

  // ---- confirm: the result is the same on both screens ----
  await soldier.confirm();
  for (const s of seats) {
    await expect(s.page.locator(`.building[data-vertex="${vertex}"]`)).toHaveAttribute('data-owner', soldierId);
    await expect(s.page.locator('.last-text')).toContainText('ele geçirdi');
    await expect(s.page.locator(`.chip[data-player="${soldierId}"] .chip-points`)).toContainText('3 puan');
    await expect(s.page.locator(`.chip[data-player="${rivalId}"] .chip-points`)).toContainText('1 puan');
  }
  const after = await soldier.hand();
  expect(after.ore).toBe(before.ore - 3);
  expect(after.wool).toBe(before.wool - 2);
  expect(after.grain).toBe(before.grain - 2);
  // once per turn: the capture button is now off
  await expect(soldier.action('capture')).toHaveAttribute('aria-disabled', 'true');
  await shot(rival.page, '42-capture-result-rival', 'mobile');
  await shot(soldier.page, '43-capture-result-soldier', 'mobile');

  // ---- next round: the rival has one settlement left, and it cannot be taken ----
  await soldier.action('end').click();
  await expect(soldier.action('end')).toHaveCount(0);
  await untilTurnOf(seats, soldier);
  await soldier.action('capture').click();
  const last = soldier.page.locator('.spot-piece[data-valid="false"][aria-label^="yerleşim"]').first();
  await expect(last).toBeVisible();
  await soldier.tap(`.spot-piece[aria-label="${await last.getAttribute('aria-label')}"]`);
  await expect(soldier.page.locator('.capture [role="alert"]')).toContainText('Bu hedef seçilemez.');
  await expect(soldier.page.locator('.capture [role="alert"]')).toContainText('son yerleşimi ya da şehri ele geçirilemez');
  await expect(soldier.action('confirm')).toHaveAttribute('aria-disabled', 'true');
  await shot(soldier.page, '44-capture-refused', 'mobile');
  // the refused piece changed nothing on the rival's screen
  await expect(rival.page.locator(`.chip[data-player="${rivalId}"] .chip-points`)).toContainText('1 puan');
});
