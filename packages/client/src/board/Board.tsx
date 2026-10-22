import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { RESOURCES, type GameView, type PieceKind, type Resource } from '@ada/game-core';
import { useT } from '../i18n/context';
import {
  AMBER, INK, PANEL, PIECE_OUTLINE, SEA, SHALLOWS, TERRAIN_COLOR, TERRAIN_DARK, contrast, playerColor,
} from './colors';
import { CITY_PATH, DESERT_GLYPH, GLYPH_PATHS, HOUSE_PATH } from './glyphs';
import {
  boardGeometry, fitCamera, nearest, probabilityDots, segmentOf, tilePoints, toUnits, viewBoxOf, type Camera, type Candidate,
} from './geometry';

export type PieceRef = { kind: PieceKind; id: number; valid: boolean };
export type BoardTarget =
  | { kind: 'vertex'; ids: number[] }
  | { kind: 'edge'; ids: number[] }
  | { kind: 'tile'; ids: number[] }
  | { kind: 'piece'; pieces: PieceRef[] };
export type Pick = { kind: 'vertex' | 'edge' | 'tile' | PieceKind; id: number };

interface Props {
  view: GameView;
  /** what can be tapped right now (null: the board is only for looking) */
  target: BoardTarget | null;
  selected?: Pick | null;
  onPick?: (p: Pick) => void;
  /** after a roll, for a moment: the tiles that produced and the tile the robber blocked */
  production?: { hit: number[]; robbed: number | null } | null;
  /** px kept free at the top of the fitted view (where the resting dice sit) */
  topInset?: number;
}

const ZOOM_MAX = 5;
const ZOOM_MIN = 0.85;
/** the invisible band around a road that takes a tap, in screen pixels across (a finger, not the thin drawn line) */
const EDGE_HIT_PX = 44;
/** how close a tap must land to a highlighted spot to choose it, in screen pixels */
const TAP_RADIUS_PX = 30;
const DRAG_PX = 6;

const textOn = (fill: string) => (contrast(fill, PIECE_OUTLINE) > contrast(fill, '#ffffff') ? PIECE_OUTLINE : '#ffffff');

