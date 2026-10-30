import { useState } from 'react';
import { RESOURCES, type GameView, type Hand, type LegalMoves, type Resource } from '@ada/game-core';
import { countHand } from '../../game/controls';
import { emptyHand } from '../../game/tradeView';
import { useT } from '../../i18n/context';
import { handText } from '../../i18n/format';
import { ResourceRow } from '../../ui/ResourceRow';
import { Sheet } from '../../ui/Sheet';
import { TeamBadge } from '../../ui/TeamBadge';

interface Props {
  view: GameView;
  legal: LegalMoves;
  onClose: () => void;
  send: (action: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Sending cards to the teammate (team mode). A sheet of its own and not a tab of the trade sheet: a trade can only be offered on
 * your turn, a gift can be sent at any moment and arrives at once. What may be sent, and to whom, is what the server's legal moves
 * say (`teamGiftTargets`); this only lays out the cards you hold and the count you pick.
 */
export function GiftSheet({ view, legal, onClose, send }: Props) {
  const t = useT();
  const me = view.players.find((p) => p.id === view.me)!;
  const mate = view.players.find((p) => p.team !== null && p.team === me.team && p.id !== me.id);
  const to = legal.teamGiftTargets[0] ?? null;
  const have: Hand = me.hand ?? emptyHand();
  const [pick, setPick] = useState<Hand>(emptyHand);
  const [done, setDone] = useState(false);
  const total = countHand(pick);
  const ready = to !== null && total > 0;
  const name = (r: Resource) => t(`resource.${r}`);
  const bump = (r: Resource, by: number) => {
    setDone(false);
    setPick({ ...pick, [r]: Math.max(0, Math.min(have[r], pick[r] + by)) });
  };

  const footer = (
    <>
      <p className="trade-summary" role="status" aria-live="polite" data-ready={ready}>
        {done && total === 0
          ? t('gift.done')
          : to === null
            ? t(countHand(have) === 0 ? 'gift.noCards' : 'gift.discardFirst')
            : total > 0
              ? t('gift.sum', { player: mate?.name ?? '?', cards: handText(t, pick) })
              : t('gift.none')}
      </p>
      <button
        type="button"
        className="btn primary wide big"
        data-action="send-gift"
        aria-disabled={!ready}
        onClick={async () => {
          if (!ready || to === null) return;
          const cards = Object.fromEntries(RESOURCES.filter((r) => pick[r] > 0).map((r) => [r, pick[r]]));
          if (await send({ type: 'teamGift', to, cards })) {
            setPick(emptyHand());
            setDone(true);
          }
        }}
      >
        {t('gift.send')}
      </button>
    </>
  );

  return (
    <Sheet title={t('gift.title')} onClose={onClose} footer={footer}>
      <div className="stack" data-sheet="gift">
        {mate && (
          <p className="gift-to">
            {me.team && <TeamBadge team={me.team} />}
            <strong>{t('gift.to', { player: mate.name })}</strong>
          </p>
        )}
        <div className="rrows">
          {RESOURCES.map((r) => (
            <ResourceRow
              key={r}
              resource={r}
              block="gift"
              pressed={pick[r] > 0}
              disabled={to === null || pick[r] >= have[r]}
              count={pick[r]}
              sub={t('gift.have', { n: have[r] })}
              label={`${name(r)}, ${t('gift.inc', { name: name(r) })}`}
              removeLabel={t('gift.dec', { name: name(r) })}
              onPress={() => bump(r, 1)}
              onRemove={() => bump(r, -1)}
            />
          ))}
        </div>
        <p className="field-hint">{t('gift.hint')}</p>
      </div>
    </Sheet>
  );
}
