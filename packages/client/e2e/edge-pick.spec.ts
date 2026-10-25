import { expect, test, type Page } from './test';
import { DESKTOP, MOBILE, SMALL } from './helpers';
import { doForced, mover, newTable, playSetup, type Seat } from './table';

/**
 * Choosing a road by touch. In road-building mode the legal edges are
 * highlighted; a finger never lands exactly on the thin line, so a tap a few
 * pixels off must still choose the road it is meant for. Real touches on the
 * real board, on the classic and the big map, on each screen size, at the fitted
 * zoom and zoomed in (the roads grow, the finger does not).
 */
const maps = [
  { id: 'classic19', players: 3 },
  { id: 'large30', players: 5 },
] as const;
const sizes = [
  { label: 'mobile', viewport: MOBILE },
  { label: 'small', viewport: SMALL },
  { label: 'desktop', viewport: DESKTOP },
];

/** a touch within this many pixels of a button is taken for a tap on the button (the browser snaps touches to a nearby button) */
const TOUCH_SNAP_PX = 18;

interface Road {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** the legal roads on screen, in viewport pixels */
async function roadsOnScreen(page: Page): Promise<Road[]> {
  return page.evaluate(() => {
    const svg = document.querySelector('.board-svg') as SVGSVGElement;
    const m = svg.getScreenCTM()!;
    const pt = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
    return [...document.querySelectorAll('.spot-edge')].map((g) => {
      const line = [...g.querySelectorAll('line')].find((l) => l.getAttribute('class') !== 'hit')!;
      const a = pt(Number(line.getAttribute('x1')), Number(line.getAttribute('y1')));
      const b = pt(Number(line.getAttribute('x2')), Number(line.getAttribute('y2')));
      return { id: Number(g.getAttribute('data-edge')), x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
  });
}

const distance = (r: Road, x: number, y: number) => {
  const dx = r.x2 - r.x1;
  const dy = r.y2 - r.y1;
  const t = Math.max(0, Math.min(1, ((x - r.x1) * dx + (y - r.y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (r.x1 + t * dx), y - (r.y1 + t * dy));
};

/** a discard that keeps wood and brick (the shared helper raises the first resource first, which would leave nothing to build a road with) */
async function discardKeepingRoadCards(seat: Seat): Promise<boolean> {
  if ((await seat.action('discard').count()) === 0) return false;
  const plus = seat.page.getByRole('dialog').getByRole('button', { name: /artır$/ });
  for (let guard = 0; guard < 80 && !(await seat.can('discard')); guard++) {
    const n = await plus.count();
    let clicked = false;
    for (let i = n - 1; i >= 0 && !clicked; i--) {
      if (await plus.nth(i).isEnabled()) {
        await plus.nth(i).click();
        clicked = true;
      }
    }
    if (!clicked) break;
  }
  await seat.action('discard').click();
  return true;
}

/** the roads on screen once the board has stopped moving (the panel under it changes height between modes and the board settles a moment later) */
async function settledRoads(page: Page): Promise<Road[]> {
  let last = await roadsOnScreen(page);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(80);
    const now = await roadsOnScreen(page);
    const same = now.length === last.length && now.every((r, k) => Math.abs(r.x1 - last[k].x1) < 0.5 && Math.abs(r.y1 - last[k].y1) < 0.5 && Math.abs(r.x2 - last[k].x2) < 0.5 && Math.abs(r.y2 - last[k].y2) < 0.5);
    if (same) return now;
    last = now;
  }
  return last;
}

async function enterRoadMode(seat: Seat) {
  if (!(await seat.can('road'))) {
    const hand = JSON.stringify(await seat.hand());
    const hint = await seat.page.locator('p.hint').first().innerText();
    throw new Error(`the road row is off: hand=${hand} hint="${hint}" phase=${await seat.page.locator('.game').getAttribute('data-phase')}`);
  }
  await seat.startBuild('road');
  await expect(seat.page.locator('.spot-edge').first()).toBeVisible();
}

for (const map of maps) {
  for (const { label, viewport } of sizes) {
    for (const zoomed of [false, true]) {
      test(`a tap a few pixels off a road chooses that road: ${map.id}, ${label} (${viewport.width}x${viewport.height}), ${zoomed ? 'zoomed in' : 'fitted'}`, async ({ browser }) => {
        const names = Array.from({ length: map.players }, (_, i) => `P${i + 1}`);
        const { seats } = await newTable(browser, names, viewport);
        await seats[0].page.getByRole('radio', { name: /Standart/ }).click();
        await seats[0].page.getByRole('button', { name: 'Oyunu başlat' }).click();
        for (const s of seats) await s.page.locator('.game').waitFor();
        await playSetup(seats);
        const who = await mover(seats);
        await who.action('roll').click();
        for (let i = 0; i < 400 && (await who.action('end').count()) === 0; i++) {
          let moved = false;
          for (const s of seats) moved = (await discardKeepingRoadCards(s)) || (await doForced(s)) || moved;
          if (!moved) await who.page.waitForTimeout(100);
        }
        const page = who.page;
        // a click that cannot finish should say why within seconds, not at the end of the test
        page.setDefaultTimeout(15_000);
        await expect(page.locator('.dice-tray')).toHaveAttribute('data-stage', 'still');
        await page.waitForTimeout(1300);
        await enterRoadMode(who);
        if (zoomed) {
          await page.getByRole('button', { name: 'Yakınlaştır' }).click();
        }
        const touch = viewport.width < 600;
        const tapAt = (x: number, y: number) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));

        let roads = await roadsOnScreen(page);
        expect(roads.length).toBeGreaterThan(2);
        const board = (await page.locator('.board-svg').boundingBox())!;
        const inside = (x: number, y: number) => x > board.x + 8 && x < board.x + board.width - 8 && y > board.y + 8 && y < board.y + board.height - 8;

        let covered = 0;
        const results = { right: 0, wrong: 0, none: 0, wrongList: [] as string[], noneList: [] as string[] };
        // taps along each road and a finger's width to either side of it
        for (const road of roads.slice(0, 6)) {
          for (const along of [0.15, 0.5, 0.85]) {
            for (const across of [-10, -5, 0, 5, 10]) {
              roads = await settledRoads(page);
              const r = roads.find((q) => q.id === road.id)!;
              const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
              const ux = (r.x2 - r.x1) / len;
              const uy = (r.y2 - r.y1) / len;
              const x = r.x1 + ux * len * along - uy * across;
              const y = r.y1 + uy * len * along + ux * across;
              if (!inside(x, y)) continue;
              // a zoom button or the dice on top of, or right next to, that spot takes the tap: not what is tested here
              const top = await page.evaluate(
                ([px, py, slop]) => {
                  const near = [...document.querySelectorAll('.board-button, .dice-tray')].some((e) => {
                    const r = e.getBoundingClientRect();
                    return px > r.left - slop && px < r.right + slop && py > r.top - slop && py < r.bottom + slop;
                  });
                  return !near && document.elementFromPoint(px, py)?.closest('.board-svg') !== null;
                },
                [x, y, TOUCH_SNAP_PX],
              );
              if (!top) {
                covered++;
                continue;
              }
              // the road meant: the nearest legal one, when it is clearly nearer than the next (else the tap is a toss-up and not tested)
              const ranked = roads.map((q) => ({ q, d: distance(q, x, y) })).sort((p, q) => p.d - q.d);
              if (ranked[0].d > 10 || (ranked[1] && ranked[1].d - ranked[0].d < 4)) continue;
              await tapAt(x, y);
              const sel = page.locator('.spot-edge[data-selected="true"]');
              // the choice is drawn a moment after the tap: wait for it before calling the tap empty
              await sel.first().waitFor({ timeout: 500 }).catch(() => undefined);
              const picked = (await sel.count()) > 0 ? Number(await sel.first().getAttribute('data-edge')) : null;
              const tag = `road ${ranked[0].q.id} tapped ${along}/${across}px (d=${ranked[0].d.toFixed(1)}) -> ${picked}`;
              if (picked === null) {
                results.none++;
                results.noneList.push(tag);
              } else if (picked === ranked[0].q.id) results.right++;
              else {
                results.wrong++;
                results.wrongList.push(tag);
              }
              // start the next tap from a clean slate
              await who.action('cancel').click();
              await enterRoadMode(who);
              if (zoomed) {
                await page.getByRole('button', { name: 'Yakınlaştır' }).click();
              }
            }
          }
        }
        if (results.noneList.length) console.log('NONE ' + results.noneList.join(' ; '));
        console.log(`EDGEPICK covered=${covered} ${map.id} ${label} ${zoomed ? 'zoomed' : 'fitted'}: right=${results.right} wrong=${results.wrong} none=${results.none}`);
        expect(results.right + results.wrong + results.none, 'enough taps were tried').toBeGreaterThan(zoomed ? 2 : 15);
        expect(results.wrongList, 'taps that chose another road').toEqual([]);
        expect(results.noneList, 'taps that chose nothing').toEqual([]);
      });
    }
  }
}
