import { useState, type ReactNode } from 'react';
import { RESOURCES, RESOURCE_LABEL, bankRatioFor, handCount, type GameView, type Hand, type Resource } from '@ada/game-core';
import type { Net } from '../net';
import { TILE_COLOR } from '../theme';
import { LogList, handText } from './Panels';

export function Sheet({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="scrim" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="btn ghost small" onClick={onClose}>
              Kapat
            </button>
          )}
        </header>
        {children}
      </section>
    </div>
  );
}

const emptyHand = (): Hand => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });

function Stepper({ res, value, max, onChange }: { res: Resource; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <span className="res-count" style={{ background: TILE_COLOR[res] }} aria-hidden />
      <span className="stepper-name">{RESOURCE_LABEL[res]}</span>
      <button className="btn small" aria-label={`${RESOURCE_LABEL[res]} azalt`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output>{value}</output>
      <button className="btn small" aria-label={`${RESOURCE_LABEL[res]} artır`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

function ResPicker({ value, onPick, hand, need }: { value: Resource | null; onPick: (r: Resource) => void; hand?: Hand; need?: (r: Resource) => number }) {
  return (
    <div className="picker" role="radiogroup">
      {RESOURCES.map((r) => {
        const short = hand && need ? hand[r] < need(r) : false;
        return (
          <button key={r} role="radio" aria-checked={value === r} className={`pick${value === r ? ' on' : ''}`} disabled={short} onClick={() => onPick(r)}>
            <i style={{ background: TILE_COLOR[r] }} />
            {RESOURCE_LABEL[r]}
            {hand && <small>{hand[r]}</small>}
          </button>
        );
      })}
    </div>
  );
}

export function TradeSheet({ net, game, hand, onClose }: { net: Net; game: GameView; hand: Hand; onClose: () => void }) {
  const [tab, setTab] = useState<'bank' | 'players'>('bank');
  const [give, setGive] = useState<Resource | null>(null);
  const [get, setGet] = useState<Resource | null>(null);
  const [offerGive, setOfferGive] = useState<Hand>(emptyHand());
  const [offerWant, setOfferWant] = useState<Hand>(emptyHand());
  const myOffer = game.offers.find((o) => o.from === game.me);
  const ratio = give ? bankRatioFor(game, game.me, give) : 4;
  const canBank = !!give && !!get && give !== get && hand[give] >= ratio;

  return (
    <Sheet title="Takas" onClose={onClose}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'bank'} onClick={() => setTab('bank')}>Bankayla</button>
        <button role="tab" aria-selected={tab === 'players'} onClick={() => setTab('players')}>Oyunculara</button>
      </div>

      {tab === 'bank' ? (
        <div className="trade-body">
          <p className="muted">Vereceğin kaynak {give ? `(${ratio} kart = 1 kart)` : `(rolüne göre 3 ya da 4 kart = 1 kart)`}</p>
          <ResPicker value={give} onPick={setGive} hand={hand} need={(r) => bankRatioFor(game, game.me, r)} />
          <p className="muted">Almak istediğin kaynak</p>
          <ResPicker value={get} onPick={setGet} />
          <button
            className="btn primary"
            disabled={!canBank}
            onClick={async () => {
              if (give && get && (await net.act({ type: 'bankTrade', give, get }))) {
                setGive(null);
                setGet(null);
              }
            }}
          >
            Takas et
          </button>
        </div>
      ) : (
        <div className="trade-body">
          <p className="muted">Vereceklerin</p>
          {RESOURCES.map((r) => (
            <Stepper key={r} res={r} value={offerGive[r]} max={hand[r]} onChange={(n) => setOfferGive({ ...offerGive, [r]: n })} />
          ))}
          <p className="muted">İstediklerin</p>
          {RESOURCES.map((r) => (
            <Stepper key={r} res={r} value={offerWant[r]} max={9} onChange={(n) => setOfferWant({ ...offerWant, [r]: n })} />
          ))}
          <button
            className="btn primary"
            disabled={handCount(offerGive) === 0 || handCount(offerWant) === 0 || RESOURCES.some((r) => offerGive[r] > 0 && offerWant[r] > 0)}
            onClick={async () => {
              if (await net.act({ type: 'offerTrade', give: offerGive, want: offerWant })) {
                setOfferGive(emptyHand());
                setOfferWant(emptyHand());
              }
            }}
          >
            Teklifi herkese göster
          </button>
          {myOffer && (
            <div className="offer mine">
              <p>
                Açık teklifin: {handText(myOffer.give)} karşılığında {handText(myOffer.want)}.
              </p>
              <button className="btn small" onClick={() => net.act({ type: 'cancelTrade', offerId: myOffer.id })}>
                İptal et
              </button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function DiscardSheet({ net, hand, need }: { net: Net; hand: Hand; need: number }) {
  const [pick, setPick] = useState<Hand>(emptyHand());
  const chosen = handCount(pick);
  return (
    <Sheet title={`${need} kart at`}>
      <p className="muted">Yedi geldi ve elinde çok kart var. Tam {need} kart seç ({chosen}/{need}).</p>
      {RESOURCES.map((r) => (
        <Stepper key={r} res={r} value={pick[r]} max={Math.min(hand[r], pick[r] + (need - chosen))} onChange={(n) => setPick({ ...pick, [r]: n })} />
      ))}
      <button className="btn primary" disabled={chosen !== need} onClick={() => net.act({ type: 'discard', resources: pick })}>
        Kartları at
      </button>
    </Sheet>
  );
}

export function StealSheet({ net, game }: { net: Net; game: GameView }) {
  return (
    <Sheet title="Kimden kart çalacaksın?">
      <div className="victims">
        {game.stealFrom.map((id) => {
          const p = game.players.find((x) => x.id === id)!;
          return (
            <button key={id} className="btn" onClick={() => net.act({ type: 'steal', victim: id })}>
              <i className="swatch" style={{ background: p.color }} /> {p.name} ({p.cardCount} kart)
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

export function WinSheet({ net, game, isHost }: { net: Net; game: GameView; isHost: boolean }) {
  const winner = game.players.find((p) => p.id === game.winner)!;
  return (
    <Sheet title="Oyun bitti">
      <p className="win">
        <i className="swatch" style={{ background: winner.color }} /> {winner.id === game.me ? 'Kazandın!' : `${winner.name} kazandı.`}
      </p>
      <ul className="final">
        {[...game.players]
          .sort((a, b) => b.vp - a.vp)
          .map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <strong>{p.vp} puan</strong>
            </li>
          ))}
      </ul>
      {isHost ? (
        <button className="btn primary" onClick={net.reset}>Lobiye dön</button>
      ) : (
        <p className="muted">Oda sahibi yeni oyun başlatınca lobiye döneceksin.</p>
      )}
      <button className="btn ghost" onClick={net.leave}>Odadan çık</button>
    </Sheet>
  );
}

export function LogSheet({ net, game, onClose }: { net: Net; game: GameView; onClose: () => void }) {
  return (
    <Sheet title="Oyun günlüğü" onClose={onClose}>
      <LogList log={game.log} />
      <button
        className="btn ghost"
        onClick={() => {
          if (window.confirm('Odadan çıkarsan oyun sıran sana gelince diğerleri bekler. Aynı kodla geri dönebilirsin. Çıkmak istiyor musun?')) void net.leave();
        }}
      >
        Odadan çık
      </button>
    </Sheet>
  );
}
