import type { ReactNode } from 'react';
import { RESOURCES, type Hand, type Resource } from '@ada/game-core';
import { GLYPH_PATHS } from '../board/glyphs';
import { TERRAIN_COLOR, TERRAIN_DARK } from '../board/colors';
import { useT } from '../i18n/context';
import type { Translate } from '../i18n';
import type { TileReason } from '../game/tradeView';
import { ResourceIcon } from './ResourceIcon';

/** A reason a tile is off, in a few words. */
export function tileReasonText(t: Translate, r: TileReason): string {
  switch (r.code) {
    case 'notYourTurn':
      return t('reason.notYourTurn');
    case 'short':
      return t('trade.reason.short', { n: r.n });
    case 'bankEmpty':
      return t('trade.reason.bankEmpty');
    case 'same':
      return t('trade.reason.same');
    case 'none':
      return t('trade.reason.none');
    case 'conflict':
      return t(r.side === 'give' ? 'trade.reason.conflictGive' : 'trade.reason.conflictWant');
  }
}

interface TileProps {
  resource: Resource;
  /** "block" and "resource" let tests and screen readers find a tile */
  block: string;
  pressed?: boolean;
  disabled?: boolean;
  /** big number on the tile (how many are chosen) */
  count?: number;
  /** line under the name, e.g. "you have 3" */
  sub?: string;
  /** why it is off, shown in place of `sub` */
  reason?: string | null;
  /** a badge in the corner, e.g. the ratio "4:1" */
  badge?: ReactNode;
  label: string;
  onPress: () => void;
  /** a small "−" that takes one away (offers only) */
  onRemove?: () => void;
  removeLabel?: string;
}

/**
 * A resource as a big tile in its terrain colour and pattern, with the name
 * written on it (colour alone never carries the meaning). Off tiles stay
 * tappable-looking but say why and do nothing.
 */
export function ResourceTile({ resource, block, pressed, disabled, count, sub, reason, badge, label, onPress, onRemove, removeLabel }: TileProps) {
  const patId = `rt-${resource}`;
  return (
    <div className="rtile-wrap">
      <button
        type="button"
        className="rtile"
        data-block={block}
        data-resource={resource}
        aria-pressed={pressed}
        aria-disabled={disabled}
        aria-label={label}
        onClick={() => !disabled && onPress()}
      >
        <svg className="rtile-bg" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <pattern id={patId} width="24" height="24" patternUnits="userSpaceOnUse">
              <path d={GLYPH_PATHS[resource]} transform="translate(3 3) scale(0.7)" fill={TERRAIN_DARK[resource]} fillOpacity="0.6" />
            </pattern>
          </defs>
          <rect width="100" height="60" fill={TERRAIN_COLOR[resource]} />
          <rect width="100" height="60" fill={`url(#${patId})`} />
        </svg>
        {count !== undefined && count > 0 && <span className="rtile-count">{count}</span>}
        {badge && <span className="rtile-badge">{badge}</span>}
        <span className="rtile-label">
          <ResourceName resource={resource} />
          <span className={`rtile-sub${reason ? ' off' : ''}`}>{reason ?? sub ?? ' '}</span>
        </span>
      </button>
      {onRemove && count !== undefined && count > 0 && (
        <button type="button" className="rtile-remove" aria-label={removeLabel} onClick={onRemove}>
          <span className="rtile-remove-dot" aria-hidden="true">
            −
          </span>
        </button>
      )}
    </div>
  );
}

function ResourceName({ resource }: { resource: Resource }) {
  const t = useT();
  return <span className="rtile-name">{t(`resource.${resource}`)}</span>;
}

/** A hand as small chips, "2 wool": colour, picture and name together. */
export function ResourceChips({ hand }: { hand: Partial<Hand> }) {
  const t = useT();
  return (
    <span className="chips">
      {RESOURCES.filter((r) => (hand[r] ?? 0) > 0).map((r) => (
        <span key={r} className="res-chip" data-resource={r}>
          <ResourceIcon resource={r} size={20} />
          <span className="res-chip-n">{hand[r]}</span>
          <span>{t(`resource.${r}`)}</span>
        </span>
      ))}
    </span>
  );
}

