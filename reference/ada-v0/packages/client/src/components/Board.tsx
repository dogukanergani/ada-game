import { memo, type KeyboardEvent } from 'react';
import { TOPOLOGY as T, type GameView, type Tile } from '@ada/game-core';
import { TILE_COLOR } from '../theme';

/** One game unit = S px in SVG space. */
const S = 54;
const PAD = 1.05;
const { minX, minY, maxX, maxY } = T.bounds;
const VIEWBOX = `${(minX - PAD) * S} ${(minY - PAD) * S} ${(maxX - minX + 2 * PAD) * S} ${(maxY - minY + 2 * PAD) * S}`;

const hexPoints = (tileId: number, k: number) => {
  const t = T.tiles[tileId];
  return t.corners
    .map((c) => {
      const v = T.vertices[c];
      return `${(t.x + (v.x - t.x) * k) * S},${(t.y + (v.y - t.y) * k) * S}`;
    })
    .join(' ');
};
const POINTS = T.tiles.map((t) => hexPoints(t.id, 0.965));
const SHOAL = T.tiles.map((t) => hexPoints(t.id, 1.14));

const onKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

/* Map-symbol fills: each terrain reads by pattern as well as by colour. */
const Defs = () => (
  <defs>
    <pattern id="pat-lumber" width="18" height="18" patternUnits="userSpaceOnUse">
      <rect width="18" height="18" fill={TILE_COLOR.lumber} />
      <path d="M3 9 L6 2 L9 9Z M12 17 L15 10 L18 17Z" fill="#1c4a2d" />
    </pattern>
    <pattern id="pat-brick" width="20" height="12" patternUnits="userSpaceOnUse">
      <rect width="20" height="12" fill={TILE_COLOR.brick} />
      <path d="M0 0H20M0 6H20M10 0V6M0 6V12M20 6V12" stroke="#8a3c1d" strokeWidth="1.3" fill="none" />
    </pattern>
    <pattern id="pat-wool" width="14" height="14" patternUnits="userSpaceOnUse">
      <rect width="14" height="14" fill={TILE_COLOR.wool} />
      <circle cx="3.5" cy="3.5" r="1.6" fill="#c7de94" />
      <circle cx="10.5" cy="10.5" r="1.6" fill="#c7de94" />
    </pattern>
    <pattern id="pat-grain" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
      <rect width="9" height="9" fill={TILE_COLOR.grain} />
      <path d="M0 0V9" stroke="#b08c1a" strokeWidth="1.7" />
    </pattern>
    <pattern id="pat-ore" width="22" height="14" patternUnits="userSpaceOnUse">
      <rect width="22" height="14" fill={TILE_COLOR.ore} />
      <path d="M1 13 L6 4 L11 13 M11 13 L16 6 L21 13" stroke="#4d5662" strokeWidth="1.7" fill="none" strokeLinejoin="round" />
    </pattern>
    <pattern id="pat-desert" width="12" height="12" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill={TILE_COLOR.desert} />
      <circle cx="3" cy="3" r="0.9" fill="#a8975f" />
      <circle cx="9" cy="8" r="0.9" fill="#a8975f" />
    </pattern>
  </defs>
);

