import { RESOURCES, RESOURCE_LABEL, ROLES, canAfford, type GameView, type Hand, type PlayerView, type Resource, type TradeOffer } from '@ada/game-core';
import { TILE_COLOR } from '../theme';

export const handText = (h: Partial<Hand>) =>
  RESOURCES.filter((r) => (h[r] ?? 0) > 0)
    .map((r) => `${h[r]} ${RESOURCE_LABEL[r]}`)
    .join(', ');

export function PlayerStrip({ game }: { game: GameView }) {
  return (
    <ul className="players" aria-label="Oyuncular">
      {game.players.map((p) => (
        <PlayerChip key={p.id} p={p} game={game} />
      ))}
    </ul>
  );
}

function PlayerChip({ p, game }: { p: PlayerView; game: GameView }) {
  const active = game.current === p.id;
  const holdsRoad = game.longestRoad.holder === p.id;
  return (
    <li className={`player${active ? ' active' : ''}${p.id === game.me ? ' me' : ''}`} aria-current={active ? 'true' : undefined}>
      <span className="swatch" style={{ background: p.color }} aria-hidden />
      <span className="p-main">
        <span className="p-name">{p.name}</span>
        <span className="p-sub">{ROLES[p.role].name}</span>
      </span>
      <span className="p-stats" title={holdsRoad ? 'En uzun yol sende' : undefined}>
        <strong>{p.vp}</strong>
        <span className="p-sub">{p.cardCount} kart{holdsRoad ? ', uzun yol' : ''}</span>
      </span>
    </li>
  );
}

export function ResChip({ res, count, dim }: { res: Resource; count: number; dim?: boolean }) {
  return (
    <div className={`res${dim || count === 0 ? ' empty' : ''}`}>
      <span className="res-count" style={{ background: TILE_COLOR[res] }}>{count}</span>
      <span className="res-name">{RESOURCE_LABEL[res]}</span>
    </div>
  );
}

export function HandView({ hand }: { hand: Hand }) {
  return (
    <div className="hand" aria-label="Elindeki kaynaklar">
      {RESOURCES.map((r) => (
        <ResChip key={r} res={r} count={hand[r]} />
      ))}
    </div>
  );
}

export function CostDots({ cost }: { cost: Hand }) {
  return (
    <span className="cost" aria-label={handText(cost)}>
      {RESOURCES.filter((r) => cost[r] > 0).map((r) => (
        <span key={r} className="cost-item">
          <i style={{ background: TILE_COLOR[r] }} />
          {cost[r]}
        </span>
      ))}
    </span>
  );
}

export function Dice({ dice }: { dice: [number, number] | null }) {
  if (!dice) return null;
  return (
    <span className="dice" aria-label={`Zar: ${dice[0]} ve ${dice[1]}, toplam ${dice[0] + dice[1]}`}>
      <b>{dice[0]}</b>
      <b>{dice[1]}</b>
      <span className="dice-total">{dice[0] + dice[1]}</span>
    </span>
  );
}

export function Offers({
  game,
  hand,
  onAccept,
}: {
  game: GameView;
  hand: Hand;
  onAccept: (offer: TradeOffer) => void;
}) {
  const others = game.offers.filter((o) => o.from !== game.me);
  if (game.phase !== 'main' || !others.length) return null;
  const name = (id: string) => game.players.find((p) => p.id === id)!.name;
  return (
    <div className="offers">
      {others.map((o) => (
        <div key={o.id} className="offer">
          <p>
            <strong>{name(o.from)}</strong> {handText(o.give)} veriyor, karşılığında {handText(o.want)} istiyor.
          </p>
          <button className="btn small" disabled={!canAfford(hand, o.want)} onClick={() => onAccept(o)}>
            Kabul et
          </button>
        </div>
      ))}
    </div>
  );
}

export function LogList({ log }: { log: string[] }) {
  return (
    <ol className="log">
      {[...log].reverse().map((l, i) => (
        <li key={log.length - i}>{l}</li>
      ))}
    </ol>
  );
}
