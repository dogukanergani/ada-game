import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { MOBILE, openPlayer, type Player } from './helpers';

/** Drives the real UI of one or more players at a table; every step is a tap on something the player can see. */
export class Seat {
  constructor(
    readonly player: Player,
    readonly name: string,
  ) {}

  get page(): Page {
    return this.player.page;
  }

  action(id: string): Locator {
    return this.page.locator(`[data-action="${id}"]`);
  }

  /** true when the action button exists and is not marked disabled; for a piece (road, settlement, city) it looks at its row of the build sheet */
  async can(id: string): Promise<boolean> {
    if (id === 'road' || id === 'settlement' || id === 'city') return this.canBuild(id);
    const b = this.action(id);
    if ((await b.count()) === 0) return false;
    // a button that goes away between the count and the read (the screen was updated) is simply not there any more
    return b.first().getAttribute('aria-disabled', { timeout: 1000 }).then((v) => v !== 'true', () => false);
  }

  /** opens the build sheet, reads whether the piece's row is on, and closes the sheet again */
  async canBuild(piece: 'road' | 'settlement' | 'city'): Promise<boolean> {
    if (!(await this.can('build'))) return false;
    await this.action('build').click();
    const row = this.page.locator(`[data-build="${piece}"]`);
    await row.waitFor();
    const on = (await row.getAttribute('aria-disabled')) !== 'true';
    await this.page.getByRole('button', { name: 'Kapat' }).click();
    await this.page.getByRole('dialog').waitFor({ state: 'detached' });
    return on;
  }

  /** the build sheet's way in: tap "İnşa", then the piece; the board then asks for a spot */
  async startBuild(piece: 'road' | 'settlement' | 'city') {
    await this.action('build').click();
    await this.page.locator(`[data-build="${piece}"]`).click();
    await this.page.getByRole('dialog').waitFor({ state: 'detached' });
  }

  async hand(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const chips = this.page.locator('.hand-chip');
    const n = await chips.count();
    for (let i = 0; i < n; i++) {
      const chip = chips.nth(i);
      out[(await chip.getAttribute('data-resource'))!] = Number(await chip.locator('.hand-n').innerText());
    }
    return out;
  }

  async tap(selector: string) {
    await this.page.locator(selector).first().click({ force: true });
  }

  async confirm() {
    await this.action('confirm').click();
  }

  async dialog(): Promise<boolean> {
    return (await this.page.getByRole('dialog').count()) > 0;
  }

  async gameOver(): Promise<boolean> {
    return (await this.page.locator('.game[data-phase="finished"]').count()) > 0;
  }
}

export async function newTable(
  browser: Browser,
  names: string[],
  viewport = MOBILE,
  prepare?: (page: Page, index: number) => void,
): Promise<{ seats: Seat[]; code: string }> {
  const seats: Seat[] = [];
  let code = '';
  for (const [i, name] of names.entries()) {
    const player = await openPlayer(browser, viewport, 'tr-TR', prepare ? (page) => prepare(page, i) : undefined);
    const seat = new Seat(player, name);
    await player.page.getByLabel('Adın').fill(name);
    if (i === 0) {
      await player.page.getByRole('button', { name: 'Oda kur' }).click();
      await player.page.locator('.code-letters').waitFor();
      code = (await player.page.locator('.code-letters').innerText()).trim();
    } else {
      await player.page.getByLabel('Oda kodu').fill(code);
      await player.page.getByRole('button', { name: 'Katıl' }).click();
      await player.page.getByRole('heading', { name: 'Lobi' }).waitFor();
    }
    seats.push(seat);
  }
  return { seats, code };
}

/** Host picks the short mode and starts; waits until everyone is looking at the game. */
export async function startShort(seats: Seat[]) {
  const [host] = seats;
  await host.page.getByRole('radio', { name: /Kısa/ }).click();
  await host.page.getByRole('button', { name: 'Oyunu başlat' }).click();
  for (const s of seats) await s.page.locator('.game').waitFor();
}

/**
 * Whatever this player has in front of them that the game is asking for right
 * now: a forced sheet, a spot on the board, or nothing (then false).
 */
