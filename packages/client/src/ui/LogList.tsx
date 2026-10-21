import { useEffect, useRef } from 'react';
import type { GameView } from '@ada/game-core';
import { formatEvent } from '../i18n/format';
import { useT } from '../i18n/context';
import type { LogEntry } from '../net/store';

/** The game log, translated from the events the server sent this player (so it holds nothing secret). */
export function LogList({ view, log }: { view: GameView; log: LogEntry[] }) {
  const t = useT();
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [log.length]);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  if (log.length === 0) return <p className="field-hint">{t('log.empty')}</p>;
  return (
    <ol className="log-list">
      {log.map((l) => (
        <li key={l.id} data-type={l.event.type}>
          {formatEvent(l.event, { t, name, me: view.me })}
        </li>
      ))}
      <li ref={end} className="log-end" aria-hidden="true" />
    </ol>
  );
}