function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  // a sensible phone-sized default, also what server rendering draws
  const [size, setSize] = useState({ w: 390, h: 460 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function Board({ view, target, selected = null, onPick, production = null, topInset = 0 }: Props) {
  const t = useT();
  const harborKey = view.harbors.map((h) => `${h.edge}${h.type}`).join();
  const geo = useMemo(() => boardGeometry(view.map, view.harbors), [view.map.id, harborKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { topo } = geo;
  const [wrapRef, { w, h }] = useSize<HTMLDivElement>();
  const fit = useMemo(() => fitCamera(geo.box, w, h, topInset), [geo, w, h, topInset]);
  const [user, setUser] = useState<Camera | null>(null);
  const cam = user ?? fit;
  const camRef = useRef(cam);
  camRef.current = cam;

  const clamp = useCallback(
    (c: Camera): Camera => {
      const scale = Math.min(fit.scale * ZOOM_MAX, Math.max(fit.scale * ZOOM_MIN, c.scale));
      const cx = Math.min(geo.box.maxX, Math.max(geo.box.minX, c.cx));
      const cy = Math.min(geo.box.maxY, Math.max(geo.box.minY, c.cy));
      return { cx, cy, scale };
    },
    [fit.scale, geo.box],
  );

  /* ---------- candidates the player can pick ---------- */
  const candidates = useMemo<(Candidate & { kind: Pick['kind']; valid: boolean })[]>(() => {
    if (!target) return [];
    if (target.kind === 'vertex') return target.ids.map((id) => ({ id, kind: 'vertex', valid: true, x: topo.vertices[id].x, y: topo.vertices[id].y }));
    if (target.kind === 'edge') return target.ids.map((id) => ({ id, kind: 'edge', valid: true, x: topo.edges[id].x, y: topo.edges[id].y, segment: segmentOf(topo, id) }));
    if (target.kind === 'tile') return target.ids.map((id) => ({ id, kind: 'tile', valid: true, x: topo.tiles[id].x, y: topo.tiles[id].y }));
    return target.pieces.map((p) => ({
      id: p.id,
      kind: p.kind,
      valid: p.valid,
      x: p.kind === 'road' ? topo.edges[p.id].x : topo.vertices[p.id].x,
      y: p.kind === 'road' ? topo.edges[p.id].y : topo.vertices[p.id].y,
      segment: p.kind === 'road' ? segmentOf(topo, p.id) : undefined,
    }));
  }, [target, topo]);

  /* ---------- pan, pinch, tap ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, startDist: 0, startScale: 1, downAt: { x: 0, y: 0 } });
  const svgRef = useRef<SVGSVGElement>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    svgRef.current?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) gesture.current = { moved: false, startDist: 0, startScale: camRef.current.scale, downAt: local(e) };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { ...gesture.current, moved: true, startDist: Math.hypot(a.x - b.x, a.y - b.y), startScale: camRef.current.scale };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    pointers.current.set(e.pointerId, now);
    const c = camRef.current;
    if (pointers.current.size === 1) {
      if (!gesture.current.moved && Math.hypot(now.x - gesture.current.downAt.x, now.y - gesture.current.downAt.y) < DRAG_PX) return;
      gesture.current.moved = true;
      setUser(clamp({ ...c, cx: c.cx - (now.x - prev.x) / c.scale, cy: c.cy - (now.y - prev.y) / c.scale }));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.startDist > 0) setUser(clamp({ ...c, scale: gesture.current.startScale * (dist / gesture.current.startDist) }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const had = pointers.current.has(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!had || gesture.current.moved || pointers.current.size > 0 || !target || !onPick) return;
    // a tap: choose the highlighted spot nearest to it, not only one exactly under the finger
    const p = local(e);
    const u = toUnits(camRef.current, w, h, p.x, p.y);
    const hit = nearest(candidates, u.x, u.y, TAP_RADIUS_PX / camRef.current.scale);
    if (hit) onPick({ kind: (hit as (typeof candidates)[number]).kind, id: hit.id });
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camRef.current;
      const r = el.getBoundingClientRect();
      const before = toUnits(c, r.width, r.height, e.clientX - r.left, e.clientY - r.top);
      const scale = c.scale * Math.exp(-e.deltaY * 0.0015);
      const next = clamp({ ...c, scale });
      // keep the point under the cursor where it was
      const after = toUnits(next, r.width, r.height, e.clientX - r.left, e.clientY - r.top);
      setUser(clamp({ ...next, cx: next.cx + (before.x - after.x), cy: next.cy + (before.y - after.y) }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [clamp]);

  const zoomBy = (f: number) => setUser(clamp({ ...camRef.current, scale: camRef.current.scale * f }));

  const keyPick = (e: KeyboardEvent, kind: Pick['kind'], id: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick?.({ kind, id });
    }
  };

  /* ---------- drawing ---------- */
  const seatOf = (id: string) => view.players.find((p) => p.id === id)?.seat ?? 0;
  const resourceName = (r: Resource) => t(`resource.${r}`);
  const isSelected = (kind: Pick['kind'], id: number) => selected?.kind === kind && selected.id === id;
  const SEA_BOX = { x: geo.box.minX - 30, y: geo.box.minY - 30, w: geo.box.maxX - geo.box.minX + 60, h: geo.box.maxY - geo.box.minY + 60 };

  return (
    <div className="board" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="board-svg"
        viewBox={viewBoxOf(cam, w, h)}
        role="group"
        aria-label={t('board.label')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <pattern id="sea-grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 H 0 V 1" fill="none" stroke={INK} strokeOpacity="0.07" strokeWidth="0.012" />
          </pattern>
          {RESOURCES.map((r) => (
            <pattern key={r} id={`pat-${r}`} width="0.62" height="0.62" patternUnits="userSpaceOnUse">
              <path d={GLYPH_PATHS[r]} transform="translate(0.07 0.07) scale(0.02)" fill={TERRAIN_DARK[r]} fillOpacity="0.55" />
            </pattern>
          ))}
          <pattern id="pat-desert" width="0.62" height="0.62" patternUnits="userSpaceOnUse">
            <path d={DESERT_GLYPH} transform="translate(0.1 0.1) scale(0.017)" fill={TERRAIN_DARK.desert} fillOpacity="0.5" />
          </pattern>
        </defs>

        <rect x={SEA_BOX.x} y={SEA_BOX.y} width={SEA_BOX.w} height={SEA_BOX.h} fill={SEA} />
        <rect x={SEA_BOX.x} y={SEA_BOX.y} width={SEA_BOX.w} height={SEA_BOX.h} fill="url(#sea-grid)" />

        {/* the shelf of shallow water around the land */}
        <g fill={SHALLOWS} stroke={SHALLOWS} strokeWidth="0.55" strokeLinejoin="round">
          {topo.tiles.map((tile) => (
            <polygon key={tile.id} points={tilePoints(topo, tile.id)} />
          ))}
        </g>

        {/* harbors: planks to the shore and a badge with the ratio and the resource */}
        {geo.harbors.map((hb) => {
          const isAny = hb.type === 'any';
          const label = isAny ? t('board.harbor.any') : t('board.harbor.resource', { resource: resourceName(hb.type as Resource) });
          return (
            <g key={hb.edge} className="harbor" data-edge={hb.edge} data-type={hb.type}>
              <title>{label}</title>
              <line x1={hb.ax} y1={hb.ay} x2={hb.x} y2={hb.y} stroke="#c9a36b" strokeWidth="0.05" />
              <line x1={hb.bx} y1={hb.by} x2={hb.x} y2={hb.y} stroke="#c9a36b" strokeWidth="0.05" />
              <circle cx={hb.x} cy={hb.y} r="0.42" fill={PANEL} stroke="#c9a36b" strokeWidth="0.05" />
              {isAny ? (
                <text x={hb.x} y={hb.y + 0.09} textAnchor="middle" fontSize="0.32" fontWeight="800" fill={INK} className="svg-num">
                  3:1
                </text>
              ) : (
                <>
                  <text x={hb.x} y={hb.y - 0.07} textAnchor="middle" fontSize="0.27" fontWeight="800" fill={INK} className="svg-num">
                    2:1
                  </text>
                  <circle cx={hb.x} cy={hb.y + 0.17} r="0.15" fill={TERRAIN_COLOR[hb.type as Resource]} stroke={TERRAIN_DARK[hb.type as Resource]} strokeWidth="0.02" />
                  <path
                    d={GLYPH_PATHS[hb.type as Resource]}
                    transform={`translate(${hb.x - 0.115} ${hb.y + 0.055}) scale(0.0096)`}
                    fill={INK}
                  />
                </>
              )}
            </g>
          );
        })}

        {/* land */}
        {topo.tiles.map((tile) => {
          const kind = view.tiles[tile.id].kind;
          const number = view.tiles[tile.id].number;
          const hot = number === 6 || number === 8;
          const robber = view.robber === tile.id;
          const tokenY = tile.y - (robber ? 0.16 : 0);
          return (
            <g key={tile.id} className="tile" data-tile={tile.id} data-kind={kind}>
              <title>{number ? t('board.tileDesc', { terrain: t(`terrain.${kind}`), number }) : t('board.tileDesc.none', { terrain: t(`terrain.${kind}`) })}</title>
              <polygon points={tilePoints(topo, tile.id)} fill={TERRAIN_COLOR[kind]} stroke={TERRAIN_DARK[kind]} strokeWidth="0.035" strokeLinejoin="round" />
              <polygon points={tilePoints(topo, tile.id)} fill={`url(#pat-${kind})`} />
              {number !== null && (
                <g className="token" data-number={number} transform={`translate(${tile.x} ${tokenY})`}>
                  <circle r="0.36" fill="#f4ead0" stroke="#5b4a2b" strokeWidth="0.03" />
                  <text y="0.06" textAnchor="middle" fontSize={hot ? 0.42 : 0.36} fontWeight="800" fill={hot ? '#c4261d' : '#2a2418'} className="svg-num">
                    {number}
                  </text>
                  {Array.from({ length: probabilityDots(number) }, (_, i) => (
                    <circle key={i} cx={(i - (probabilityDots(number) - 1) / 2) * 0.085} cy="0.22" r="0.032" fill={hot ? '#c4261d' : '#2a2418'} />
                  ))}
                </g>
              )}
              {production?.hit.includes(tile.id) && number !== null && (
                <circle className="prod-ring" data-tile={tile.id} cx={tile.x} cy={tokenY} r="0.47" fill="none" stroke={AMBER} strokeWidth="0.09" />
              )}
              {production?.robbed === tile.id && (
                <g className="prod-blocked" data-tile={tile.id} role="img" aria-label={t('board.blocked')} transform={`translate(${tile.x + 0.42} ${tokenY - 0.3})`}>
                  <title>{t('board.blocked')}</title>
                  <circle r="0.2" fill="#8c1f17" stroke="#ffffff" strokeWidth="0.04" />
                  <path d="M -0.11 0.11 L 0.11 -0.11" stroke="#ffffff" strokeWidth="0.06" strokeLinecap="round" />
                  <circle r="0.11" fill="none" stroke="#ffffff" strokeWidth="0.04" />
                </g>
              )}
              {robber && (
                <g className="robber" transform={`translate(${tile.x} ${tile.y + 0.2})`}>
                  <title>{t('board.robber')}</title>
                  <path d="M -0.2 0.3 Q -0.15 -0.06 0 -0.06 Q 0.15 -0.06 0.2 0.3 Z" fill="#1b1f24" stroke="#ffffff" strokeWidth="0.03" />
                  <circle cy="-0.17" r="0.12" fill="#1b1f24" stroke="#ffffff" strokeWidth="0.03" />
                </g>
              )}
            </g>
          );
        })}

        {/* roads */}
        {Object.entries(view.roads).map(([id, owner]) => {
          const e = topo.edges[Number(id)];
          const a = topo.vertices[e.a];
          const b = topo.vertices[e.b];
          const inset = 0.13;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          const [x1, y1, x2, y2] = [a.x + ux * inset, a.y + uy * inset, b.x - ux * inset, b.y - uy * inset];
          return (
            <g key={id} className="road" data-edge={id} data-owner={owner}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={PIECE_OUTLINE} strokeWidth="0.22" strokeLinecap="round" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={playerColor(seatOf(owner))} strokeWidth="0.13" strokeLinecap="round" />
            </g>
          );
        })}

        {/* settlements and cities, with the seat number inside */}
        {Object.entries(view.buildings).map(([id, b]) => {
          const v = topo.vertices[Number(id)];
          const seat = seatOf(b.owner);
          const fill = playerColor(seat);
          const city = b.kind === 'city';
          return (
            <g key={id} className="building" data-vertex={id} data-kind={b.kind} data-owner={b.owner} transform={`translate(${v.x} ${v.y}) scale(${city ? 0.42 : 0.38})`}>
              <path d={city ? CITY_PATH : HOUSE_PATH} fill={fill} stroke={PIECE_OUTLINE} strokeWidth="0.11" strokeLinejoin="round" />
              <text y="0.33" textAnchor="middle" fontSize="0.5" fontWeight="800" fill={textOn(fill)} className="svg-num">
                {seat + 1}
              </text>
            </g>
          );
        })}

        {/* what can be tapped now */}
        {target?.kind === 'edge' &&
          target.ids.map((id) => {
            const e = topo.edges[id];
            const a = topo.vertices[e.a];
            const b = topo.vertices[e.b];
            const sel = isSelected('edge', id);
            return (
              <g key={id} className="spot spot-edge" data-edge={id} data-selected={sel} role="button" tabIndex={0} aria-label={t('board.edge', { id })} aria-pressed={sel} onKeyDown={(ev) => keyPick(ev, 'edge', id)}>
                <line className="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={EDGE_HIT_PX / cam.scale} strokeLinecap="round" />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PIECE_OUTLINE} strokeWidth={sel ? 0.26 : 0.2} strokeLinecap="round" />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel ? '#ffffff' : AMBER} strokeWidth={sel ? 0.16 : 0.1} strokeLinecap="round" strokeDasharray={sel ? undefined : '0.13 0.11'} />
              </g>
            );
          })}
        {target?.kind === 'vertex' &&
          target.ids.map((id) => {
            const v = topo.vertices[id];
            const sel = isSelected('vertex', id);
            return (
              <g key={id} className="spot spot-vertex" data-vertex={id} data-selected={sel} role="button" tabIndex={0} aria-label={t('board.vertex', { id })} aria-pressed={sel} onKeyDown={(ev) => keyPick(ev, 'vertex', id)}>
                <circle cx={v.x} cy={v.y} r={sel ? 0.3 : 0.24} fill="none" stroke={sel ? '#ffffff' : AMBER} strokeOpacity={sel ? 1 : 0.7} strokeWidth="0.045" />
                <circle cx={v.x} cy={v.y} r={sel ? 0.19 : 0.13} fill={AMBER} stroke={PIECE_OUTLINE} strokeWidth="0.035" />
              </g>
            );
          })}
        {target?.kind === 'tile' &&
          target.ids.map((id) => {
            const tile = topo.tiles[id];
            const sel = isSelected('tile', id);
            return (
              <g key={id} className="spot spot-tile" data-tile={id} data-selected={sel} role="button" tabIndex={0} aria-label={t('board.tile', { id })} aria-pressed={sel} onKeyDown={(ev) => keyPick(ev, 'tile', id)}>
                <circle cx={tile.x} cy={tile.y} r="0.72" fill={sel ? AMBER : 'none'} fillOpacity="0.28" stroke={sel ? '#ffffff' : AMBER} strokeWidth="0.07" strokeDasharray={sel ? undefined : '0.16 0.12'} />
              </g>
            );
          })}
        {target?.kind === 'piece' &&
          target.pieces.map((p) => {
            const sel = isSelected(p.kind, p.id);
            const color = p.valid ? AMBER : '#8b99a0';
            if (p.kind === 'road') {
              const e = topo.edges[p.id];
              const a = topo.vertices[e.a];
              const b = topo.vertices[e.b];
              return (
                <g key={`r${p.id}`} className="spot spot-piece" data-valid={p.valid} data-selected={sel} role="button" tabIndex={0} aria-label={t('board.piece', { piece: t('piece.road'), id: p.id })} aria-pressed={sel} onKeyDown={(ev) => keyPick(ev, 'road', p.id)}>
                  <line className="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={EDGE_HIT_PX / cam.scale} strokeLinecap="round" />
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PIECE_OUTLINE} strokeWidth="0.3" strokeLinecap="round" />
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel ? '#ffffff' : color} strokeWidth="0.18" strokeLinecap="round" strokeDasharray={sel ? undefined : '0.13 0.11'} />
                </g>
              );
            }
            const v = topo.vertices[p.id];
            return (
              <g key={`${p.kind}${p.id}`} className="spot spot-piece" data-valid={p.valid} data-selected={sel} role="button" tabIndex={0} aria-label={t('board.piece', { piece: t(`piece.${p.kind}`), id: p.id })} aria-pressed={sel} onKeyDown={(ev) => keyPick(ev, p.kind, p.id)}>
                <circle cx={v.x} cy={v.y} r={sel ? 0.4 : 0.34} fill="none" stroke={sel ? '#ffffff' : color} strokeWidth="0.07" strokeDasharray={sel ? undefined : '0.14 0.1'} />
              </g>
            );
          })}
      </svg>

      <div className="board-controls">
        <button type="button" className="board-button" onClick={() => zoomBy(1.4)} aria-label={t('board.zoomIn')}>
          +
        </button>
        <button type="button" className="board-button" onClick={() => zoomBy(1 / 1.4)} aria-label={t('board.zoomOut')}>
          −
        </button>
        <button type="button" className="board-button" onClick={() => setUser(null)} aria-label={t('board.fit')}>
          ⤢
        </button>
      </div>
    </div>
  );
}
