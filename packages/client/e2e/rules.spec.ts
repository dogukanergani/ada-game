import { expect, test } from './test';
import { DESKTOP, MOBILE, SMALL, openPlayer, shot } from './helpers';
import { mover, newTable, playSetup, startShort } from './table';

test('home: two clear actions, the gear and the rules link; the rules open without a player and close again', async ({ browser }) => {
  const { page } = await openPlayer(browser, MOBILE);
  await expect(page.getByRole('heading', { name: 'Ada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Oda kur' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Katıl' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ayarlar' })).toBeVisible();
  await page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nasıl oynanır?' });
  await expect(dialog).toBeVisible();
  for (const section of ['loop', 'roles', 'cards', 'score', 'costs']) await expect(dialog.locator(`[data-rules="${section}"]`)).toBeAttached();
  await expect(dialog.locator('[data-role]')).toHaveCount(5);
  await expect(dialog.locator('[data-cost="city"]')).toContainText('3 cevher');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Adın')).toBeVisible();
});

test('settings: switching the language, and forgetting the identity really starts over', async ({ browser }) => {
  const { page } = await openPlayer(browser, MOBILE);
  const token = () => page.evaluate(() => localStorage.getItem('ada.token'));
  await expect.poll(token).not.toBeNull();
  const before = await token();

  await page.getByRole('button', { name: 'Ayarlar' }).click();
  await page.getByRole('dialog', { name: 'Ayarlar' }).getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Türkçe' }).click();
  await page.keyboard.press('Escape');

  // in a room, with a saved name
  await page.getByLabel('Adın').fill('Deniz');
  await page.getByRole('button', { name: 'Oda kur' }).click();
  await expect(page.getByRole('heading', { name: 'Lobi' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ada.name'))).toBe('Deniz');

  await page.getByRole('button', { name: 'Ayarlar' }).click();
  const forget = page.getByRole('dialog').locator('[data-action="forget-identity"]');
  await forget.click();
  await expect(forget).toHaveAttribute('data-sure', 'true'); // the first tap only asks
  await expect(page.getByRole('heading', { name: 'Lobi' })).toBeVisible();
  await forget.click();

  await expect(page.getByRole('heading', { name: 'Ada' })).toBeVisible();
  await expect(page.getByLabel('Adın')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Lobi' })).toHaveCount(0);
  await expect.poll(token).not.toBeNull();
  expect(await token()).not.toBe(before);
  expect(await page.evaluate(() => localStorage.getItem('ada.name'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('ada.locale'))).toBe('tr');
});

test('in the lobby and in a game the rules open and close without touching it', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ada', 'Bora', 'Cem']);
  const [host] = seats;
  await host.page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
  await expect(host.page.getByRole('dialog', { name: 'Nasıl oynanır?' })).toBeVisible();
  await host.page.getByRole('button', { name: 'Kapat' }).click();
  await expect(host.page.getByRole('heading', { name: 'Lobi' })).toBeVisible();

  await startShort(seats);
  await playSetup(seats);
  const seat = await mover(seats);
  const snapshot = async () => ({
    phase: await seat.page.locator('.game').getAttribute('data-phase'),
    hand: await seat.hand(),
    hint: await seat.page.locator('p.hint').first().innerText(),
    log: await seat.page.locator('.game-log li').count(),
    actions: await seat.page.locator('[data-action]').evaluateAll((e) => e.map((x) => `${x.getAttribute('data-action')}:${x.getAttribute('aria-disabled')}`)),
  });
  const phases = () => Promise.all(seats.filter((s) => s !== seat).map((s) => s.page.locator('.game').getAttribute('data-phase')));
  const before = await snapshot();
  const others = await phases();

  await seat.page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
  const dialog = seat.page.getByRole('dialog', { name: 'Nasıl oynanır?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-role]')).toHaveCount(5);
  await shot(seat.page, '31-rules-in-game', 'mobile');
  await seat.page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await seat.page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
  await seat.page.getByRole('dialog').getByRole('button', { name: 'Kapat' }).click();

  expect(await snapshot()).toEqual(before);
  expect(await phases()).toEqual(others);
  await expect(seat.action('roll').or(seat.action('end')).first()).toBeVisible(); // the player can still act exactly as before
});

for (const [size, viewport] of [['mobile', MOBILE], ['small', SMALL], ['desktop', DESKTOP]] as const) {
  test(`screenshots of the new home, settings and rules (${size})`, async ({ browser }) => {
    const { page } = await openPlayer(browser, viewport);
    await expect(page.getByRole('heading', { name: 'Ada' })).toBeVisible();
    await shot(page, '30-home', size);
    await page.getByRole('button', { name: 'Ayarlar' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, '30-settings', size);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, '30-rules', size);
  });
}

test('in a game: the clock counts from the start and survives a refresh; the deck info lists the deck; the Soldier sees what demolishing costs', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ada', 'Bora', 'Cem']);
  const [host] = seats;
  await host.page.getByRole('button', { name: /Asker/ }).click(); // the Soldier
  await host.page.getByRole('button', { name: /Asker/ }).and(host.page.locator('[aria-pressed="true"]')).waitFor();
  await startShort(seats);
  await playSetup(seats);

  // the clock: whole minutes since the start, in the top row; the same after a refresh (the server tells it)
  const clock = host.page.locator('.game-top .game-clock');
  await expect(clock).toHaveText(/^\d+ dk$/);
  const minutes = Number(await clock.getAttribute('data-clock'));
  expect(minutes).toBeLessThan(5);
  await host.page.reload();
  await host.page.locator('.game').waitFor();
  const afterRefresh = Number(await host.page.locator('.game-top .game-clock').getAttribute('data-clock'));
  expect(afterRefresh).toBeGreaterThanOrEqual(minutes);
  expect(afterRefresh).toBeLessThan(5);
  await shot(host.page, '32-game-top-clock', 'mobile');

  // the deck info beside "Kart al"
  await host.page.locator('[data-action="deck-info"]').first().click();
  const deck = host.page.getByRole('dialog', { name: 'Gelişim destesi' });
  await expect(deck.locator('[data-deck="contents"]')).toHaveText('25 kart: 14 Şövalye, 5 Zafer puanı, 2 Yol inşası, 2 Bolluk yılı, 2 Tekel.');
  await expect(deck.locator('[data-deck="left"]')).toContainText('25');
  await shot(host.page, '32-deck-info', 'mobile');
  await host.page.keyboard.press('Escape');
  await expect(deck).toHaveCount(0);

  // the Soldier's demolition prices: in the Costs sheet and in the rules
  await host.action('costs').click();
  const costs = host.page.getByRole('dialog', { name: 'Maliyetler' });
  for (const kind of ['road', 'settlement', 'city']) await expect(costs.locator(`[data-cost="demolish:${kind}"]`)).toBeVisible();
  await expect(costs.locator('[data-cost="demolish:city"]')).toContainText('3 cevher');
  await shot(host.page, '32-costs-soldier', 'mobile');
  await host.page.keyboard.press('Escape');
  await host.page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
  const rules = host.page.getByRole('dialog', { name: 'Nasıl oynanır?' });
  await expect(rules.locator('[data-cost="demolish:settlement"]')).toHaveCount(1);
  await expect(rules.locator('[data-rules="win"]')).toContainText('toplam 7 puana'); // short game: the real target
  await rules.locator('[data-rules="score"]').scrollIntoViewIfNeeded();
  await shot(host.page, '32-rules-score-in-game', 'mobile');

  // another role sees no demolition rows in the Costs sheet
  const other = seats[1];
  await other.page.keyboard.press('Escape');
  await other.action('costs').click();
  await expect(other.page.getByRole('dialog', { name: 'Maliyetler' }).locator('[data-action-costs]')).toHaveCount(0);
});

test('the rules from the home screen tell both targets', async ({ browser }) => {
  const { page } = await openPlayer(browser, MOBILE);
  await page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
  await expect(page.locator('[data-rules="win"]')).toHaveText('Sırası gelen oyuncu toplam puanı standart modda 10, kısa modda 7 olduğunda oyunu kazanır.');
});
