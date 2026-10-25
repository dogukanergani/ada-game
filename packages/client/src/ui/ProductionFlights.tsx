import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { GameView, Resource } from '@ada/game-core';
import { flightsFor } from '../game/flight';
import type { RollRecord } from '../net/store';
import { ResourceIcon } from './ResourceIcon';

/** milliseconds */
export const FLIGHT_MS = 600;
const STAGGER_MS = 80;
const MAX_STAGGER_MS = 240;

interface Item {
  key: string;
  player: string;
  resource: Resource;
  /** top-left start, relative to the layer */
  x: number;
  y: number;
  /** distance to travel to the seat */
  dx: number;
  dy: number;
  delay: number;
}

const SIZE = 24;
const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * The cards that a roll produced flying from their tiles to the seats of the players who got them.
 * Purely visual and drawn outside the board's SVG: the start is the tile's token and the end the
 * player's avatar, both read from where the browser has them on the screen, so zoom, pan and the
 * size of the window are already in the numbers. Plays once per live roll, never with reduced
 * motion, and never for a roll that was already there when the screen opened (`roll` is null then).
 */
export function ProductionFlights({ view, roll, active, reduced, host }: { view: GameView; roll: RollRecord | null; active: boolean; reduced: boolean; host: RefObject<HTMLElement | null> }) {
  const [items, setItems] = useState<Item[]>([]);
  const played = useRef(0);

  useLayoutEffect(() => {
    if (!active || !roll || reduced || played.current === roll.seq) return;
    played.current = roll.seq;
    const el = host.current;
    if (!el) return;
    const layer = el.getBoundingClientRect();
    const board = (el.querySelector('.board') ?? el).getBoundingClientRect();
    const next: Item[] = [];
    for (const f of flightsFor(view, roll.hitTiles, roll.gains)) {
      const token = el.querySelector(`.board [data-tile="${f.tile}"] .token`);
      const avatar = el.querySelector(`.pseat[data-player="${f.player}"] .pseat-avatar`);
      if (!token || !avatar) continue;
      const from = centre(token.getBoundingClientRect());
      const to = centre(avatar.getBoundingClientRect());
      // a tile panned out of sight starts its flight at the edge of the board
      const sx = Math.min(board.right, Math.max(board.left, from.x));
      const sy = Math.min(board.bottom, Math.max(board.top, from.y));
      for (let i = 0; i < f.count; i++) {
        next.push({
          key: `${roll.seq}-${f.tile}-${f.player}-${f.resource}-${i}`,
          player: f.player,
          resource: f.resource,
          x: sx - layer.left - SIZE / 2,
          y: sy - layer.top - SIZE / 2,
          dx: to.x - sx,
          dy: to.y - sy,
          delay: Math.min(MAX_STAGGER_MS, next.length * STAGGER_MS),
        });
      }
    }
    setItems(next);
  }, [active, roll, reduced, view, host]);

  /* a flight in progress must not outlive the resize that would make its numbers wrong */
  useLayoutEffect(() => {
    if (items.length === 0) return;
    const clear = () => setItems([]);
    window.addEventListener('resize', clear);
    return () => window.removeEventListener('resize', clear);
  }, [items.length]);

  if (reduced || items.length === 0) return null;
  const done = (key: string) => setItems((list) => list.filter((i) => i.key !== key));
  return (
    <div className="flight-layer" aria-hidden="true">
      {items.map((i) => (
        <Flier key={i.key} item={i} onDone={() => done(i.key)} />
      ))}
    </div>
  );
}

function Flier({ item, onDone }: { item: Item; onDone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') {
      onDone();
      return;
    }
    const a = el.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        { transform: `translate(${item.dx}px, ${item.dy}px) scale(0.55)`, opacity: 0.35 },
      ],
      { duration: FLIGHT_MS, delay: item.delay, easing: 'cubic-bezier(0.4, 0, 0.7, 1)', fill: 'both' },
    );
    a.onfinish = onDone;
    return () => a.cancel();
    // the item is fixed for the life of the flier
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span ref={ref} className="flier" data-flight="" data-player={item.player} data-resource={item.resource} data-dx={Math.round(item.dx)} data-dy={Math.round(item.dy)} style={{ left: item.x, top: item.y, opacity: 0 }}>
      <ResourceIcon resource={item.resource} size={SIZE} />
    </span>
  );
}
