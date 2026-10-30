import type { Team } from '@ada/game-core';
import { useT } from '../i18n/context';

/** The team's letter in its frame colour; the letter (and the name for a screen reader) means the team, the colour only helps. */
export function TeamBadge({ team }: { team: Team }) {
  const t = useT();
  return (
    <span className="team-badge" data-team={team} role="img" aria-label={t(`team.name.${team}`)}>
      {t(`team.short.${team}`)}
    </span>
  );
}
