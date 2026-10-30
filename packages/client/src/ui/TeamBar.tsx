import type { GameView, Team } from '@ada/game-core';
import { useT } from '../i18n/context';
import { TeamBadge } from './TeamBadge';

/**
 * The team mode's score strip in the top row: the viewer's team against the other, each total with a bar towards the shared team goal.
 * The viewer's own total includes their own hidden victory point cards and nobody else's (that is what the view carries).
 * Not drawn outside the team mode.
 */
export function TeamBar({ view }: { view: GameView }) {
  const t = useT();
  if (!view.teamMode || !view.teamPoints || view.teamTarget === null) return null;
  const mine: Team = view.players.find((p) => p.id === view.me)?.team ?? 'A';
  const other: Team = mine === 'A' ? 'B' : 'A';
  const goal = view.teamTarget;
  const us = view.teamPoints[mine];
  const them = view.teamPoints[other];
  const side = (team: Team, who: 'us' | 'them', n: number) => (
    <span className="team-side" data-side={who} data-team={team} data-points={n}>
      <TeamBadge team={team} />
      <span className="team-who">{t(`team.${who}`)}</span>
      <strong className="team-points">{n}</strong>
      <span className="team-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.round((n / goal) * 100))}%` }} />
      </span>
    </span>
  );
  return (
    <div className="team-bar" role="group" aria-label={t('team.strip.label')} data-goal={goal}>
      <span className="visually-hidden">{t('team.strip.aria', { us, them, target: goal })}</span>
      {side(mine, 'us', us)}
      {side(other, 'them', them)}
      <span className="team-goal">{t('team.strip.target', { n: goal })}</span>
    </div>
  );
}
