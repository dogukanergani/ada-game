import { expect, test } from './test';
import { doForced, mover, newTable, playSetup, startShort, type Seat } from './table';

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
