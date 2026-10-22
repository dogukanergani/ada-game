import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { expect, test } from './test';
import { applyAction, createGame, legalRoadEdges, legalSettlementVertices, topologyOf, viewFor, type GameMode, type GameView } from '@ada/game-core';
import { mulberry32 } from '../../game-core/sim/rng';
import { Board, type BoardTarget } from '../src/board/Board';
import { I18nProvider } from '../src/i18n/context';
import { DESKTOP, MOBILE, shot } from './helpers';

function viewOf(n: number, mode: GameMode): GameView {
  const rng = mulberry32(n * 7 + 3);
  const roles = ['soldier', 'sage', 'sailor', 'diplomat', 'harvester'];
  const created = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, role: roles[i] })), mode }, rng);
  if (!created.ok) throw new Error('createGame');
  let s = created.state;
  while (s.phase === 'setup') {
    const me = s.current;
    const vs = legalSettlementVertices(s, me);
    const action = s.setup!.step === 'settlement' ? { type: 'placeSettlement' as const, vertex: vs[Math.floor(rng() * vs.length)] } : { type: 'placeRoad' as const, edge: legalRoadEdges(s, me)[0] };
    const r = applyAction(s, me, action, rng);
    if (!r.ok) throw new Error('setup');
    s = r.state;
  }
  return viewFor(s, 'p0');
}

const markup = (view: GameView, target: BoardTarget | null = null) =>
  renderToStaticMarkup(createElement(I18nProvider, null, createElement(Board, { view, target })));

async function show(page: import('@playwright/test').Page, html: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/');
  await page.evaluate(
    ({ html, w, h }) => {
      document.body.innerHTML = `<div id="probe" style="width:${w}px;height:${h}px;display:flex;background:#0b2530">${html}</div>`;
    },
    { html, w, h },
  );
}

const MAPS: [string, number, GameMode][] = [
  ['classic19', 3, 'standard'],
  ['large30', 5, 'standard'],
  ['short14', 3, 'short'],
];

for (const [name, n, mode] of MAPS) {
  test(`the ${name} board draws completely (mobile and desktop)`, async ({ page }) => {
    const view = viewOf(n, mode);
    const topo = topologyOf(view.map);
    const target: BoardTarget = { kind: 'vertex', ids: topo.vertices.filter((_, i) => i % 5 === 0).map((v) => v.id) };
    for (const [size, vp] of [['mobile', { w: MOBILE.width, h: 520 }], ['desktop', { w: 760, h: DESKTOP.height - 100 }]] as const) {
      await show(page, markup(view, target), vp.w, vp.h);
      // every tile polygon lies fully inside the visible area
      const box = await page.locator('#probe .board-svg').boundingBox();
      expect(box).not.toBeNull();
      const outside = await page.evaluate(() => {
        const svg = document.querySelector('#probe .board-svg')!;
        const r = svg.getBoundingClientRect();
        return [...document.querySelectorAll('#probe .tile polygon:nth-of-type(1), #probe .harbor circle')].filter((el) => {
          const b = el.getBoundingClientRect();
          return b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1;
        }).length;
      });
      expect(outside, `${name} ${size}: parts of the board are cut off`).toBe(0);
      await page.locator('#probe').screenshot({ path: `${(await import('./helpers')).SHOTS}/03-board-${name}-${size}.png` });
    }
    void shot;
  });
}

test('all five player colours show on the sea and on every terrain pattern', async ({ page }) => {
  const view = viewOf(5, 'standard');
  const topo = topologyOf(view.map);
  const seen = new Set<string>();
  const buildings: GameView['buildings'] = {};
  const roads: GameView['roads'] = {};
  // for each terrain kind, one settlement and one road per player colour on tiles of that kind
  const kinds = ['lumber', 'brick', 'wool', 'grain', 'ore', 'desert'] as const;
  kinds.forEach((kind) => {
    const tiles = view.tiles.map((t, i) => ({ t, i })).filter((x) => x.t.kind === kind).slice(0, 2);
    tiles.forEach(({ i }, ti) => {
      const tile = topo.tiles[i];
      for (let seat = 0; seat < 5; seat++) {
        const v = tile.corners[seat];
        if (!seen.has(`v${v}`)) {
          seen.add(`v${v}`);
          buildings[v] = { owner: `p${seat}`, kind: ti === 0 ? 'settlement' : 'city' };
        }
      }
      const e = topo.edges.find((ed) => ed.tiles.includes(i) && !(`e${ed.id}` in roads) && !(ed.a in buildings) && !(ed.b in buildings));
      if (e) roads[e.id] = `p${ti % 5}`;
    });
  });
  // and along the coast, over the shallows, a road of each colour
  topo.coastEdges.slice(0, 5).forEach((id, i) => (roads[id] = `p${i}`));
  const demo: GameView = { ...view, buildings, roads, robber: -1 };
  await show(page, markup(demo), 760, 700);
  await page.locator('#probe').screenshot({ path: `${(await import('./helpers')).SHOTS}/04-colors-on-terrains.png` });
});
