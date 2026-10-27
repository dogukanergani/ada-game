import { expect, test } from './test';
import { DESKTOP, MOBILE, SMALL, openPlayer, shot } from './helpers';

/** what the browser offers, decided before the page loads */
const support = (vibrate: boolean, fullscreen: boolean) => (page: import('@playwright/test').Page) =>
  void page.addInitScript(
    ([v, f]) => {
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: v ? () => true : undefined });
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => f });
    },
    [vibrate, fullscreen] as const,
  );

const open = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Ayarlar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ayarlar' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test('settings: the sound switch and volume work, music is off with "Yakında", and the choices survive a reload', async ({ browser }) => {
  const { page } = await openPlayer(browser, MOBILE, 'tr-TR', support(false, false));
  let dialog = await open(page);
  const sfx = dialog.locator('[data-setting="sfx"]');
  const volume = dialog.locator('[data-setting="volume"]');
  await expect(sfx).toHaveAttribute('aria-checked', 'true');
  await expect(volume).toHaveValue('60');
  await expect(dialog.locator('[data-setting="music"]')).toBeDisabled();
  await expect(dialog.getByText('Yakında')).toBeVisible();

  await volume.fill('25');
  await sfx.click();
  await expect(sfx).toHaveAttribute('aria-checked', 'false');
  await expect(volume).toBeDisabled();
  expect(await page.evaluate(() => [localStorage.getItem('ada.sfx'), localStorage.getItem('ada.volume')])).toEqual(['0', '25']);

  await page.reload();
  dialog = await open(page);
  await expect(dialog.locator('[data-setting="sfx"]')).toHaveAttribute('aria-checked', 'false');
  await expect(dialog.locator('[data-setting="volume"]')).toHaveValue('25');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('settings: vibration and full screen show only where the browser has them, each on its own', async ({ browser }) => {
  const none = await openPlayer(browser, MOBILE, 'tr-TR', support(false, false));
  let dialog = await open(none.page);
  await expect(dialog.locator('[data-setting="vibrate"]')).toHaveCount(0);
  await expect(dialog.locator('[data-action="fullscreen"]')).toHaveCount(0);

  const vibrateOnly = await openPlayer(browser, MOBILE, 'tr-TR', support(true, false));
  dialog = await open(vibrateOnly.page);
  const vibrate = dialog.locator('[data-setting="vibrate"]');
  await expect(vibrate).toHaveAttribute('aria-checked', 'false'); // off until the player turns it on
  await expect(dialog.locator('[data-action="fullscreen"]')).toHaveCount(0);
  await vibrate.click();
  await expect(vibrate).toHaveAttribute('aria-checked', 'true');
  await vibrateOnly.page.reload();
  dialog = await open(vibrateOnly.page);
  await expect(dialog.locator('[data-setting="vibrate"]')).toHaveAttribute('aria-checked', 'true');

  const fullOnly = await openPlayer(browser, MOBILE, 'tr-TR', support(false, true));
  dialog = await open(fullOnly.page);
  await expect(dialog.locator('[data-setting="vibrate"]')).toHaveCount(0);
  await expect(dialog.locator('[data-action="fullscreen"]')).toBeVisible();
});

test('settings: the full screen button follows fullscreenchange (label and aria-pressed)', async ({ browser }) => {
  const { page } = await openPlayer(browser, DESKTOP, 'tr-TR', (p) =>
    void p.addInitScript(() => {
      let el: Element | null = null;
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
      Element.prototype.requestFullscreen = async () => {
        el = document.documentElement;
        document.dispatchEvent(new Event('fullscreenchange'));
      };
      document.exitFullscreen = async () => {
        el = null;
        document.dispatchEvent(new Event('fullscreenchange'));
      };
    }),
  );
  const dialog = await open(page);
  const button = dialog.locator('[data-action="fullscreen"]');
  await expect(button).toHaveText('Tam ekrana gir');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveText('Tam ekrandan çık');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveText('Tam ekrana gir');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

for (const [size, viewport] of [['mobile', MOBILE], ['small', SMALL], ['desktop', DESKTOP]] as const) {
  test(`screenshots of the extended settings (${size})`, async ({ browser }) => {
    const { page } = await openPlayer(browser, viewport, 'tr-TR', support(true, true));
    await open(page);
    await shot(page, '44-settings-extended', size);
  });
}
