import type { GameView } from '@ada/game-core';
import { hasKey, type MessageKey } from '../../i18n';
import { useT } from '../../i18n/context';
import { Sheet } from '../../ui/Sheet';

interface Props {
  view: GameView;
  isHost: boolean;
  onClose: () => void;
  onLobby: () => void;
  onLeave: () => void;
}

/** Winner, the final scores (the hidden cards are open now), and the way back for the host. */
export function GameOverSheet({ view, isHost, onClose, onLobby, onLeave }: Props) {
  const t = useT();
  const rows = view.players
    .map((p) => ({ p, total: p.points + (p.hiddenPoints ?? 0) }))
    .sort((a, b) => b.total - a.total || a.p.seat - b.p.seat);
  const winner = view.players.find((p) => p.id === view.winner);
  const role = (id: string) => (hasKey(`role.${id}.name`) ? t(`role.${id}.name` as MessageKey) : t('role.unknown.name'));
  return (
    <Sheet title={t('over.title')} onClose={onClose}>
      {winner && (
        <p className="winner" role="status">
          {t('over.winner', { player: winner.name })}
        </p>
      )}
      <h3>{t('over.scores')}</h3>
      <ol className="score-list">
        {rows.map(({ p, total }) => (
          <li key={p.id} data-winner={p.id === view.winner} data-player={p.id}>
            <span className="score-name">
              {p.name} <span className="field-hint">({role(p.role)})</span>
            </span>
            <span className="score-points">
              {t('over.points', { n: total })}
              {p.hiddenPoints ? <span className="field-hint"> · {t('over.hidden', { n: p.hiddenPoints })}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="stack">
        {isHost ? (
          <button type="button" className="btn primary wide" data-action="to-lobby" onClick={onLobby}>
            {t('over.toLobby')}
          </button>
        ) : (
          <p className="field-hint" role="status">
            {t('over.waitHost')}
          </p>
        )}
        <button type="button" className="btn quiet wide" onClick={onLeave}>
          {t('over.leave')}
        </button>
      </div>
    </Sheet>
  );
}
