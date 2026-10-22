import type { GameView } from '@ada/game-core';
import { useT } from '../i18n/context';
import type { LogEntry } from '../net/store';
import { formatEvent } from '../i18n/format';

interface LastProps {
  view: GameView;
  log: LogEntry[];
  /** who is connected, from the lobby view (a missing entry counts as connected) */
  connected: Record<string, boolean>;
  /** the dice are tumbling: say so instead of reporting the roll */
  rolling?: boolean;
}

/** The last thing that happened and a clear note when the player whose turn it is has dropped. */
export function LastEvent({ view, log, connected, rolling = false }: LastProps) {
  const t = useT();
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const last = [...log].reverse().find((l) => l.event.type !== 'turnEnded');
  const waitingFor = view.phase !== 'finished' && view.current !== view.me && connected[view.current] === false ? view.current : null;
  return (
    <div className="last-event">
      {waitingFor && (
        <p className="waiting-banner" role="status">
          <span className="presence-dot" aria-hidden="true" /> {t('last.waitingFor', { player: name(waitingFor) })}
        </p>
      )}
      <div className="last-row">
        <p className="last-text" aria-live="polite" aria-label={t('last.event')}>
          {rolling ? t('dice.rolling') : last ? <LastText view={view} entry={last} /> : ' '}
        </p>
      </div>
    </div>
  );
}

function LastText({ view, entry }: { view: GameView; entry: LogEntry }) {
  const t = useT();
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  return <>{formatEvent(entry.event, { t, name, me: view.me })}</>;
}
