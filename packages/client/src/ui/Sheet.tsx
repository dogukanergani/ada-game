import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../i18n/context';
import { useNoticeSlot } from './NoticeBar';

interface SheetProps {
  title: string;
  children: ReactNode;
  /** omit for a sheet the game forces open (discarding, choosing a victim) */
  onClose?: () => void;
  /** pinned under the scrolling content (an action bar that must stay in reach) */
  footer?: ReactNode;
  /** pinned between the title and the scrolling content (tabs that must stay in sight) */
  sub?: ReactNode;
  /** a wider panel on a wide screen (the two-column trade sheet) */
  wide?: boolean;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A panel over the game: a bottom sheet on a phone, a centred panel on a wide
 * screen. It is a modal dialog: focus moves in, Tab stays inside, Escape and a
 * tap outside close it (unless it is forced), and focus returns to where it was.
 */
export function Sheet({ title, children, onClose, footer, sub, wide = false }: SheetProps) {
  const t = useT();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  /* a sheet the game forces open (no onClose) is an obligation; every other sheet keeps the notices in sight */
  const notices = useNoticeSlot();

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    if (!el?.contains(document.activeElement)) el?.focus();
    return () => before?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className={wide ? 'sheet wide' : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          {onClose && (
            <button type="button" className="btn quiet" onClick={onClose} aria-label={t('sheet.close')}>
              ✕
            </button>
          )}
        </header>
        {onClose && notices}
        {sub && <div className="sheet-sub">{sub}</div>}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