const TileLayer = memo(function TileLayer({ tiles, robber }: { tiles: Tile[]; robber: number }) {
  return (
    <g>
      {T.tiles.map((t) => (
        <polygon key={`s${t.id}`} points={SHOAL[t.id]} className="shoal" />
      ))}
      {tiles.map((tile) => {
        const t = T.tiles[tile.id];
        const cx = t.x * S;
        const cy = t.y * S;
        const hot = tile.number === 6 || tile.number === 8;
        const pips = tile.number ? 6 - Math.abs(7 - tile.number) : 0;
        const isRobber = tile.id === robber;
        return (
          <g key={tile.id}>
            <polygon points={POINTS[tile.id]} fill={`url(#pat-${tile.kind})`} className="tile" />
            {tile.number && (
              <g opacity={isRobber ? 0.4 : 1}>
                <circle cx={cx} cy={cy} r={17} className="token" />
                <text x={cx} y={cy - 1.5} className={`token-num${hot ? ' hot' : ''}`}>
                  {tile.number}
                </text>
                {Array.from({ length: pips }, (_, i) => (
                  <circle key={i} cx={cx + (i - (pips - 1) / 2) * 4.2} cy={cy + 10} r={1.5} className={`pip${hot ? ' hot' : ''}`} />
                ))}
              </g>
            )}
            {isRobber && (
              <g transform={`translate(${cx} ${cy})`} className="robber">
                <circle cx={0} cy={-10} r={7} />
                <path d="M-10 13 Q-10 -3 0 -3 Q10 -3 10 13 Z" />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
});

const House = ({ x, y, color, city }: { x: number; y: number; color: string; city: boolean }) => (
  <path
    transform={`translate(${x} ${y})`}
    d={city ? 'M-13 8 V-3 H-4 V-10 L2 -15 L8 -10 V-3 H13 V8 Z' : 'M-9 7 V-2 L0 -10 L9 -2 V7 Z'}
    fill={color}
    className="building"
  />
);

interface BoardProps {
  game: GameView;
  vertexSpots: number[];
  edgeSpots: number[];
  tileSpots: number[];
  onVertex: (v: number) => void;
  onEdge: (e: number) => void;
  onTile: (t: number) => void;
}

export function Board({ game, vertexSpots, edgeSpots, tileSpots, onVertex, onEdge, onTile }: BoardProps) {
  const color = new Map(game.players.map((p) => [p.id, p.color]));
  return (
    <svg className="board" viewBox={VIEWBOX} role="img" aria-label="Oyun tahtası" preserveAspectRatio="xMidYMid meet">
      <Defs />
      <TileLayer tiles={game.tiles} robber={game.robber} />

      {tileSpots.map((id) => (
        <polygon
          key={`ts${id}`}
          points={POINTS[id]}
          className="spot-tile"
          role="button"
          tabIndex={0}
          aria-label="Haydutu buraya taşı"
          onClick={() => onTile(id)}
          onKeyDown={onKey(() => onTile(id))}
        />
      ))}

      {Object.entries(game.roads).map(([eid, owner]) => {
        const e = T.edges[Number(eid)];
        const a = T.vertices[e.a];
        const b = T.vertices[e.b];
        const props = { x1: a.x * S, y1: a.y * S, x2: b.x * S, y2: b.y * S };
        return (
          <g key={`r${eid}`}>
            <line {...props} className="road-outline" />
            <line {...props} stroke={color.get(owner)} className="road" />
          </g>
        );
      })}

      {edgeSpots.map((id) => {
        const e = T.edges[id];
        const a = T.vertices[e.a];
        const b = T.vertices[e.b];
        const props = { x1: a.x * S, y1: a.y * S, x2: b.x * S, y2: b.y * S };
        return (
          <g key={`es${id}`} className="spot" role="button" tabIndex={0} aria-label="Yol koy" onClick={() => onEdge(id)} onKeyDown={onKey(() => onEdge(id))}>
            <line {...props} className="hit" />
            <line {...props} className="spot-edge" />
          </g>
        );
      })}

      {Object.entries(game.buildings).map(([vid, b]) => {
        const v = T.vertices[Number(vid)];
        return <House key={`b${vid}`} x={v.x * S} y={v.y * S} color={color.get(b.owner) ?? '#fff'} city={b.kind === 'city'} />;
      })}

      {vertexSpots.map((id) => {
        const v = T.vertices[id];
        return (
          <g
            key={`vs${id}`}
            className="spot"
            role="button"
            tabIndex={0}
            aria-label="Buraya kur"
            onClick={() => onVertex(id)}
            onKeyDown={onKey(() => onVertex(id))}
          >
            <circle cx={v.x * S} cy={v.y * S} r={20} className="hit" />
            <circle cx={v.x * S} cy={v.y * S} r={8} className="spot-dot" />
          </g>
        );
      })}
    </svg>
  );
}
