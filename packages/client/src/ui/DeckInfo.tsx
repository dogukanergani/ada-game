import { useState } from 'react';
import { DEV_CARD_KINDS, DEV_DECK_COMPOSITION, DEV_DECK_SIZE } from '@ada/game-core';
import { useT } from '../i18n/context';
import { Sheet } from './Sheet';

/**
 * A small "?" beside the buy-a-card button: what the development deck holds and how many cards are left.
 * Both are public (the mix is the rule, the remaining count is in everyone's view); which card is next is not, and is not shown.
 */
export function DeckInfoSheet({ left, onClose }: { left: number; onClose: () => void }) {
  const t = useT();
  const list = DEV_CARD_KINDS.map((k) => `${DEV_DECK_COMPOSITION[k]} ${t(`devCard.${k}`)}`).join(', ');
  return (
    <Sheet title={t('deck.info.title')} onClose={onClose}>
      <p data-deck="contents">{t('deck.info.contents', { total: DEV_DECK_SIZE, list })}</p>
      <p data-deck="left" className="field-hint">
        {t('dev.deck', { n: left })}
      </p>
    </Sheet>
  );
}

export function DeckInfoButton({ left }: { left: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="info-dot" data-action="deck-info" aria-haspopup="dialog" aria-label={t('deck.info.open')} onClick={() => setOpen(true)}>
        <span aria-hidden="true">?</span>
      </button>
      {open && <DeckInfoSheet left={left} onClose={() => setOpen(false)} />}
    </>
  );
}
