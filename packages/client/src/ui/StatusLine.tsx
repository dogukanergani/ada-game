import { useApp } from '../net/app';
import { useT } from '../i18n/context';

/** Always-visible connection state; quiet when all is well. */
export function StatusLine() {
  const { state, api } = useApp();
  const t = useT();
  const { conn, attempt } = state;
  if (conn === 'online') return null;

  const text =
    conn === 'connecting'
      ? t('conn.connecting')
      : conn === 'reconnecting'
        ? attempt > 0
          ? t('conn.reconnecting', { n: attempt })
          : t('conn.offline')
        : conn === 'replaced'
          ? t('conn.replaced')
          : t('conn.incompatible.title');

  return (
    <div className="status-line" role="status" aria-live="polite" data-conn={conn}>
      <span className="status-dot" aria-hidden="true" />
      <span>{text}</span>
      {conn === 'reconnecting' && (
        <button type="button" className="link-button" onClick={api.retryNow}>
          {t('conn.retry')}
        </button>
      )}
    </div>
  );
}
