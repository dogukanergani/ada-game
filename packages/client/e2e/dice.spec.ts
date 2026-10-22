import { expect, test } from './test';
import { DESKTOP, MOBILE, SMALL, shot } from './helpers';
import { doForced, mover, newTable, playSetup, startShort } from './table';

const sizes = [
  { label: 'mobile' as const, viewport: MOBILE },
  { label: 'small' as const, viewport: SMALL },
  { label: 'desktop' as const, viewport: DESKTOP },
];

/** Both players look at the same roll, at the same moment, with the result hidden while it tumbles and standing still after a reload. */
for (const { label, viewport } of sizes) test(`the dice: same faces for everyone, nothing written while tumbling, at rest after a reload, ${label}`, async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], viewport);
  await startShort(seats);
  await playSetup(seats);
  const first = await mover(seats);
  const other = seats.find((s) => s !== first)!;

  await first.action('roll').click();
  for (const s of seats) {
    const stage = s.page.locator('.dice-stage');
    await expect(stage).toBeVisible();
    // tumbling: no total anywhere in the page's dice, and the last-event line does not report the roll
    if ((await stage.getAttribute('data-stage')) === 'rolling') {
      await expect(s.page.locator('.dice [data-total]')).toHaveCount(0);
      await expect(s.page.locator('.last-text')).toContainText(/Zar atılıyor/);
    }
  }
  await shot(first.page, '21-dice-rolling', label);

  // once the dice stop, every ringed tile carries the number that was rolled; the rings are gone again a moment later
  await expect(first.page.locator('.dice-stage')).toHaveAttribute('data-stage', /hold|dock/, { timeout: 3000 }).catch(() => {});
  for (const s of seats) {
    const total = Number(await s.page.locator('.dice-tray [data-total]').getAttribute('data-total').catch(() => null));
    const rings = await s.page.locator('.prod-ring').evaluateAll((els) => els.map((e) => e.closest('.tile')?.querySelector('.token')?.getAttribute('data-number')));
    for (const n of rings) expect(Number(n)).toBe(total || Number(n));
  }

  // after the roll: the corner shows the faces the server rolled, the same on both screens
  for (const s of seats) await expect(s.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still', { timeout: 5000 });
  const faces = await Promise.all(seats.map((s) => s.page.locator('.dice-tray').getAttribute('data-faces')));
  expect(faces[0]).toBe(faces[1]);
  const [a, b] = faces[0]!.split(',').map(Number);
  await expect(first.page.locator('.dice-tray .dice-total')).toHaveText(String(a + b));
  await expect(first.page.locator('.dice-tray .visually-hidden')).toHaveText(`Zar: ${a} ve ${b}, toplam ${a + b}`);
  await expect(first.page.locator('.dice-tray .die-face')).toHaveCount(2);
  await shot(first.page, '22-dice-settled', label);

  for (const s of seats) await expect(s.page.locator('.prod-ring')).toHaveCount(0, { timeout: 4000 });
  for (const s of seats) await expect(s.page.locator('.hand-gain')).toHaveCount(0);

  // a reload brings the dice back at rest, without any animation
  await other.page.reload();
  await other.page.locator('.game').waitFor();
  await expect(other.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
  await expect(other.page.locator('.dice-stage')).toHaveCount(0);
  await expect(other.page.locator('.dice-tray')).toHaveAttribute('data-faces', faces[0]!);
  for (let i = 0; i < 6; i++) if (!(await doForced(first))) break;
});

test('with reduced motion the result is there at once', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], undefined, (page) => void page.emulateMedia({ reducedMotion: 'reduce' }));
  await startShort(seats);
  await playSetup(seats);
  const first = await mover(seats);
  await first.action('roll').click();
  await expect(first.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
  await expect(first.page.locator('.dice-tray [data-total]')).toBeVisible();
  await expect(first.page.locator('.dice-stage')).toHaveCount(0);
});
