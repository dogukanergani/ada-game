import { useId, useState, type ReactNode } from 'react';
import { RESOURCES, type GameView, type Hand, type LegalMoves, type Resource, type TradeOffer } from '@ada/game-core';
import { PIECE_OUTLINE, contrast, playerColor } from '../../board/colors';
import { countHand } from '../../game/controls';
import {
  bankGetTiles, bankGiveTiles, bankPairLegal, bankSummary, canSendOffer, emptyHand, incomingOffers, offerGiveTiles, offerSummary,
  offerWantTiles, ownOffer, type IncomingOffer,
} from '../../game/tradeView';
import { useT } from '../../i18n/context';
import { handText, sideOf } from '../../i18n/format';
import { ResourceChips, ResourceRow, tileReasonText } from '../../ui/ResourceRow';
import { Sheet } from '../../ui/Sheet';

interface Props {
  view: GameView;
  legal: LegalMoves;
  onClose: () => void;
  send: (action: Record<string, unknown>) => Promise<boolean>;
  /** the tab belongs to the screen: a notice can send the player to the offers */
  tab: 'bank' | 'players';
  onTab: (t: 'bank' | 'players') => void;
}

/**
 * Trading with the bank and with the other players. Ratios, what is allowed and
 * what can be accepted all come from the core and the server's legal moves; this
 * screen only lays them out: what you give on the left, what you get (or ask for)
 * on the right, one compact row per resource, the action pinned at the bottom.
 */
export function TradeSheet({ view, legal, onClose, send, tab, onTab: setTab }: Props) {
  const t = useT();
  const myTurn = view.current === view.me && view.phase === 'main';
  return <TradeBody view={view} legal={legal} myTurn={myTurn} tab={tab} setTab={setTab} send={send} onClose={onClose} title={t('trade.title')} />;
}

interface BodyProps {
  view: GameView;
  legal: LegalMoves;
  myTurn: boolean;
  tab: 'bank' | 'players';
  setTab: (t: 'bank' | 'players') => void;
  send: Props['send'];
  onClose: () => void;
  title: string;
}

/** Two columns with a thin arrow between them: left what goes out, right what comes in. */
function Columns({ leftTitle, rightTitle, left, right }: { leftTitle: string; rightTitle: string; left: ReactNode; right: ReactNode }) {
  const id = useId();
  return (
    <div className="trade-cols">
      <section aria-labelledby={`${id}-l`}>
        <h3 id={`${id}-l`} className="col-title">
          {leftTitle}
        </h3>
        <div className="rrows">{left}</div>
      </section>
      <span className="trade-arrow" aria-hidden="true">
        →
      </span>
      <section aria-labelledby={`${id}-r`}>
        <h3 id={`${id}-r`} className="col-title">
          {rightTitle}
        </h3>
        <div className="rrows">{right}</div>
      </section>
    </div>
  );
}

