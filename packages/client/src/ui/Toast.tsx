import { useEffect } from 'react';
import { describeError } from '../i18n/format';
import { useT } from '../i18n/context';
import { useApp } from '../net/app';

const SHOW_MS = 7000;

/** Errors and connection notices, in words, with what to do next. Goes away by itself or on tap. */
export function Toast() {
  const { state, api } = useApp();
  const t = useT();
  const n = state.notice;

  useEffect(() => {
    if (!n) return;
    const timer = setTimeout(() => api.dispatch({ t: 'dismiss' }), SHOW_MS);
    return () => clearTimeout(timer);
  }, [n, api]);

  if (!n) return null;
  const nameOf = (id: string) =>
    state.game?.view.players.find((p) => p.id === id)?.name ?? state.lobby?.players.find((p) => p.id === id)?.name ?? '?';
  const text =
    n.kind === 'error'
      ? describeError(t, n.error, nameOf)
      : t(n.notice.type === 'playerDisconnected' ? 'presence.playerDisconnected' : 'presence.playerReconnected', { player: nameOf(n.notice.player) });

  return (
    <div className="toast" data-kind={n.kind} role={n.kind === 'error' ? 'alert' : 'status'}>
      <span>{text}</span>
      <button type="button" className="link-button" onClick={() => api.dispatch({ t: 'dismiss' })}>
        {t('common.dismiss')}
      </button>
    </div>
  );
}