export async function doForced(seat: Seat): Promise<boolean> {
  const { page } = seat;
  // a discard sheet: raise the amounts until the sheet says the count is right. A moment in which no "+" is on (the sheet is
  // being drawn again) is waited out; and if the count is still not right after a fair time, the test fails at once and says
  // what the sheet showed, instead of waiting for the discard button for the whole of the test's timeout.
  if ((await seat.action('discard').count()) > 0) {
    for (let guard = 0; guard < 150; guard++) {
      if (await seat.can('discard')) break;
      const plus = page.getByRole('dialog').getByRole('button', { name: /artır$/ });
      const n = await plus.count();
      let clicked = false;
      for (let i = 0; i < n && !clicked; i++) {
        if (await plus.nth(i).isEnabled()) {
          await plus.nth(i).click();
          clicked = true;
        }
      }
      if (!clicked) await page.waitForTimeout(100);
    }
    if (!(await seat.can('discard'))) {
      const shown = await page.getByRole('dialog').innerText().catch(() => '(no dialog)');
      throw new Error(`the discard sheet never reached its count: ${shown.replace(/\s+/g, ' ')}`);
    }
    await seat.action('discard').click();
    // the button stays on screen until the server's answer arrives; a caller that looks again at once would find a stale
    // button, so say "done" only when it is gone
    await expect(seat.action('discard')).toHaveCount(0, { timeout: 10_000 });
    return true;
  }
  // choose whom to steal from
  if ((await page.locator('[data-victim]').count()) > 0) {
    await page.locator('[data-victim]').first().click();
    return true;
  }
  // the robber, a corner or an edge to build on in the setup, free roads
  for (const spot of ['.spot-tile', '.spot-vertex', '.spot-edge']) {
    if ((await page.locator(spot).count()) > 0 && (await seat.action('confirm').count()) > 0) {
      await seat.tap(spot);
      await seat.confirm();
      return true;
    }
  }
  return false;
}

/** Plays the snake setup through the UI: each player in turn is asked for a corner and then a road. */
export async function playSetup(seats: Seat[]) {
  for (let guard = 0; guard < 80; guard++) {
    let moved = false;
    for (const s of seats) moved = (await doForced(s)) || moved;
    const rolling = (await Promise.all(seats.map((s) => s.action('roll').count()))).some((n) => n > 0);
    if (rolling) return;
    if (!moved) await seats[0].page.waitForTimeout(150);
  }
  throw new Error('the setup did not finish');
}

/** The seat whose turn it is (it has a roll or an end-turn button). */
export async function mover(seats: Seat[]): Promise<Seat> {
  for (let i = 0; i < 100; i++) {
    // Every screen must agree on whose turn it is, and the one holding the dice or the "end" button must be that player's own.
    // A screen that has not yet applied the last turn change still shows its old "end" button and its old turn marker together,
    // so one page's own marker cannot tell stale from current; the others, already updated, name someone else.
    const turns = await Promise.all(seats.map((s) => s.page.locator('.pseat[data-turn="true"]').first().getAttribute('data-player').catch(() => null)));
    const agreed = turns[0] !== null && turns.every((t) => t === turns[0]);
    if (agreed) {
      for (const s of seats) {
        const mine = await s.page.locator(`.pseat[data-me="true"][data-player="${turns[0]}"]`).count();
        if (mine > 0 && ((await s.action('roll').count()) > 0 || (await s.action('end').count()) > 0)) return s;
      }
    }
    await seats[0].page.waitForTimeout(100);
  }
  const info = await Promise.all(seats.map(async (s) => `${s.name}: phase=${await s.page.locator('.game').getAttribute('data-phase').catch(() => '?')} hint=${await s.page.locator('p.hint').first().innerText().catch(() => '?')} actions=${(await s.page.locator('[data-action]').evaluateAll((e) => e.map((x) => x.getAttribute('data-action'))).catch(() => [])).join(',')}`));
  throw new Error('nobody can move; ' + info.join(' | '));
}

