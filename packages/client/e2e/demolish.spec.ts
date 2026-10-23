import { expect, test } from './test';
import { shot } from './helpers';
import { doForced, mover, newTable, playSetup, type Seat } from './table';

/**
 * The Soldier's demolition, by hand-like taps. The server runs with ADA_TEST_RESOURCES=6, so both players start with
 * six cards of every resource and a demolition can be afforded from the first turn.
 */

const playerId = (seat: Seat) => seat.page.evaluate(() => document.querySelector('.pseat[data-me="true"]')?.getAttribute('data-player') ?? '');

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

test('the Soldier demolishes a rival settlement and then a road: mode, target, preview, confirm, both screens agree; the rival\'s last settlement is refused with its own reason', async ({ browser }) => {
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

  // ---- demolish mode ----
  await soldier.action('demolish').click();
  await expect(soldier.page.locator('.hint').first()).toContainText('Yıkmak istediğin');
  await expect(soldier.page.locator('.demolish .legend')).toContainText('Seçilebilir');
  await expect(soldier.action('confirm')).toHaveAttribute('aria-disabled', 'true');
  await shot(soldier.page, '40-demolish-mode', 'mobile');

  // ---- target and preview: a rival settlement ----
  const target = soldier.page.locator('.spot-piece[data-valid="true"][aria-label^="yerleşim"]').first();
  await expect(target).toBeVisible();
  const label = (await target.getAttribute('aria-label'))!;
  const vertex = Number(label.split(' ')[1]);
  await soldier.tap(`.spot-piece[aria-label="${label}"]`);
  const panel = soldier.page.locator('.demolish[data-state="ok"]');
  await expect(panel).toBeVisible();
  // one sentence: the effect on the rival and the price (all from the server)
  await expect(panel.locator('.demolish-sentence')).toHaveText('Rakip oyuncusunun yerleşimi yıkılır, 1 puan kaybeder. · bedel: 1 koyun, 1 buğday, 2 cevher');
  // only the rival's points change: the Soldier gains nothing
  const deltas = panel.locator('.points-delta li');
  await expect(deltas).toHaveCount(1);
  await expect(deltas.first()).toHaveText('Rakip: 2 → 1 puan');
  await expect(soldier.action('confirm')).toHaveAttribute('aria-disabled', 'false');
  await shot(soldier.page, '41-demolish-preview', 'mobile');

  // ---- confirm: the result is the same on both screens ----
  await soldier.confirm();
  for (const s of seats) {
    await expect(s.page.locator(`.building[data-vertex="${vertex}"]`)).toHaveCount(0);
    await expect(s.page.locator('.last-text')).toContainText('bir yerleşimini yıktı');
    await expect(s.page.locator(`.pseat[data-player="${soldierId}"] .pseat-points`)).toHaveText(/^2\b/);
    await expect(s.page.locator(`.pseat[data-player="${rivalId}"] .pseat-points`)).toHaveText(/^1\b/);
  }
  const after = await soldier.hand();
  expect(after.ore).toBe(before.ore - 2);
  expect(after.wool).toBe(before.wool - 1);
  expect(after.grain).toBe(before.grain - 1);
  // once per turn: the button is now off
  await expect(soldier.action('demolish')).toHaveAttribute('aria-disabled', 'true');
  await shot(rival.page, '42-demolish-result-rival', 'mobile');
  await shot(soldier.page, '43-demolish-result-soldier', 'mobile');

  // ---- next round: the rival has one settlement left, and it cannot be demolished ----
  await soldier.action('end').click();
  await expect(soldier.action('end')).toHaveCount(0);
  await untilTurnOf(seats, soldier);
  await soldier.action('demolish').click();
  const last = soldier.page.locator('.spot-piece[data-valid="false"][aria-label^="yerleşim"]').first();
  await expect(last).toBeVisible();
  await soldier.tap(`.spot-piece[aria-label="${await last.getAttribute('aria-label')}"]`);
  // its own reason (the rival's last building), not a general "cannot"
  await expect(soldier.page.locator('.demolish [role="alert"]')).toHaveText('Rakip oyuncusunun son yapısı yıkılamaz. Başka bir hedef seç.');
  await expect(soldier.action('confirm')).toHaveAttribute('aria-disabled', 'true');
  await shot(soldier.page, '44-demolish-refused', 'mobile');
  // the refused piece changed nothing on the rival's screen
  await expect(rival.page.locator(`.pseat[data-player="${rivalId}"] .pseat-points`)).toHaveText(/^1\b/);

  // ---- and a road can go ----
  const road = soldier.page.locator('.spot-piece[data-valid="true"][aria-label^="yol"]').first();
  // an upright road has a bounding box of no width, which the browser test takes for "not visible": it is drawn, so check it is there
  await expect(road).toBeAttached();
  const roadLabel = (await road.getAttribute('aria-label'))!;
  const edge = Number(roadLabel.split(' ')[1]);
  await soldier.tap(`.spot-piece[aria-label="${roadLabel}"]`);
  await expect(panel.locator('.demolish-sentence')).toHaveText('Rakip oyuncusunun bir yolu yıkılır. · bedel: 1 koyun, 1 cevher');
  await soldier.confirm();
  for (const s of seats) {
    await expect(s.page.locator(`.road[data-edge="${edge}"]`)).toHaveCount(0);
    await expect(s.page.locator('.last-text')).toContainText('bir yolunu yıktı');
  }
});
