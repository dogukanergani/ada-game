import { createContext, useContext, type ReactNode } from 'react';
import type { GameView } from '@ada/game-core';
import { PIECE_OUTLINE, contrast, playerColor } from '../board/colors';
import { noticesOn, type Notice, type Surface } from '../game/notices';
import { useT } from '../i18n/context';

/**
 * The notices for the surface the player is looking at (see game/notices.ts for
 * the rule). The game screen renders it in the dock; every closable sheet renders
 * it through `NoticeSlot`, so a sheet never hides a notice.
 */
export function NoticeBar({ view, surface, onOpen }: { view: GameView; surface: Surface; onOpen: (n: Notice) => void }) {
  const t = useT();
  const list = noticesOn(view, surface);
  return (
    <div role="status" aria-live="polite" className="notice-bar">
      {list.map((n) => {
        const from = view.players.find((p) => p.id === n.from);
        if (!from) return null;
        const fill = playerColor(from.seat);
        return (
          <button key={n.key} type="button" className="offer-banner" data-offer={n.offerId} onClick={() => onOpen(n)}>
            <span className="seat big" style={{ background: fill, color: contrast(fill, PIECE_OUTLINE) > contrast(fill, '#ffffff') ? PIECE_OUTLINE : '#ffffff' }} aria-hidden="true">
              {from.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="offer-banner-text">{t('offer.banner', { player: from.name })}</span>
            <span className="offer-banner-go">{t('offer.view')} ›</span>
          </button>
        );
      })}
    </div>
  );
}

/** what a closable sheet shows above its content: the game screen puts the notice bar in it */
const NoticeSlotContext = createContext<ReactNode>(null);
export const NoticeSlotProvider = NoticeSlotContext.Provider;
export const useNoticeSlot = (): ReactNode => useContext(NoticeSlotContext);