/** Plays turns until the mover holds a card the other lacks and the other holds one the mover lacks; the roll has finished playing. */
export async function playToOffer(seats: Seat[]) {
  for (let turns = 0; turns < 60; turns++) {
    const who = await mover(seats);
    const other = seats.find((s) => s !== who)!;
    await who.action('roll').click();
    for (let i = 0; i < 20 && (await who.action('end').count()) === 0; i++) {
      let moved = false;
      for (const s of seats) moved = (await doForced(s)) || moved;
      if (!moved) await who.page.waitForTimeout(100);
    }
    // the counts on screen are held back while the dice tumble: read them once the roll has played
    await expect(who.page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
    const mine = await who.hand();
    const theirs = await other.hand();
    const give = Object.keys(mine).find((r) => mine[r] > 0);
    const want = Object.keys(theirs).find((r) => theirs[r] > 0 && r !== give);
    if (give && want) return { who, other, give, want, mine };
    await who.action('end').click();
    await expect(who.action('end')).toHaveCount(0);
  }
  throw new Error('the players never held cards the other lacked');
}

export type Built = 'city' | 'settlement' | 'road' | 'card' | 'bank' | null;

/** Through the trade sheet: give the first resource the bank accepts, ask for a building material the player lacks. */
export async function bankTowardRoad(seat: Seat): Promise<boolean> {
  if (!(await seat.can('trade'))) return false;
  const hand = await seat.hand();
  // the first building material the player has none of
  const wanted = (['brick', 'lumber', 'wool', 'grain'] as const).find((r) => hand[r] === 0) ?? 'brick';
  await seat.action('trade').click();
  const dialog = seat.page.getByRole('dialog');
  const give = dialog.locator(`.rrow[data-block="give"][aria-disabled="false"]:not([data-resource="${wanted}"])`);
  let done = false;
  if ((await give.count()) > 0) {
    await give.first().click();
    const get = dialog.locator(`.rrow[data-block="get"][aria-disabled="false"][data-resource="${wanted}"]`);
    if ((await get.count()) > 0) {
      await get.first().click();
      await seat.action('bank-trade').click();
      done = (await dialog.locator('.trade-summary').filter({ hasText: /Takas yapıldı/ }).count()) > 0;
    }
  }
  await seat.page.getByRole('button', { name: 'Kapat' }).click();
  return done;
}

/** One turn as a player would take it: roll, answer a 7, build the best thing affordable, end the turn. */
export async function takeTurn(seats: Seat[], seat: Seat, opts: { build?: boolean; exchange?: boolean } = {}): Promise<Built> {
  if ((await seat.action('roll').count()) > 0) await seat.action('roll').click();
  for (let i = 0; i < 20 && (await seat.action('end').count()) === 0; i++) {
    let moved = false;
    for (const s of seats) moved = (await doForced(s)) || moved;
    if (!moved) await seat.page.waitForTimeout(100);
    if (await seats[0].gameOver()) return null;
  }
  let built: Built = null;
  if (opts.build !== false && (await seat.action('end').count()) > 0) {
    for (const piece of ['city', 'settlement', 'road'] as const) {
      if (await seat.can(piece)) {
        await seat.startBuild(piece);
        await seat.tap(piece === 'road' ? '.spot-edge' : '.spot-vertex');
        await seat.confirm();
        built = piece;
        break;
      }
    }
    // nothing affordable: turn a card the bank takes into brick or lumber, so a road can follow
    if (!built && opts.exchange && (await bankTowardRoad(seat))) built = 'bank';
    if (!built && (await seat.can('buy'))) {
      await seat.action('buy').click();
      built = 'card';
    }
  }
  // a build can win the game, and the other pages hear about it a moment later: give that time to show
  if (built) await seat.page.waitForTimeout(300);
  const over = async () => (await Promise.all(seats.map((s) => s.gameOver()))).some(Boolean);
  for (let i = 0; i < 60; i++) {
    if ((await over()) || (await seat.action('end').count()) > 0) break;
    await seat.page.waitForTimeout(100);
  }
  if (await over()) return built;
  try {
    await seat.action('end').click({ timeout: 3000 });
  } catch (e) {
    if (await over()) return built;
    const info = await Promise.all(seats.map(async (s) => `${s.name}: phase=${await s.page.locator('.game').getAttribute('data-phase')} hint=${(await s.page.locator('.hint').first().innerText().catch(() => '?'))} end=${await s.action('end').count()} roll=${await s.action('roll').count()}`));
    throw new Error('end vanished; ' + info.join(' | '));
  }
  // the turn has passed once this player no longer has the end-turn button
  for (let i = 0; i < 80 && (await seat.action('end').count()) > 0; i++) {
    if (await over()) return built;
    await seat.page.waitForTimeout(100);
  }
  return built;
}

