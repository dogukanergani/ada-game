import type { GameView } from '@ada/game-core';
import { heldTotal } from '../game/roll';
import { playerColor, PIECE_OUTLINE, contrast } from '../board/colors';
import { useT } from '../i18n/context';
import { hasKey, type MessageKey } from '../i18n';
import type { LogEntry } from '../net/store';
import { formatEvent } from '../i18n/format';

interface StripProps {
  view: GameView;
  /** who is connected, from the lobby view (a missing entry counts as connected) */
  connected: Record<string, boolean>;
  /** cards each player just received that are not shown yet (the dice are tumbling); visual only */
  holdBack?: Record<string, number>;
}

/** One chip per player: seat, name, role, points, card counts, who is to move, and whether they are online. */
export function PlayerStrip({ view, connected, holdBack = {} }: StripProps) {
  const t = useT();
  const roleName = (id: string) => (hasKey(`role.${id}.name`) ? t(`role.${id}.name` as MessageKey) : t('role.unknown.name'));
  return (
    <ul className="strip" aria-label={t('strip.label')}>
      {view.players.map((p) => {
        const online = connected[p.id] !== false;
        const turn = view.current === p.id && view.phase !== 'finished';
        const fill = playerColor(p.seat);
        const ink = contrast(fill, PIECE_OUTLINE) > contrast(fill, '#ffffff') ? PIECE_OUTLINE : '#ffffff';
        const points = p.points + (p.hiddenPoints ?? 0);
        return (
          <li key={p.id} className="chip" data-turn={turn} data-online={online} data-player={p.id} aria-current={turn ? 'true' : undefined}>
            <span className="chip-head">
              <span className="seat" style={{ background: fill, color: ink }} aria-hidden="true">
                {p.seat + 1}
              </span>
              <span className="chip-name">{p.name}</span>
              {p.id === view.me && <span className="tag">{t('strip.you')}</span>}
            </span>
            <span className="chip-role">{roleName(p.role)}</span>
            <span className="chip-points">
              {t('strip.points', { n: points })}
              {p.id === view.me && p.hiddenPoints ? <span className="chip-hidden"> ({t('strip.hidden', { n: p.hiddenPoints })})</span> : null}
            </span>
            <span className="chip-counts">
              {t('strip.cards', { n: Math.max(0, p.handCount - (holdBack[p.id] ?? 0)) })} · {t('strip.dev', { n: p.devCardCount })}
            </span>
            <span className="chip-badges">
              {view.longestRoad.holder === p.id && <span className="badge">{t('strip.longestRoad')}</span>}
              {view.largestArmy.holder === p.id && <span className="badge">{t('strip.largestArmy')}</span>}
              {turn && <span className="badge turn">▶ {t('strip.turn')}</span>}
              {!online && (
                <span className="badge offline">
                  <span className="presence-dot" aria-hidden="true" />
                  {t('strip.offline')}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface LastProps {
  view: GameView;
  log: LogEntry[];
  connected: Record<string, boolean>;
  /** the dice are tumbling: say so instead of reporting the roll */
  rolling?: boolean;
}

/** The last thing that happened and a clear note when the player whose turn it is has dropped. */
export function LastEvent({ view, log, connected, rolling = false }: LastProps) {
  const t = useT();
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const last = [...log].reverse().find((l) => l.event.type !== 'turnEnded');
  const waitingFor = view.phase !== 'finished' && view.current !== view.me && connected[view.current] === false ? view.current : null;
  return (
    <div className="last-event">
      {waitingFor && (
        <p className="waiting-banner" role="status">
          <span className="presence-dot" aria-hidden="true" /> {t('strip.waitingFor', { player: name(waitingFor) })}
        </p>
      )}
      <div className="last-row">
        <p className="last-text" aria-live="polite" aria-label={t('strip.lastEvent')}>
          {rolling ? t('dice.rolling') : last ? <LastText view={view} entry={last} /> : ' '}
        </p>
              </div>
    </div>
  );
}

function LastText({ view, entry }: { view: GameView; entry: LogEntry }) {
  const t = useT();
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  return <>{formatEvent(entry.event, { t, name, me: view.me })}</>;
}