function TradeBody({ view, legal, myTurn, tab, setTab, send, onClose, title }: BodyProps) {
  const t = useT();

  /* ---- bank ---- */
  const [give, setGive] = useState<Resource | null>(null);
  const [get, setGet] = useState<Resource | null>(null);
  const [done, setDone] = useState(false);
  const giveTiles = bankGiveTiles(view, legal, myTurn);
  const getTiles = bankGetTiles(view, legal, give);
  const pairLegal = bankPairLegal(legal, give, get);
  const bank = bankSummary(view, give, get);

  /* ---- offer ---- */
  const [offerGive, setOfferGive] = useState<Hand>(emptyHand);
  const [offerWant, setOfferWant] = useState<Hand>(emptyHand);
  const canOffer = canSendOffer(myTurn, offerGive, offerWant);
  const mine = ownOffer(view);
  const incoming = incomingOffers(view, legal);
  const offer = offerSummary(offerGive, offerWant);
  const bump = (set: (h: Hand) => void, h: Hand, r: Resource, by: number, max: number) => set({ ...h, [r]: Math.max(0, Math.min(max, h[r] + by)) });
  const strip = (h: Hand) => Object.fromEntries(RESOURCES.filter((r) => h[r] > 0).map((r) => [r, h[r]]));

  const name = (r: Resource) => t(`resource.${r}`);

  const bankLine = (() => {
    if (!myTurn) return t('reason.notYourTurn');
    if (bank.kind === 'full') return t('trade.sum.bank', { n: bank.n, give: name(bank.give), get: name(bank.get) });
    if (bank.kind === 'give') return t('trade.sum.bankGive', { n: bank.n, give: name(bank.give) });
    return t('trade.sum.bankNone');
  })();

  const offerLine = (() => {
    if (!myTurn) return t('trade.onlyOnYourTurn');
    if (offer.kind === 'full') return t('trade.sum.offer', { give: handText(t, offer.give), want: handText(t, offer.want) });
    if (offer.kind === 'give') return t('trade.sum.offerGive', { give: handText(t, offer.give) });
    if (offer.kind === 'want') return t('trade.sum.offerWant', { want: handText(t, offer.want) });
    return t('trade.sum.offerNone');
  })();

  const footer =
    tab === 'bank' ? (
      <>
        <p className="trade-summary" role="status" aria-live="polite" data-ready={pairLegal}>
          {done && bank.kind === 'none' ? t('trade.done') : bankLine}
        </p>
        <button
          type="button"
          className="btn primary wide big"
          data-action="bank-trade"
          aria-disabled={!pairLegal}
          onClick={async () => {
            if (!pairLegal || !give || !get) return;
            if (await send({ type: 'bankTrade', give, get })) {
              setDone(true);
              setGive(null);
              setGet(null);
            }
          }}
        >
          {t('trade.doBank')}
        </button>
      </>
    ) : myTurn ? (
      <>
        <p className="trade-summary" role="status" aria-live="polite" data-ready={canOffer}>
          {offerLine}
        </p>
        <p className="trade-note">{mine ? t('trade.replacesMine') : t('trade.replaces')}</p>
        <button
          type="button"
          className="btn primary wide big"
          data-action="send-offer"
          aria-disabled={!canOffer}
          onClick={async () => {
            if (!canOffer) return;
            if (await send({ type: 'offerTrade', give: strip(offerGive), want: strip(offerWant) })) {
              setOfferGive(emptyHand());
              setOfferWant(emptyHand());
            }
          }}
        >
          {t('trade.offerSend')}
        </button>
      </>
    ) : incoming.length > 0 ? (
      <>
        {!incoming[0].acceptable && countHand(incoming[0].missing) > 0 && (
          <p className="trade-note off" role="status">
            {t('trade.cannotAccept', { missing: handText(t, incoming[0].missing) })}
          </p>
        )}
        <button
          type="button"
          className="btn primary wide big"
          data-action="accept"
          aria-disabled={!incoming[0].acceptable}
          onClick={() => incoming[0].acceptable && void send({ type: 'acceptTrade', offerId: incoming[0].offer.id })}
        >
          {t('trade.accept')}
        </button>
      </>
    ) : null;

  const tabs = (
    <div className="tabs" role="tablist" aria-label={title}>
      {(['bank', 'players'] as const).map((k) => (
        <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} className="tab" data-tab={k} onClick={() => setTab(k)}>
          {t(k === 'bank' ? 'trade.bank' : 'trade.players')}
          {k === 'players' && incoming.length > 0 && <span className="tab-dot" aria-label={t('trade.waiting')} />}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet title={title} onClose={onClose} footer={footer} sub={tabs} wide>
      {tab === 'bank' && (
        <div id="panel-bank" role="tabpanel" aria-labelledby="tab-bank" className="stack">
          <Columns
            leftTitle={t('trade.youGive')}
            rightTitle={t('trade.youGet')}
            left={giveTiles.map((g) => (
              <ResourceRow
                key={g.resource}
                resource={g.resource}
                block="give"
                pressed={give === g.resource}
                disabled={!g.enabled}
                badge={t('costs.ratio', { ratio: g.ratio })}
                sub={t('trade.have', { n: g.have })}
                reason={g.reason ? tileReasonText(t, g.reason) : null}
                label={`${name(g.resource)}, ${t('trade.have', { n: g.have })}, ${t('costs.ratio', { ratio: g.ratio })}${g.reason ? ', ' + tileReasonText(t, g.reason) : ''}`}
                onPress={() => {
                  setGive(g.resource);
                  setDone(false);
                  if (get && !legal.bankTrades.some((x) => x.give === g.resource && x.get === get)) setGet(null);
                }}
              />
            ))}
            right={getTiles.map((g) => (
              <ResourceRow
                key={g.resource}
                resource={g.resource}
                block="get"
                pressed={get === g.resource}
                disabled={!g.enabled}
                badge="1"
                sub={t('trade.inBank', { n: g.inBank })}
                reason={g.reason ? tileReasonText(t, g.reason) : null}
                label={`${name(g.resource)}, ${t('trade.inBank', { n: g.inBank })}${g.reason ? ', ' + tileReasonText(t, g.reason) : ''}`}
                onPress={() => {
                  setGet(g.resource);
                  setDone(false);
                }}
              />
            ))}
          />
        </div>
      )}

      {tab === 'players' && (
        <div id="panel-players" role="tabpanel" aria-labelledby="tab-players" className="stack">
          {mine && <OwnOfferCard offer={mine} onCancel={() => void send({ type: 'cancelTrade', offerId: mine.id })} />}
          {incoming.map((i) => (
            <IncomingCard key={i.offer.id} view={view} incoming={i} />
          ))}

          {myTurn ? (
            <>
              <Columns
                leftTitle={t('trade.youGive')}
                rightTitle={t('trade.youAsk')}
                left={offerGiveTiles(view, offerGive, offerWant, myTurn).map((o) => (
                  <ResourceRow
                    key={o.resource}
                    resource={o.resource}
                    block="offer-give"
                    pressed={o.count > 0}
                    disabled={!o.enabled || o.count >= o.max}
                    count={o.count}
                    sub={t('trade.have', { n: o.max })}
                    reason={o.reason ? tileReasonText(t, o.reason) : null}
                    label={`${name(o.resource)}, ${t('trade.inc', { name: name(o.resource) })}`}
                    removeLabel={t('trade.dec', { name: name(o.resource) })}
                    onPress={() => bump(setOfferGive, offerGive, o.resource, 1, o.max)}
                    onRemove={() => bump(setOfferGive, offerGive, o.resource, -1, o.max)}
                  />
                ))}
                right={offerWantTiles(offerWant, offerGive, myTurn).map((o) => (
                  <ResourceRow
                    key={o.resource}
                    resource={o.resource}
                    block="offer-want"
                    pressed={o.count > 0}
                    disabled={!o.enabled || o.count >= o.max}
                    count={o.count}
                    reason={o.reason ? tileReasonText(t, o.reason) : null}
                    label={`${name(o.resource)}, ${t('trade.inc', { name: name(o.resource) })}`}
                    removeLabel={t('trade.dec', { name: name(o.resource) })}
                    onPress={() => bump(setOfferWant, offerWant, o.resource, 1, o.max)}
                    onRemove={() => bump(setOfferWant, offerWant, o.resource, -1, o.max)}
                  />
                ))}
              />
              <p className="field-hint">{t('trade.tapHint')}</p>
            </>
          ) : (
            incoming.length === 0 && !mine && <p className="field-hint">{t('trade.nothingYet')}</p>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** The seat's colour and the first letter of the name, as a disc. */
function PlayerDisc({ view, id }: { view: GameView; id: string }) {
  const p = view.players.find((x) => x.id === id);
  const fill = playerColor(p?.seat ?? 0);
  const ink = contrast(fill, PIECE_OUTLINE) > contrast(fill, '#ffffff') ? PIECE_OUTLINE : '#ffffff';
  return (
    <span className="seat big" style={{ background: fill, color: ink }} aria-hidden="true">
      {(p?.name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/** What is given, an arrow, what is asked for: one compact line (it wraps on a narrow screen). A one-sided offer shows its one side and says it asks nothing back (or gives nothing). */
function Exchange({ give, want }: { give: Hand; want: Hand }) {
  const t = useT();
  const kind = sideOf(give, want);
  if (kind !== 'both') {
    return (
      <div className="exchange" data-kind={kind === 'give' ? 'gift' : 'ask'}>
        <div className="exchange-side">
          <span className="exchange-label">{t(kind === 'give' ? 'trade.giftGives' : 'trade.giftAsks')}</span>
          <ResourceChips hand={kind === 'give' ? give : want} />
        </div>
      </div>
    );
  }
  return (
    <div className="exchange" data-kind="both">
      <div className="exchange-side">
        <span className="exchange-label">{t('trade.gives')}</span>
        <ResourceChips hand={give} />
      </div>
      <span className="exchange-arrow" aria-hidden="true">
        →
      </span>
      <div className="exchange-side">
        <span className="exchange-label">{t('trade.asks')}</span>
        <ResourceChips hand={want} />
      </div>
    </div>
  );
}

function OwnOfferCard({ offer, onCancel }: { offer: TradeOffer; onCancel: () => void }) {
  const t = useT();
  return (
    <section className="offer-card mine" data-offer={offer.id} aria-label={t('trade.mine')}>
      <div className="offer-head">
        <h3 className="block-title">{t('trade.mine')}</h3>
        <button type="button" className="btn" data-action="withdraw" onClick={onCancel}>
          {t('trade.withdraw')}
        </button>
      </div>
      <Exchange give={offer.give} want={offer.want} />
    </section>
  );
}

/** The offer as it reads; accepting it is the pinned button at the bottom of the sheet. */
function IncomingCard({ view, incoming }: { view: GameView; incoming: IncomingOffer }) {
  const t = useT();
  const { offer } = incoming;
  const who = view.players.find((p) => p.id === offer.from)?.name ?? '?';
  return (
    <section className="offer-card" data-offer={offer.id} aria-label={t('trade.incomingFrom', { player: who })}>
      <div className="offer-head">
        <h3 className="block-title offer-from">
          <PlayerDisc view={view} id={offer.from} />
          {t('trade.incomingFrom', { player: who })}
        </h3>
      </div>
      <Exchange give={offer.give} want={offer.want} />
    </section>
  );
}
