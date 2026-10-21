import type { GameView } from '@ada/game-core';

/**
 * Notices: things the player must not miss while looking at something else (an
 * open offer now; later "your pieces were demolished", "your turn").
 *
 * The visibility rule, for every kind of notice:
 *  1. A notice is derived from the current view, never from an event or from
 *     what the screen was doing when it arrived. A reload, a late join or a
 *     closed sheet therefore shows exactly the same notices.
 *  2. It is shown on every surface that can cover the game screen (the game
 *     screen itself and every sheet that can be closed).
 *  3. The one exception: a surface that already shows the notice's content
 *     (the trade sheet on the "players" tab shows the offer itself).
 * Rule 2 is what a plain "banner on the game screen" gets wrong: a sheet covers it.
 */
export type NoticeKind = 'offer';

export interface Notice {
  /** stable while the notice is the same one (a new offer is a new notice) */
  key: string;
  kind: NoticeKind;
  /** the player the notice is about */
  from: string;
  offerId: number;
}

/** where the player is looking: no sheet, or a sheet (and for the trade sheet, its tab) */
export interface Surface {
  sheet: 'trade' | 'cards' | 'costs' | 'log' | null;
  tradeTab: 'bank' | 'players';
}

export function noticesFor(view: GameView): Notice[] {
  return view.offers
    .filter((o) => o.from !== view.me)
    .map((o) => ({ key: `offer:${o.id}`, kind: 'offer' as const, from: o.from, offerId: o.id }));
}

/** rule 3: does this surface already show the notice's own content? */
export function surfaceShows(n: Notice, s: Surface): boolean {
  return n.kind === 'offer' && s.sheet === 'trade' && s.tradeTab === 'players';
}

/** the notices to show on this surface */
export function noticesOn(view: GameView, s: Surface): Notice[] {
  return noticesFor(view).filter((n) => !surfaceShows(n, s));
}

/** the browser tab title: a count in front while something waits for the player */
export function titleFor(view: GameView | null, base = 'Ada'): string {
  const n = view ? noticesFor(view).length : 0;
  return n > 0 ? `(${n}) ${base}` : base;
}
