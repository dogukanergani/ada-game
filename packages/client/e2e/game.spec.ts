import { expect, test, type Page } from './test';
import { shot } from './helpers';
import { doForced, mover, newTable, playSetup, startShort, takeTurn, type Built } from './table';

/** Records every game message a page receives, as parsed JSON, to look at what actually reached the browser. */
function recordFrames(page: Page): unknown[] {
  const frames: unknown[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      const text = typeof f.payload === 'string' ? f.payload : f.payload.toString();
      const m = /^\d+(\[.*)$/s.exec(text);
      if (m) {
        try {
          frames.push(JSON.parse(m[1]));
        } catch {
          /* not a data frame */
        }
      }
    });
  });
  return frames;
}

test('two players set up a game and the first roll works, on phones', async ({ browser }) => {
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar']);
  await startShort(seats);
  for (const s of seats) {
    await expect(s.page.locator('.pseat')).toHaveCount(2);
    await expect(s.page.locator('.board-svg')).toBeVisible();
  }
  await playSetup(seats);
  const first = await mover(seats);
  await expect(first.action('roll')).toBeVisible();
  await first.action('roll').click();
  await expect(first.page.locator('.dice-tray')).toBeVisible();
  await expect(seats.find((s) => s !== first)!.page.locator('.dice-tray')).toBeVisible();
  for (let i = 0; i < 6; i++) if (!(await doForced(first))) break;
  await shot(first.page, '05-main-phase', 'mobile');
});

test('a player builds a road from the interface, trades with the other, reloads the page and is back in the game; a rival\'s hand is never in the page', async ({ browser }) => {
  const frames: unknown[][] = [[], []];
  const { seats } = await newTable(browser, ['Ayşe', 'Çağlar'], undefined, (page, i) => void (frames[i] = recordFrames(page)));
  await startShort(seats);
  await playSetup(seats);

  // play turns until someone has built a road (a settlement or city counts too: it is the same flow)
  let built: Built = null;
  for (let turns = 0; turns < 60 && !built; turns++) {
    const who = await mover(seats);
    built = await takeTurn(seats, who, { exchange: true });
    if (built === 'bank') built = null; // an exchange is a step toward a road, not the goal
  }
  if (!built) {
    const info = await Promise.all(seats.map(async (s) => `${s.name}: hand=${JSON.stringify(await s.hand())} hint=${await s.page.locator('.hint').first().innerText()} phase=${await s.page.locator('.game').getAttribute('data-phase')} turn=${await s.page.locator('.chip[data-turn=true] .chip-name').innerText().catch(() => '-')}`));
    throw new Error('nothing could be built in 60 turns: ' + info.join(' | '));
  }

  // a trade offer: the mover offers a card they hold for one the other holds; the other accepts
  const traded = await (async () => {
    for (let turns = 0; turns < 40; turns++) {
      const who = await mover(seats);
      const other = seats.find((s) => s !== who)!;
      await who.action('roll').click();
      for (let i = 0; i < 20 && (await who.action('end').count()) === 0; i++) {
        let moved = false;
        for (const s of seats) moved = (await doForced(s)) || moved;
        if (!moved) await who.page.waitForTimeout(100);
      }
      const mine = await who.hand();
      const theirs = await other.hand();
      const give = Object.keys(mine).find((r) => mine[r] > 0);
      const want = Object.keys(theirs).find((r) => theirs[r] > 0 && r !== give);
      if (give && want) {
        await who.action('trade').click();
        await who.page.getByRole('tab', { name: 'Oyuncuyla' }).click();
        const dialog = who.page.getByRole('dialog');
        await dialog.locator(`.rrow[data-block="offer-give"][data-resource="${give}"]`).click();
        await dialog.locator(`.rrow[data-block="offer-want"][data-resource="${want}"]`).click();
        await who.action('send-offer').click();
        await expect(dialog.locator('[data-offer]')).toHaveCount(1);
        await shot(who.page, '06-trade-sheet', 'mobile');
        await who.page.getByRole('button', { name: 'Kapat' }).click();

        await other.action('trade').click();
        await other.page.getByRole('tab', { name: 'Oyuncuyla' }).click();
        await other.page.getByRole('dialog').locator('[data-action="accept"]').click();
        await expect(other.page.locator('.last-text')).toContainText(/kabul/i);
        await other.page.getByRole('button', { name: 'Kapat' }).click();
        const after = await who.hand();
        expect(after[want]).toBe(mine[want] + 1);
        expect(after[give]).toBe(mine[give] - 1);
        return true;
      }
      if ((await who.action('end').count()) > 0) {
        await who.action('end').click();
        await expect(who.action('end')).toHaveCount(0);
      }
    }
    return false;
  })();
  expect(traded, 'the players never held cards the other lacked').toBe(true);

  // reload one player's page: same room, same game, same hand
  const [a, b] = seats;
  const handBefore = await a.hand();
  await a.page.reload();
  await a.page.locator('.game').waitFor();
  expect(await a.hand()).toEqual(handBefore);
  await expect(a.page.locator('.pseat')).toHaveCount(2);
  await b.page.waitForTimeout(100);

  // what reached each browser holds no rival hand: every game message shows the others' hands as null
  for (const [i, s] of seats.entries()) {
    const me = await s.page.evaluate(() => document.querySelector('.pseat[data-me="true"]')?.getAttribute('data-player') ?? null);
    const games = frames[i].filter((f): f is [string, { view: { me: string; players: { id: string; hand: unknown; devCards: unknown }[] } }] => Array.isArray(f) && /^game:/.test(String(f[0])));
    expect(games.length).toBeGreaterThan(0);
    for (const [, payload] of games) {
      for (const p of payload.view.players) {
        if (p.id !== payload.view.me) {
          expect(p.hand, 'a rival hand reached the browser').toBeNull();
          expect(p.devCards).toBeNull();
        }
      }
    }
    void me;
  }
  // and the page itself shows only counts for the other player
  const html = await b.page.content();
  expect(html.match(/class="hand-chip"/g)?.length).toBe(5);
  expect(await b.page.locator('.pseat').count()).toBe(2);
});
