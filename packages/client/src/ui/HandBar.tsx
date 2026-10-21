import { RESOURCES, type GameView, type Hand } from '@ada/game-core';
import { useT } from '../i18n/context';
import { ResourceIcon } from './ResourceIcon';

interface Props {
  view: GameView;
  onOpenCards: () => void;
  /** cards just received that are not shown yet (the dice are tumbling); visual only */
  holdBack?: Hand | null;
  /** cards this player just received from the dice, shown as "+n" for a moment (only their own, never a rival's) */
  gain?: Hand | null;
}

/** The player's own cards as counts, and the way into their development cards. Rivals' hands are never shown here, only counts in the strip. */
export function HandBar({ view, onOpenCards, holdBack = null, gain = null }: Props) {
  const t = useT();
  const me = view.players.find((p) => p.id === view.me)!;
  const hand = me.hand!;
  const shown = (r: (typeof RESOURCES)[number]) => Math.max(0, hand[r] - (holdBack?.[r] ?? 0));
  return (
    <div className="hand" role="group" aria-label={t('hand.title')}>
      <ul className="hand-list">
        {RESOURCES.map((r) => (
          <li key={r} className="hand-chip" data-empty={shown(r) === 0} data-resource={r}>
            <ResourceIcon resource={r} size={24} />
            <span className="hand-n">{shown(r)}</span>
            <span className="hand-name">{t(`resource.${r}`)}</span>
            {gain && gain[r] > 0 && (
              <span className="hand-gain" aria-hidden="true" data-gain={gain[r]}>
                +{gain[r]}
              </span>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="btn hand-dev" onClick={onOpenCards} aria-label={t('hand.dev', { n: me.devCardCount })}>
        <svg className="card-icon" width="18" height="24" viewBox="0 0 18 24" aria-hidden="true" focusable="false"><rect x="1" y="1" width="16" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9 6 l2 4 4 .6 -3 3 .8 4.4 -3.8 -2 -3.8 2 .8 -4.4 -3 -3 4 -.6 Z" fill="currentColor" /></svg>
        <span className="hand-n">{me.devCardCount}</span>
        <span className="hand-name">{t('game.action.cards')}</span>
      </button>
    </div>
  );
}
