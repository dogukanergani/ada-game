import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from './test';
import { DESKTOP, MOBILE, SHOTS, SMALL } from './helpers';
import { newTable } from './table';

/**
 * The player seats around the board. Every case is one game start at a given
 * player count, map and screen size, looked at before anything is played (the
 * seats are there from the first move).
 *
 * ADA_MEASURE=1 records, for every case, how big a map tile is on screen and how
 * big the board area is, to e2e/tile-baseline.json; that is how the seat-less
 * screen was measured. A normal run compares against it.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, 'tile-baseline.json');

export const CASES = [
  { map: 'classic19', players: 2, mode: /Standart/ },
  { map: 'classic19', players: 3, mode: /Standart/ },
  { map: 'classic19', players: 4, mode: /Standart/ },
  { map: 'classic19', players: 5, mode: /Kısa/ },
  { map: 'large30', players: 5, mode: /Standart/ },
  { map: 'short14', players: 2, mode: /Kısa/ },
  { map: 'short14', players: 4, mode: /Kısa/ },
] as const;
export const SIZES = [
  { label: 'mobile', viewport: MOBILE },
  { label: 'small', viewport: SMALL },
  { label: 'desktop', viewport: DESKTOP },
] as const;

/** the width on screen of one map tile (its hexagon) and the size of the board area */
export async function measure(page: Page) {
  return page.evaluate(() => {
    const hex = document.querySelector('.tile polygon')!.getBoundingClientRect();
    const board = document.querySelector('.board-svg')!.getBoundingClientRect();
    return { tile: Math.round(hex.width * 10) / 10, boardW: Math.round(board.width), boardH: Math.round(board.height) };
  });
}

/**
 * The board is a little shorter for the player whose move it is (the panel under it asks for a spot and holds a confirm button) than
 * for a player who waits, and who moves first is random: so the board is measured for both, in the same game.
 */
export type Mood = 'mover' | 'waiting';
export async function measureBoth(seats: { page: Page }[]): Promise<Record<Mood, Awaited<ReturnType<typeof measure>>>> {
  const out: Partial<Record<Mood, Awaited<ReturnType<typeof measure>>>> = {};
  for (const s of seats) {
    const mood: Mood = (await s.page.locator('[data-action="confirm"]').count()) > 0 ? 'mover' : 'waiting';
    out[mood] ??= await measure(s.page);
  }
  return out as Record<Mood, Awaited<ReturnType<typeof measure>>>;
}

export async function startGame(browser: Browser, c: (typeof CASES)[number], viewport: { width: number; height: number }) {
  const names = Array.from({ length: c.players }, (_, i) => `P${i + 1}`);
  const { seats } = await newTable(browser, names, viewport);
  // everyone is in the lobby before the host starts (5 pages joining take a moment)
  await expect(seats[0].page.getByRole('heading', { name: new RegExp(`Oyuncular \\(${c.players}/5\\)`) })).toBeVisible();
  await seats[0].page.getByRole('radio', { name: c.mode }).click();
  await seats[0].page.getByRole('button', { name: 'Oyunu başlat' }).click();
  for (const s of seats) await s.page.locator('.game').waitFor();
  await seats[0].page.waitForTimeout(400);
  return seats;
}

const key = (c: (typeof CASES)[number], size: string) => `${c.map}-${c.players}p-${size}`;

if (process.env.ADA_MEASURE) {
  // each case is merged into the file as it is measured (the worker restarts after a failed case, so memory is not enough)
  const record = (k: string, v: unknown) => {
    let all: Record<string, unknown> = {};
    try {
      all = JSON.parse(readFileSync(BASELINE, 'utf8'));
    } catch {
      /* a first case */
    }
    all[k] = v;
    writeFileSync(BASELINE, JSON.stringify(all, null, 2) + '\n');
  };
  for (const c of CASES) {
    for (const { label, viewport } of SIZES) {
      test(`measure ${key(c, label)}`, async ({ browser }) => {
        const seats = await startGame(browser, c, viewport);
        const m = await measureBoth(seats);
        mkdirSync(HERE, { recursive: true });
        record(key(c, label), m);
        console.log(`TILE ${key(c, label)} ${JSON.stringify(m)}`);
      });
    }
  }
}

/* ---------------- the seats themselves ---------------- */

const RESOURCE_WORDS = /odun|tuğla|koyun|buğday|cevher|lumber|brick|wool|grain|ore/i;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** every seat on the page, with where it is and what it says */
async function readSeats(page: Page) {
  return page.evaluate(() => {
    const box = (e: Element): Box => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const seats = [...document.querySelectorAll('.pseat')].map((li) => {
      const btn = li.querySelector('.pseat-btn') as HTMLElement;
      const row = li.closest('.seats') as HTMLElement;
      return {
        id: li.getAttribute('data-player')!,
        seat: Number(li.getAttribute('data-seat')),
        me: li.getAttribute('data-me') === 'true',
        turn: li.getAttribute('data-turn') === 'true',
        row: row.classList.contains('seats-me') ? 'me' : 'opponents',
        box: box(btn),
        label: btn.getAttribute('aria-label') ?? '',
        text: (li as HTMLElement).innerText,
        html: li.innerHTML,
        overflow: btn.scrollWidth - btn.clientWidth,
        idShown: getComputedStyle(li.querySelector('.pseat-id')!).display !== 'none',
        rowOverflow: row.scrollWidth - row.clientWidth,
      };
    });
    const svg = document.querySelector('.board-svg')!;
    // what must stay uncovered: the board itself, the dice, the zoom buttons, and the marks on the board that are in view
    const board = box(svg);
    const inView = (r: Box) => r.x + r.w > board.x && r.x < board.x + board.w && r.y + r.h > board.y && r.y < board.y + board.h;
    const marks = [...document.querySelectorAll('.token, .harbor, .building, .road, .robber, .spot')]
      .map((e) => ({ name: e.getAttribute('class')!, box: box(e), cx: 0, cy: 0 }))
      .filter((m) => inView(m.box))
      .map((m) => ({ ...m, cx: Math.min(Math.max(m.box.x + m.box.w / 2, board.x + 1), board.x + board.w - 1), cy: Math.min(Math.max(m.box.y + m.box.h / 2, board.y + 1), board.y + board.h - 1) }));
    const covered = marks.filter((m) => !document.elementFromPoint(m.cx, m.cy)?.closest('.board-svg, .board-controls, .dice-tray')).map((m) => m.name);
    return {
      seats,
      board,
      dice: [...document.querySelectorAll('.dice-tray')].map(box),
      controls: [...document.querySelectorAll('.board-button')].map(box),
      covered,
      marks: marks.length,
    };
  });
}

