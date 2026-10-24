import type { GameView } from '@ada/game-core';
import { nameList } from '../../i18n/format';
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
  const winners = view.players.filter((p) => view.winners.includes(p.id));
  const role = (id: string) => (hasKey(`role.${id}.name`) ? t(`role.${id}.name` as MessageKey) : t('role.unknown.name'));
  return (
    <Sheet title={t('over.title')} onClose={onClose}>
      {winners.length > 0 && (
        <p className="winner" role="status">
          {winners.length === 1
            ? t('over.winner', { player: winners[0].name })
            : t('over.tie', { players: nameList(t, winners.map((p) => p.name)) })}
        </p>
      )}
      <h3>{t('over.scores')}</h3>
      <ol className="score-list">
        {rows.map(({ p, total }) => (
          <li key={p.id} data-winner={view.winners.includes(p.id)} data-player={p.id}>
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
