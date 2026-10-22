import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyAction, createGame, legalRoadEdges, legalSettlementVertices, viewFor, type GameMode, type GameState, type GameView,
} from '@ada/game-core';
import { mulberry32 } from '../../game-core/sim/rng';
import { Board, type BoardTarget } from '../src/board/Board';
import { PLAYER_COLORS, PIECE_OUTLINE, SEA, TERRAIN_COLOR, contrast } from '../src/board/colors';
import { boardGeometry, fitCamera, nearest, probabilityDots, segmentOf, viewBoxOf } from '../src/board/geometry';
import { I18nProvider } from '../src/i18n/context';

beforeAll(() => {
  vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
});

/** A real game of `n` players, set up with the first legal placements, as one player sees it. */
function game(n: number, mode: GameMode, setupDone = true): { state: GameState; view: GameView } {
  const rng = mulberry32(n * 17 + (mode === 'short' ? 1 : 2));
  const roles = ['soldier', 'sage', 'sailor', 'diplomat', 'harvester'];
  const created = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, role: roles[i] })), mode }, rng);
  if (!created.ok) throw new Error('createGame');
  let s = created.state;
  while (setupDone && s.phase === 'setup') {
    const me = s.current;
    const action =
      s.setup!.step === 'settlement'
        ? ({ type: 'placeSettlement', vertex: legalSettlementVertices(s, me)[Math.floor(rng() * 5) % legalSettlementVertices(s, me).length] } as const)
        : ({ type: 'placeRoad', edge: legalRoadEdges(s, me)[0] } as const);
    const r = applyAction(s, me, action, rng);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    s = r.state;
  }
  return { state: s, view: viewFor(s, 'p0') };
}

const render = (view: GameView, target: BoardTarget | null = null, selected = null as null | { kind: 'vertex'; id: number }) =>
  renderToStaticMarkup(
    <I18nProvider>
      <Board view={view} target={target} selected={selected} />
    </I18nProvider>,
  );
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

const MAPS: [string, number, GameMode][] = [
  ['classic 19 (2-4 players, standard)', 3, 'standard'],
  ['large 30 (5 players, standard)', 5, 'standard'],
  ['short 14 (2-4 players, short)', 3, 'short'],
];

describe('the board is drawn from the map data', () => {
  for (const [name, n, mode] of MAPS) {
    describe(name, () => {
      const { view } = game(n, mode);
      const geo = boardGeometry(view.map, view.harbors);

      it('frames every corner, tile and harbor badge, and no tile is left out of the picture', () => {
        const { box, topo } = geo;
        for (const v of topo.vertices) {
          expect(v.x).toBeGreaterThan(box.minX);
          expect(v.x).toBeLessThan(box.maxX);
          expect(v.y).toBeGreaterThan(box.minY);
          expect(v.y).toBeLessThan(box.maxY);
        }
        expect(geo.harbors).toHaveLength(view.harbors.length);
        for (const h of geo.harbors) {
          expect(h.x - 0.4).toBeGreaterThan(box.minX);
          expect(h.x + 0.4).toBeLessThan(box.maxX);
          expect(h.y - 0.4).toBeGreaterThan(box.minY);
          expect(h.y + 0.4).toBeLessThan(box.maxY);
          // the badge sits out at sea: farther from every tile centre than a tile's own radius
          for (const tile of topo.tiles) expect(Math.hypot(h.x - tile.x, h.y - tile.y)).toBeGreaterThan(1.05);
        }
      });

      it('fits the screen: the camera shows the whole frame at a phone size and keeps the aspect ratio', () => {
        for (const [w, h] of [[390, 460], [390, 300], [1000, 700]] as const) {
          const cam = fitCamera(geo.box, w, h);
          const [x, y, vw, vh] = viewBoxOf(cam, w, h).split(' ').map(Number);
          expect(x).toBeLessThanOrEqual(geo.box.minX + 1e-9);
          expect(y).toBeLessThanOrEqual(geo.box.minY + 1e-9);
          expect(x + vw).toBeGreaterThanOrEqual(geo.box.maxX - 1e-9);
          expect(y + vh).toBeGreaterThanOrEqual(geo.box.maxY - 1e-9);
          expect(vw / vh).toBeCloseTo(w / h, 6);
        }
      });

      it('draws every tile with a pattern, every number token, red 6 and 8, one robber, every harbor', () => {
        const html = render(view);
        expect(count(html, /class="tile"/g)).toBe(view.tiles.length);
        for (const kind of new Set(view.tiles.map((t) => t.kind))) expect(html).toContain(`url(#pat-${kind})`);
        for (const kind of ['lumber', 'brick', 'wool', 'grain', 'ore', 'desert']) expect(html).toContain(`id="pat-${kind}"`);
        const numbers = view.tiles.map((t) => t.number).filter((x): x is number => x !== null);
        expect(count(html, /class="token"/g)).toBe(numbers.length);
        const red = count(html, /fill="#c4261d"[^>]*class="svg-num"/g);
        const sixesAndEights = numbers.filter((x) => x === 6 || x === 8).length;
        expect(red).toBe(sixesAndEights);
        expect(count(html, /class="robber"/g)).toBe(1);
        expect(count(html, /class="harbor"/g)).toBe(view.harbors.length);
        // a harbor reads as a ratio and, for the specific ones, a resource
        expect(html).toContain('3:1');
        expect(html).toContain('2:1');
        expect(html).toMatch(/2:1 \w+ harbor|3:1 harbor/);
      });

      it('draws the pieces of every player in their colour, with the seat number on buildings', () => {
        const html = render(view);
        const buildings = Object.keys(view.buildings).length;
        expect(buildings).toBe(n * 2);
        expect(count(html, /class="building"/g)).toBe(buildings);
        expect(count(html, /class="road"/g)).toBe(Object.keys(view.roads).length);
        for (const p of view.players) expect(html).toContain(PLAYER_COLORS[p.seat]);
      });
    });
  }
});

