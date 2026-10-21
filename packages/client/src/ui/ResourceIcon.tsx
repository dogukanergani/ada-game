import type { Resource } from '@ada/game-core';
import { GLYPH_PATHS } from '../board/glyphs';
import { INK, TERRAIN_COLOR, TERRAIN_DARK } from '../board/colors';

/** A resource as a small picture on a disk of its terrain colour. Decorative: the name is always written next to it. */
export function ResourceIcon({ resource, size = 22 }: { resource: Resource; size?: number }) {
  return (
    <svg className="res-icon" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <circle cx="14" cy="14" r="13" fill={TERRAIN_COLOR[resource]} stroke={TERRAIN_DARK[resource]} strokeWidth="1.5" />
      <g transform="translate(3 3)" fill={INK} fillOpacity="0.95" stroke={TERRAIN_DARK[resource]} strokeWidth="0.8">
        <path d={GLYPH_PATHS[resource]} />
      </g>
    </svg>
  );
}
