import { useEffect, useState } from 'react';
import type { GameView } from '@ada/game-core';
import { AMBER, INK, PANEL, PIECE_OUTLINE, contrast, playerColor } from '../board/colors';
import { emblemFor } from '../board/emblems';
import { useT } from '../i18n/context';
import { hasKey, type MessageKey } from '../i18n';

type SeatPlayer = GameView['players'][number];

/**
 * Where each player sits: the opponents in one row above the board in the order
 * the table goes round clockwise from the viewer (whoever moves after the viewer
 * is at the left), the viewer in a row below it.
 */
export function seatOrder(view: GameView): { me: SeatPlayer; opponents: SeatPlayer[] } {
  const me = view.players.find((p) => p.id === view.me)!;
  const after = view.players.filter((p) => p.seat > me.seat).sort((a, b) => a.seat - b.seat);
  const before = view.players.filter((p) => p.seat < me.seat).sort((a, b) => a.seat - b.seat);
  return { me, opponents: [...after, ...before] };
}

interface SeatsProps {
  view: GameView;
  /** who is connected, from the lobby view (a missing entry counts as connected) */
  connected: Record<string, boolean>;
  /** cards each player just received that are not shown yet (the dice are tumbling); visual only */
  holdBack?: Record<string, number>;
  which: 'opponents' | 'me';
}

/**
 * A row of player seats. The only things a seat shows of a hand are the total
 * number of cards and the number of development cards: which resources a rival
 * holds is not in the view and so cannot be on the screen.
 */
export function Seats({ view, connected, holdBack = {}, which }: SeatsProps) {
  const t = useT();
  const { me, opponents } = seatOrder(view);
  const list = which === 'me' ? [me] : opponents;
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setOpen(null), 3200);
    return () => clearTimeout(id);
  }, [open]);
  if (list.length === 0) return null;
  return (
    <ul className={`seats seats-${which}`} data-count={list.length} aria-label={t('seat.label')}>
      {list.map((p) => (
        <PlayerSeat
          key={p.id}
          view={view}
          player={p}
          online={connected[p.id] !== false}
          held={holdBack[p.id] ?? 0}
          open={open === p.id}
          onToggle={() => setOpen(open === p.id ? null : p.id)}
        />
      ))}
    </ul>
  );
}

interface SeatProps {
  view: GameView;
  player: SeatPlayer;
  online: boolean;
  held: number;
  open: boolean;
  onToggle: () => void;
}

export function PlayerSeat({ view, player: p, online, held, open, onToggle }: SeatProps) {
  const t = useT();
  const isMe = p.id === view.me;
  const turn = view.current === p.id && view.phase !== 'finished';
  const roleName = hasKey(`role.${p.role}.name`) ? t(`role.${p.role}.name` as MessageKey) : t('role.unknown.name');
  const points = p.points + (p.hiddenPoints ?? 0);
  const cards = Math.max(0, p.handCount - held);
  const longest = view.longestRoad.holder === p.id;
  const army = view.largestArmy.holder === p.id;
  const aria = [
    p.name,
    roleName,
    t('seat.points', { n: points }),
    t('seat.cards', { n: cards }),
    p.devCardCount > 0 ? t('seat.dev', { n: p.devCardCount }) : null,
    longest ? t('seat.longestRoad') : null,
    army ? t('seat.largestArmy') : null,
    turn ? t('seat.turn') : null,
    online ? null : t('seat.offline'),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li className="pseat" data-player={p.id} data-me={isMe} data-turn={turn} data-online={online} data-seat={p.seat + 1} aria-current={turn ? 'true' : undefined}>
      <button type="button" className="pseat-btn" aria-label={aria} aria-expanded={open} onClick={onToggle}>
        <Avatar seat={p.seat} role={p.role} turn={turn} online={online} />
        <span className="pseat-body">
          <span className="pseat-id">
            <span className="pseat-name">{p.name}</span>
            {isMe && <span className="tag">{t('seat.you')}</span>}
            <span className="pseat-role">{roleName}</span>
          </span>
          <span className="pseat-nums">
            <span className="pseat-points">
              <Star />
              {points}
              {isMe && p.hiddenPoints ? <small className="pseat-hidden">{t('seat.hidden', { n: p.hiddenPoints })}</small> : null}
            </span>
            <span className="pseat-counts">
              <span className="pseat-count" data-kind="cards">
                <CardGlyph />
                {cards}
              </span>
              <span className="pseat-count" data-kind="dev">
                <CardGlyph dev />
                {p.devCardCount}
              </span>
            </span>
          </span>
          <span className="pseat-flags">
            {longest && (
              <span className="pseat-flag" title={t('seat.longestRoad')}>
                <RoadGlyph />
                <span className="pseat-flag-text">{t('seat.longestRoad')}</span>
              </span>
            )}
            {army && (
              <span className="pseat-flag" title={t('seat.largestArmy')}>
                <ArmyGlyph />
                <span className="pseat-flag-text">{t('seat.largestArmy')}</span>
              </span>
            )}
            {turn && (
              <span className="pseat-turn">
                <span aria-hidden="true">▶</span>
                <span className="pseat-flag-text">{t('seat.turn')}</span>
              </span>
            )}
            {!online && (
              <span className="pseat-offline">
                <span className="presence-dot" aria-hidden="true" />
                <span className="pseat-flag-text">{t('seat.offline')}</span>
              </span>
            )}
          </span>
        </span>
      </button>
      {open && (
        <span className="pseat-tip" role="status">
          {p.name} · {roleName}
        </span>
      )}
    </li>
  );
}