describe('highlights', () => {
  const { view, state } = game(3, 'standard');

  it('marks tappable corners, edges, tiles and capture targets, and the selected one differently', () => {
    const me = state.players[0].id;
    void me;
    const v = render(view, { kind: 'vertex', ids: [1, 2, 3] });
    expect(count(v, /class="spot spot-vertex"/g)).toBe(3);
    const e = render(view, { kind: 'edge', ids: [4, 5] });
    expect(count(e, /class="spot spot-edge"/g)).toBe(2);
    const t = render(view, { kind: 'tile', ids: [0, 1, 2, 3] });
    expect(count(t, /class="spot spot-tile"/g)).toBe(4);
    const sel = render(view, { kind: 'vertex', ids: [1, 2] }, { kind: 'vertex', id: 2 });
    expect(count(sel, /data-selected="true"/g)).toBe(1);
    const owned = Object.entries(view.buildings)[0];
    const pieces = render(view, {
      kind: 'piece',
      pieces: [
        { kind: owned[1].kind, id: Number(owned[0]), valid: true },
        { kind: 'road', id: Number(Object.keys(view.roads)[0]), valid: false },
      ],
    });
    expect(count(pieces, /data-valid="true"/g)).toBe(1);
    expect(count(pieces, /data-valid="false"/g)).toBe(1);
  });

  it('each tappable spot is a keyboard-reachable button with a name', () => {
    const html = render(view, { kind: 'vertex', ids: [7] });
    expect(html).toMatch(/role="button"[^>]*tabindex="0"[^>]*aria-label="Corner 7"|role="button" tabIndex="0" aria-label="Corner 7"/i);
  });

  it('draws no highlight when nothing can be tapped', () => {
    expect(count(render(view, null), /class="spot/g)).toBe(0);
  });

  it('has zoom controls with names for assistive technology', () => {
    const html = render(view);
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('aria-label="Fit the map"');
  });
});

describe('tapping', () => {
  it('chooses the nearest highlighted spot within reach, and nothing when none is close', () => {
    const spots = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 1, y: 0 }, { id: 3, x: 5, y: 5 }];
    expect(nearest(spots, 0.4, 0.1, 0.8)?.id).toBe(1);
    expect(nearest(spots, 0.6, 0, 0.8)?.id).toBe(2);
    expect(nearest(spots, 3, 3, 0.8)).toBeNull();
    expect(nearest([], 0, 0, 1)).toBeNull();
  });

  it('counts the probability dots under a token', () => {
    expect([2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map(probabilityDots)).toEqual([1, 2, 3, 4, 5, 5, 4, 3, 2, 1]);
  });
});

describe('player colours', () => {
  it('stand out from the sea and each carry a dark outline they read against', () => {
    for (const c of PLAYER_COLORS) {
      expect(contrast(c, SEA), c).toBeGreaterThan(4);
      expect(contrast(c, PIECE_OUTLINE), c).toBeGreaterThan(4.5);
    }
  });

  it('are five different colours, none a terrain colour', () => {
    expect(new Set(PLAYER_COLORS).size).toBe(5);
    for (const c of PLAYER_COLORS) for (const terrain of Object.values(TERRAIN_COLOR)) expect(c.toLowerCase()).not.toBe(terrain.toLowerCase());
  });
});

describe('tapping a road (every edge of every map, at the scale of a 360 px phone)', () => {
  const maps = [
    { id: 'classic19', n: 3, mode: 'standard' as GameMode },
    { id: 'large30', n: 5, mode: 'standard' as GameMode },
    { id: 'short14', n: 2, mode: 'short' as GameMode },
  ];
  /** the old measure: the road whose middle is nearest, and only within reach of its middle (null when none is) */
  const byMiddle = (cands: { id: number; x: number; y: number }[], x: number, y: number, reach: number) => {
    let best: number | null = null;
    let bestD = reach;
    for (const c of cands) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d <= bestD) {
        bestD = d;
        best = c.id;
      }
    }
    return best;
  };

  for (const map of maps) {
    for (const zoom of [1, 5]) {
      it(`${map.id}: a fingertip on the line, anywhere along it up to its very end, picks that road (${zoom === 1 ? 'fitted' : 'zoomed in 5x'})`, () => {
        const { view } = game(map.n, map.mode, false);
        const geo = boardGeometry(view.map, view.harbors);
        const { topo } = geo;
        const scale = fitCamera(geo.box, 360, 320, 52).scale * zoom; // the board area of a 360x640 phone, at this zoom
        const px = (n: number) => n / scale;
        const cands = topo.edges.map((e, id) => ({ id, x: e.x, y: e.y, segment: segmentOf(topo, id) }));
        let tried = 0;
        let wrongNew = 0;
        let wrongOld = 0;
        for (const [id, e] of topo.edges.entries()) {
          const a = topo.vertices[e.a];
          const b = topo.vertices[e.b];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          for (const frac of [-0.45, -0.4, -0.3, -0.15, 0, 0.15, 0.3, 0.4, 0.45]) {
            for (const across of [-2, 0, 2]) {
              // closer than 3 px to a corner, three roads meet under the finger: no one road is meant
              if ((0.5 - Math.abs(frac)) * len * scale < 3) continue;
              const x = e.x + ux * frac * len - uy * px(across);
              const y = e.y + uy * frac * len + ux * px(across);
              tried++;
              if (nearest(cands, x, y, px(30))?.id !== id) wrongNew++;
              if (byMiddle(cands, x, y, px(30)) !== id) wrongOld++;
            }
          }
        }
        expect(tried).toBeGreaterThan(topo.edges.length * 10);
        expect(wrongNew, `${map.id}: ${wrongNew} of ${tried} taps picked another road or none`).toBe(0);
        // zoomed in, a road is longer than a finger's reach from its middle: the old measure lost the taps near the ends (the same as the browser test shows)
        if (zoom === 5) expect(wrongOld, `${map.id}: the old measure got ${wrongOld} of ${tried} wrong`).toBeGreaterThan(0);
      });
    }
  }

  it('a tap near the end of one road picks it, where the middle of its neighbour is nearer', () => {
    const a = { id: 1, x: 1, y: 0, segment: { x1: 0, y1: 0, x2: 2, y2: 0 } };
    const b = { id: 2, x: 2.5, y: 0.5, segment: { x1: 2, y1: 0, x2: 3, y2: 1 } };
    expect(nearest([a, b], 1.9, 0.05, 0.5)?.id).toBe(1);
    expect(nearest([a, b], 2.4, 0.4, 0.5)?.id).toBe(2);
    expect(nearest([a, b], 1.5, 3, 0.5)).toBeNull();
    // the reach is measured to the line: a tap 0.3 off the middle is in, 0.6 is out
    expect(nearest([a], 1, 0.3, 0.5)?.id).toBe(1);
    expect(nearest([a], 1, 0.6, 0.5)).toBeNull();
  });
});
