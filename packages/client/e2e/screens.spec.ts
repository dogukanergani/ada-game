import { expect, test } from './test';
import { DESKTOP, MOBILE, openPlayer, shot } from './helpers';

for (const [size, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]] as const) {
  test(`home and lobby look right (${size})`, async ({ browser }) => {
    const a = await openPlayer(browser, viewport);
    await expect(a.page.getByRole('heading', { name: 'Ada' })).toBeVisible();
    await shot(a.page, '01-home', size);
    await a.page.getByLabel('Adın').fill('Şükrü Iğdır');
    await a.page.getByRole('button', { name: 'Oda kur' }).click();
    await expect(a.page.getByRole('heading', { name: 'Lobi' })).toBeVisible();
    const b = await openPlayer(browser, viewport);
    const code = (await a.page.locator('.code-letters').innerText()).trim();
    await b.page.getByLabel('Adın').fill('Çağla İpek');
    await b.page.getByLabel('Oda kodu').fill(code);
    await b.page.getByRole('button', { name: 'Katıl' }).click();
    await expect(b.page.getByRole('heading', { name: 'Lobi' })).toBeVisible();
    await a.page.getByRole('button', { name: /Bilge/ }).click();
    await b.page.getByRole('button', { name: /Bilge/ }).waitFor();
    await shot(a.page, '02-lobby', size);
    await a.context.close();
    await b.context.close();
  });
}
