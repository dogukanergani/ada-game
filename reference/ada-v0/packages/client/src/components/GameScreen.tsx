import { useEffect, useMemo, useState } from 'react';
import { ROLES, canAfford, costFor, legalCityVertices, legalRoadEdges, legalSettlementVertices, type GameView } from '@ada/game-core';
import type { Net } from '../net';
import { Board } from './Board';
import { CostDots, Dice, HandView, LogList, Offers, PlayerStrip } from './Panels';
import { DiscardSheet, LogSheet, StealSheet, TradeSheet, WinSheet } from './Sheets';

type Mode = 'road' | 'settlement' | 'city' | null;

function statusLine(game: GameView, myTurn: boolean, owesDiscard: boolean): string {
  const who = game.players.find((p) => p.id === game.current)!.name;
  switch (game.phase) {
    case 'setup':
      if (!myTurn) return `${who} başlangıç yapısını kuruyor.`;
      return game.setup?.step === 'road' ? 'Şimdi yerleşimine bağlı bir yol koy.' : 'Bir yerleşim koy: parlayan noktalara dokun.';
    case 'roll':
      return myTurn ? 'Sıra sende. Zar at.' : `${who} zar atacak.`;
    case 'discard':
      return owesDiscard ? 'Yedi geldi: atman gereken kartları seç.' : 'Yedi geldi: kart atması gerekenler bekleniyor.';
    case 'robber':
      return myTurn ? 'Haydutu taşı: bir bölgeye dokun.' : `${who} haydutu taşıyor.`;
    case 'steal':
      return myTurn ? 'Kimden kart çalacağını seç.' : `${who} kart çalıyor.`;
    case 'main':
      return myTurn ? 'Sıra sende.' : `${who} oynuyor.`;
    default:
      return 'Oyun bitti.';
  }
}

export function GameScreen({ net, game, isHost }: { net: Net; game: GameView; isHost: boolean }) {
  const me = game.players.find((p) => p.id === game.me)!;
  const hand = me.resources!;
  const myTurn = game.current === game.me;
  const [mode, setMode] = useState<Mode>(null);
  const [sheet, setSheet] = useState<'trade' | 'log' | null>(null);

  // A build mode only makes sense within the turn it was chosen in.
  useEffect(() => setMode(null), [game.phase, game.current]);

  const activeMode: Mode =
    game.phase === 'setup' && myTurn ? (game.setup?.step === 'road' ? 'road' : 'settlement') : game.phase === 'main' && myTurn ? mode : null;

  const vertexSpots = useMemo(
    () => (activeMode === 'settlement' ? legalSettlementVertices(game, game.me) : activeMode === 'city' ? legalCityVertices(game, game.me) : []),
    [game, activeMode],
  );
  const edgeSpots = useMemo(() => (activeMode === 'road' ? legalRoadEdges(game, game.me) : []), [game, activeMode]);
  const tileSpots = useMemo(
    () => (game.phase === 'robber' && myTurn ? game.tiles.filter((t) => t.id !== game.robber).map((t) => t.id) : []),
    [game, myTurn],
  );

  const owed = game.pendingDiscards[game.me] ?? 0;

  const build = async (kind: 'road' | 'settlement' | 'city', id: number) => {
    const ok = await net.act(
      kind === 'road' ? { type: 'placeRoad', edge: id } : kind === 'city' ? { type: 'upgradeCity', vertex: id } : { type: 'placeSettlement', vertex: id },
    );
    if (ok) setMode(null);
  };

  const options: { kind: 'road' | 'settlement' | 'city'; label: string; spots: () => number }[] = [
    { kind: 'road', label: 'Yol', spots: () => legalRoadEdges(game, game.me).length },
    { kind: 'settlement', label: 'Yerleşim', spots: () => legalSettlementVertices(game, game.me).length },
    { kind: 'city', label: 'Şehir', spots: () => legalCityVertices(game, game.me).length },
  ];

  return (
    <div className="game">
      <header className="top">
        <PlayerStrip game={game} />
        <div className="ticker">
          <button className="ticker-text" onClick={() => setSheet('log')} aria-label="Oyun günlüğünü aç">
            {game.log[game.log.length - 1]}
          </button>
          <Dice dice={game.dice} />
        </div>
      </header>

      <main className="board-wrap">
        <Board
          game={game}
          vertexSpots={vertexSpots}
          edgeSpots={edgeSpots}
          tileSpots={tileSpots}
          onVertex={(v) => build(activeMode === 'city' ? 'city' : 'settlement', v)}
          onEdge={(e) => build('road', e)}
          onTile={(t) => net.act({ type: 'moveRobber', tile: t })}
        />
      </main>

      <section className="dock" aria-label="Senin elin ve hamlelerin">
        <p className="status" aria-live="polite">{statusLine(game, myTurn, owed > 0)}</p>
        <HandView hand={hand} />
        <p className="role-note"><strong>{ROLES[me.role].name}:</strong> {ROLES[me.role].blurb}</p>

        <Offers game={game} hand={hand} onAccept={(o) => net.act({ type: 'acceptTrade', offerId: o.id })} />

        {myTurn && game.phase === 'roll' && (
          <div className="actions">
            <button className="btn primary wide" onClick={() => net.act({ type: 'roll' })}>Zar at</button>
          </div>
        )}

        {myTurn && game.phase === 'main' && (
          <div className="actions">
            {options.map(({ kind, label, spots }) => {
              const cost = costFor(game, game.me, kind);
              const ok = canAfford(hand, cost) && spots() > 0;
              return (
                <button key={kind} className={`btn build${mode === kind ? ' on' : ''}`} disabled={!ok} aria-pressed={mode === kind} onClick={() => setMode(mode === kind ? null : kind)}>
                  <span>{label}</span>
                  <CostDots cost={cost} />
                </button>
              );
            })}
            <button className="btn" onClick={() => setSheet('trade')}>Takas</button>
            <button className="btn primary" onClick={() => net.act({ type: 'endTurn' })}>Turu bitir</button>
          </div>
        )}

        {mode && myTurn && game.phase === 'main' && (
          <p className="muted hint">{mode === 'city' ? 'Şehre yükseltmek istediğin yerleşime dokun.' : 'Parlayan noktalardan birine dokun.'}</p>
        )}
      </section>

      <aside className="side-log" aria-label="Oyun günlüğü">
        <h2>Günlük</h2>
        <LogList log={game.log} />
      </aside>

      {sheet === 'trade' && game.phase === 'main' && myTurn && <TradeSheet net={net} game={game} hand={hand} onClose={() => setSheet(null)} />}
      {sheet === 'log' && <LogSheet net={net} game={game} onClose={() => setSheet(null)} />}
      {game.phase === 'discard' && owed > 0 && <DiscardSheet net={net} hand={hand} need={owed} />}
      {game.phase === 'steal' && myTurn && <StealSheet net={net} game={game} />}
      {game.phase === 'finished' && <WinSheet net={net} game={game} isHost={isHost} />}
    </div>
  );
}
