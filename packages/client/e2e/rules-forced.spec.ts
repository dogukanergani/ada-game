import { expect, test } from './test';
import { doForced, mover, newTable, playSetup, startShort, type Seat } from './table';

/** What every player's screen shows: phase, the hint line, the buttons and the open dialogs. For a failure message. */
async function stuckInfo(seats: Seat[], turn: number): Promise<string> {
  const lines = await Promise.all(
    seats.map(async (s) => {
      const phase = await s.page.locator('.game').getAttribute('data-phase').catch(() => '?');
      const hint = await s.page.locator('p.hint').first().innerText().catch(() => '?');
      const actions = await s.page.locator('[data-action]').evaluateAll((e) => e.map((x) => `${x.getAttribute('data-action')}${x.getAttribute('aria-disabled') === 'true' ? '(off)' : ''}`)).catch(() => []);
      const dialogs = await s.page.getByRole('dialog').evaluateAll((e) => e.map((x) => x.getAttribute('aria-label') ?? x.textContent?.slice(0, 30))).catch(() => []);
      return `${s.name}: phase=${phase} hint="${hint}" actions=${actions.join(',')} dialogs=${dialogs.join('|')}`;
    }),
  );
  return `turn ${turn}, "end" is not on: ${lines.join(' || ')}`;
}

/**
 * Settings and the rules never cover a sheet the game forces open. Every player holds 24 cards on this server,
 * so any 7 makes everyone discard; the test plays turns until one comes.
 */
test('while a discard is due the gear and the "?" are off and open nothing; a rules sheet left open is closed when the duty appears', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ada', 'Bora', 'Cem']);
  await startShort(seats);
  await playSetup(seats);

  let due: Seat | null = null;
  for (let turn = 0; turn < 60 && !due; turn++) {
    const roller = await mover(seats);
    if ((await roller.action('roll').count()) === 0) {
      // a turn that is not at the dice must be at "end"; if that button does not come on, say what the screen holds
      // instead of waiting out the test's whole timeout (this step hung in two full runs of this server's specs)
      try {
        await expect.poll(() => roller.can('end'), { timeout: 10_000 }).toBe(true);
      } catch {
        throw new Error(await stuckInfo(seats, turn));
      }
      await roller.action('end').click();
      continue;
    }
    // the others leave the rules open while the dice are thrown
    const watchers = seats.filter((x) => x !== roller);
    for (const s of watchers) await s.page.getByRole('button', { name: 'Nasıl oynanır?' }).click();
    await roller.action('roll').click();
    await roller.page.waitForTimeout(1800);
    for (const s of seats) if ((await s.action('discard').count()) > 0) due = s;
    if (due) {
      const dialogs = due.page.getByRole('dialog');
      await expect(dialogs).toHaveCount(1); // only the discard sheet: the rules sheet this player had open is gone
      await expect(due.page.getByRole('dialog', { name: 'Nasıl oynanır?' })).toHaveCount(0);
      for (const name of ['Nasıl oynanır?', 'Ayarlar']) {
        const b = due.page.getByRole('button', { name, includeHidden: true });
        await expect(b).toHaveAttribute('aria-disabled', 'true');
        await b.dispatchEvent('click'); // even a tap that reaches it opens nothing
      }
      await expect(dialogs).toHaveCount(1);
      await expect(due.action('discard')).toBeVisible();
      // answer the duty: the buttons come back
      for (let i = 0; i < 20 && (await due.action('discard').count()) > 0; i++) await doForced(due);
      break;
    }
    for (const s of watchers) await s.page.keyboard.press('Escape');
    for (let i = 0; i < 10 && (await roller.action('end').count()) === 0; i++) {
      let moved = false;
      for (const s of seats) moved = (await doForced(s)) || moved;
      if (!moved) await roller.page.waitForTimeout(100);
    }
    await roller.action('end').click();
  }
  expect(due, 'a 7 never came').not.toBeNull();
  const back = due!.page.getByRole('button', { name: 'Nasıl oynanır?' });
  await expect(back).not.toHaveAttribute('aria-disabled', 'true');
  await back.click();
  await expect(due!.page.getByRole('dialog', { name: 'Nasıl oynanır?' })).toBeVisible();
});
