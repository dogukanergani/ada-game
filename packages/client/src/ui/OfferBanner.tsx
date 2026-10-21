import type { GameView } from '@ada/game-core';
import { PIECE_OUTLINE, contrast, playerColor } from '../board/colors';
import { useT } from '../i18n/context';

/**
 * A small notice on the game screen when another player has an open offer, so
 * it is noticed without opening the trade sheet. Offers are public, so the name
 * is shown to everyone.
 */
export function OfferBanner({ view, onOpen }: { view: GameView; onOpen: () => void }) {
  const t = useT();
  const offer = view.offers.find((o) => o.from !== view.me);
  const from = offer && view.players.find((p) => p.id === offer.from);
  return (
    <div role="status" aria-live="polite">
      {offer && from && (
        <button type="button" className="offer-banner" data-offer={offer.id} onClick={onOpen}>
          <span className="seat big" style={{ background: playerColor(from.seat), color: contrast(playerColor(from.seat), PIECE_OUTLINE) > contrast(playerColor(from.seat), '#ffffff') ? PIECE_OUTLINE : '#ffffff' }} aria-hidden="true">
            {from.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="offer-banner-text">{t('offer.banner', { player: from.name })}</span>
          <span className="offer-banner-go">{t('offer.view')} ›</span>
        </button>
      )}
    </div>
  );
}