if (!process.env.ADA_MEASURE) {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Record<Mood, { tile: number }>>;
  for (const c of CASES) {
    for (const { label, viewport } of SIZES) {
      test(`seats: ${key(c, label)} (${viewport.width}x${viewport.height})`, async ({ browser }) => {
        const seats = await startGame(browser, c, viewport);
        const page = seats[0].page;
        const r = await readSeats(page);
        const mine = r.seats.find((s) => s.me)!;

        // one seat per player; the viewer alone in the row below the board, the others above it
        expect(r.seats).toHaveLength(c.players);
        expect(r.seats.filter((s) => s.row === 'opponents')).toHaveLength(c.players - 1);
        expect(mine.row).toBe('me');
        for (const s of r.seats) {
          if (s.row === 'opponents') expect(s.box.y + s.box.h, 'an opponent sits above the board').toBeLessThanOrEqual(r.board.y + 1);
          else expect(s.box.y, 'the viewer sits below the board').toBeGreaterThanOrEqual(r.board.y + r.board.h - 1);
        }

        // clockwise from the viewer: the next seat first, from the left
        const around = r.seats.map((s) => s.seat).sort((a, b) => a - b);
        const after = [...around.filter((n) => n > mine.seat), ...around.filter((n) => n < mine.seat)];
        const left2right = r.seats.filter((s) => s.row === 'opponents').sort((a, b) => a.box.x - b.box.x).map((s) => s.seat);
        expect(left2right, 'the opponents run clockwise from the viewer').toEqual(after);

        // nothing is covered: no seat touches the board, the dice or the zoom buttons, and every mark in view is what a tap there reaches
        for (const s of r.seats) {
          expect(overlap(s.box, r.board), `seat ${s.seat} on the board`).toBe(false);
          for (const d of r.dice) expect(overlap(s.box, d), `seat ${s.seat} on the dice`).toBe(false);
          for (const b of r.controls) expect(overlap(s.box, b), `seat ${s.seat} on a zoom button`).toBe(false);
        }
        expect(r.covered, 'marks on the board that something else covers').toEqual([]);

        // every seat is a tap target of at least 44 px, holds its content, and the row does not scroll sideways
        for (const s of r.seats) {
          expect(s.box.h, `seat ${s.seat} is tall enough`).toBeGreaterThanOrEqual(43.5);
          expect(s.box.w, `seat ${s.seat} is wide enough`).toBeGreaterThanOrEqual(43.5);
          expect(s.overflow, `seat ${s.seat} holds its content`).toBeLessThanOrEqual(1);
          expect(s.rowOverflow, 'the row does not scroll sideways').toBeLessThanOrEqual(1);
        }

        // the name and the role are written out on a wide screen only
        for (const s of r.seats) expect(s.idShown).toBe(viewport.width >= 900);

        // a seat says it all to a screen reader: name, role, points, cards, and whose move it is; a rival's hand is only a count
        for (const s of r.seats) {
          expect(s.label).toMatch(/^P\d, [^,]+, \d+ puan, \d+ kart/);
          expect(s.turn === s.label.includes(', sırada')).toBe(true);
        }
        expect(r.seats.filter((s) => s.turn)).toHaveLength(1);
        for (const s of r.seats) {
          expect(s.text + s.label + s.html, `seat ${s.seat} names a resource`).not.toMatch(RESOURCE_WORDS);
          expect(s.html).not.toContain('data-resource');
        }

        // how big a map tile is, against the screen without seats (e2e/tile-baseline.json)
        const now = await measureBoth(seats);
        for (const mood of ['mover', 'waiting'] as const) {
          const m = now[mood];
          const was = baseline[key(c, label)][mood].tile;
          const share = m.tile / was;
          console.log(`TILESHARE ${key(c, label)} ${mood} ${m.tile}/${was} = ${share.toFixed(2)} (board ${m.boardW}x${m.boardH})`);
          expect(share, `the map tile on ${key(c, label)} for the player who ${mood === 'mover' ? 'moves' : 'waits'}: ${m.tile} px against ${was} px before`).toBeGreaterThanOrEqual(viewport.width >= 900 ? 0.8 : 0.9);
        }

        await page.screenshot({ path: join(SHOTS, `seats-${key(c, label)}.png`) });
      });
    }
  }

  test('seats: a tap on a seat names the player and the role on a phone (and the hint goes away)', async ({ browser }) => {
    const seats = await startGame(browser, CASES[1], MOBILE);
    const page = seats[0].page;
    const rival = page.locator('.pseat[data-me="false"] .pseat-btn').first();
    await rival.click();
    const tip = page.locator('.pseat-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(/^P\d · \S+/);
    await rival.click();
    await expect(tip).toHaveCount(0);
  });
}