/** The ring in the player's colour, the role's emblem inside, the seat number attached to the ring. Amber outside when it is their move; a dashed ring when offline. */
function Avatar({ seat, role, turn, online }: { seat: number; role: string; turn: boolean; online: boolean }) {
  const fill = playerColor(seat);
  const ink = contrast(fill, PIECE_OUTLINE) > contrast(fill, '#ffffff') ? PIECE_OUTLINE : '#ffffff';
  const emblem = emblemFor(role);
  return (
    <svg className="pseat-avatar" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      {turn && <circle cx="22" cy="22" r="21" fill="none" stroke={AMBER} strokeWidth="2.6" />}
      <circle cx="22" cy="22" r="17" fill={PANEL} stroke={fill} strokeWidth="4" strokeDasharray={online ? undefined : '4 3'} />
      <g transform="translate(10 10)" fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity={online ? 1 : 0.6}>
        {emblem.paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <circle cx="36" cy="36" r="7.6" fill={fill} stroke={PIECE_OUTLINE} strokeWidth="1.6" />
      <text x="36" y="39.6" textAnchor="middle" fontSize="10.5" fontWeight="800" fill={ink} className="svg-num">
        {seat + 1}
      </text>
    </svg>
  );
}

const Star = () => (
  <svg className="pseat-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path d="M8 1.3 L9.9 5.7 L14.6 6.1 L11 9.2 L12.1 13.8 L8 11.4 L3.9 13.8 L5 9.2 L1.4 6.1 L6.1 5.7 Z" fill={AMBER} stroke={PIECE_OUTLINE} strokeWidth="0.8" strokeLinejoin="round" />
  </svg>
);

const CardGlyph = ({ dev = false }: { dev?: boolean }) => (
  <svg className="pseat-ico" viewBox="0 0 12 14" width="10" height="12" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="10" height="12" rx="1.8" fill={dev ? AMBER : 'none'} fillOpacity={dev ? 0.35 : 0} stroke={dev ? AMBER : INK} strokeWidth="1.3" />
    {dev && <path d="M6 4 L7 6.3 L9.3 6.5 L7.5 8 L8 10.2 L6 9 L4 10.2 L4.5 8 L2.7 6.5 L5 6.3 Z" fill={AMBER} />}
  </svg>
);

const RoadGlyph = () => (
  <svg className="pseat-ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
    <path d="M2 13 L6 8 L10 10 L14 3" fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArmyGlyph = () => (
  <svg className="pseat-ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
    <path d="M8 1.5 V11 M5 11 H11 M8 11 V14.5 M5.5 4 L8 1.5 L10.5 4" fill="none" stroke={AMBER} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
