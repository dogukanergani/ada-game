import type { GameEvent, GameView, Team } from '@ada/game-core';
import { nameList } from '../../i18n/format';
import { hasKey, type MessageKey } from '../../i18n';
import { useT } from '../../i18n/context';
import { Sheet } from '../../ui/Sheet';
import { TeamBadge } from '../../ui/TeamBadge';

/**
 * Whether the time limit ended the game. The `gameWon` event says so when this client saw it; after a reconnect (a snapshot has no
 * events) a timed game whose best score is still under the target can only have ended on the clock.
 */
export function endedByTime(view: GameView, log: { event: GameEvent }[]): boolean {
  const won = log.map((l) => l.event).find((e) => e.type === 'gameWon');
  if (won && won.type === 'gameWon') return won.reason === 'time';
  if (!view.timer) return false;
  if (view.teamMode && view.teamPoints && view.teamTarget !== null) return Math.max(view.teamPoints.A, view.teamPoints.B) < view.teamTarget;
  const best = Math.max(...view.players.map((p) => p.points + (p.hiddenPoints ?? 0)));
  return best < view.vpToWin;
}

interface Props {
  view: GameView;
  byTime?: boolean;
  isHost: boolean;
  onClose: () => void;
  onLobby: () => void;
  onLeave: () => void;
}

/** Winner, the final scores (the hidden cards are open now), and the way back for the host. */
export function GameOverSheet({ view, byTime = false, isHost, onClose, onLobby, onLeave }: Props) {
  const t = useT();
  const rows = view.players
    .map((p) => ({ p, total: p.points + (p.hiddenPoints ?? 0) }))
    .sort((a, b) => b.total - a.total || a.p.seat - b.p.seat);
  const winners = view.players.filter((p) => view.winners.includes(p.id));
  /* team mode: one team wins (both members, shown together) or, level on the clock, both teams */
  const winTeams = [...new Set(winners.map((p) => p.team))].filter((x): x is Team => x !== null);
  const teamResult = view.teamMode && winners.length > 0;
  const role = (id: string) => (hasKey(`role.${id}.name`) ? t(`role.${id}.name` as MessageKey) : t('role.unknown.name'));
  return (
    <Sheet title={t('over.title')} onClose={onClose}>
      {teamResult && (
        <p className="winner" role="status" data-over="team-winner">
          {winTeams.length === 1 ? (
            <>
              <TeamBadge team={winTeams[0]} />{' '}
              {t('over.teamWinner', { team: t(`team.name.${winTeams[0]}`), players: nameList(t, winners.map((p) => p.name)) })}
            </>
          ) : (
            t('over.teamTie', { players: nameList(t, winners.map((p) => p.name)) })
          )}
        </p>
      )}
      {!teamResult && winners.length > 0 && (
        <p className="winner" role="status">
          {winners.length === 1
            ? t('over.winner', { player: winners[0].name })
            : t('over.tie', { players: nameList(t, winners.map((p) => p.name)) })}
        </p>
      )}
      {byTime && winners.length > 0 && (
        <p className="field-hint" data-over="time-up">
          {t('over.timeUp')}
        </p>
      )}
      {view.teamMode && view.teamPoints && view.teamTarget !== null && (
        <>
          <h3>{t('over.teamScores')}</h3>
          <ul className="score-list team-scores">
            {(['A', 'B'] as const).map((team) => (
              <li key={team} data-team={team} data-winner={winTeams.includes(team)}>
                <span className="score-name">
                  <TeamBadge team={team} /> {t(`team.name.${team}`)}
                </span>
                <span className="score-points">{t('over.teamTotal', { team: t(`team.name.${team}`), n: view.teamPoints![team], target: view.teamTarget! })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>{t('over.scores')}</h3>
      <ol className="score-list">
        {rows.map(({ p, total }) => (
          <li key={p.id} data-winner={view.winners.includes(p.id)} data-player={p.id}>
            <span className="score-name">
              {p.team && <TeamBadge team={p.team} />} {p.name} <span className="field-hint">({role(p.role)})</span>
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
