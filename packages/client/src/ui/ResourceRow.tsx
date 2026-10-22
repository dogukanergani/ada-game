import type { ReactNode } from 'react';
import { RESOURCES, type Hand, type Resource } from '@ada/game-core';
import { useT } from '../i18n/context';
import type { Translate } from '../i18n';
import type { TileReason } from '../game/tradeView';
import { ResourceIcon } from './ResourceIcon';

/** A reason a row is off, in a few words. */
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

interface RowProps {
  resource: Resource;
  /** "block" and "resource" let tests and screen readers find a row */
  block: string;
  pressed?: boolean;
  disabled?: boolean;
  /** how many are chosen (offers only; shown when above zero) */
  count?: number;
  /** line under the name, e.g. "you have 3" */
  sub?: string;
  /** why it is off, shown in place of `sub` */
  reason?: string | null;
  /** a badge at the end, e.g. the ratio "4:1" */
  badge?: ReactNode;
  label: string;
  onPress: () => void;
  /** a "−" that takes one away (offers only); its place is kept free so the row does not jump */
  onRemove?: () => void;
  removeLabel?: string;
}

/**
 * A resource as one compact row: its picture on a disk in the terrain colour and
 * pattern, its name, a short line (what is in the hand, or why the row is off)
 * and a badge or count. Colour never carries the meaning alone: the picture has
 * the terrain pattern and the name is written. A row that is off stays tappable
 * (it says why) and does nothing.
 */
export function ResourceRow({ resource, block, pressed, disabled, count = 0, sub, reason, badge, label, onPress, onRemove, removeLabel }: RowProps) {
  const t = useT();
  return (
    <div className="rrow-wrap" data-terrain={resource}>
      <button
        type="button"
        className={onRemove ? 'rrow with-remove' : 'rrow'}
        data-block={block}
        data-resource={resource}
        aria-pressed={pressed}
        aria-disabled={disabled}
        aria-label={label}
        onClick={() => !disabled && onPress()}
      >
        <ResourceIcon resource={resource} size={26} />
        <span className="rrow-text">
          <span className="rrow-name">{t(`resource.${resource}`)}</span>
          <span className={`rrow-sub${reason ? ' off' : ''}`}>{reason ?? sub ?? ' '}</span>
        </span>
        {count > 0 && <span className="rrow-count">{count}</span>}
        {badge && <span className="rrow-badge">{badge}</span>}
      </button>
      {onRemove && (
        <button type="button" className="rrow-remove" aria-label={removeLabel} aria-hidden={count > 0 ? undefined : true} tabIndex={count > 0 ? 0 : -1} data-empty={count > 0 ? undefined : true} onClick={onRemove}>
          <span className="rrow-remove-dot" aria-hidden="true">
            −
          </span>
        </button>
      )}
    </div>
  );
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
