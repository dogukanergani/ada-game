import { useState } from 'react';
import { PIECE_LIMITS, type GameView } from '@ada/game-core';
import type { BuildKind, GameControls } from '../../game/controls';
import { useT } from '../../i18n/context';
import type { MessageKey } from '../../i18n';
import { CostItems } from '../../ui/CostTable';
import { shortReason } from '../../ui/reasons';
import { Sheet } from '../../ui/Sheet';

export const BUILD_KINDS: BuildKind[] = ['road', 'settlement', 'city'];

interface Props {
  view: GameView;
  controls: GameControls;
  onPick: (piece: BuildKind) => void;
  onClose: () => void;
}

/**
 * The one way into building: a row for each piece with its cost and a "?" with the rule in a line.
 * Only the entry point lives here. Whether a row is on comes from the same controls as before (the
 * server's legal moves), and a tap on a row starts the usual build mode on the board.
 */
export function BuildSheet({ view, controls, onPick, onClose }: Props) {
  const t = useT();
  const [info, setInfo] = useState<BuildKind | null>(null);
  return (
    <Sheet title={t('build.title')} onClose={onClose}>
      <ul className="build-list">
        {BUILD_KINDS.map((piece) => {
          const control = controls.build[piece];
          const sub = control.enabled ? null : shortReason(t, control.reason);
          const open = info === piece;
          return (
            <li key={piece} className="build-row" data-piece={piece}>
              <div className="build-line">
                <button
                  type="button"
                  className="build-pick"
                  data-build={piece}
                  aria-disabled={!control.enabled}
                  onClick={() => control.enabled && onPick(piece)}
                >
                  <span className="build-name">{t(`game.action.${piece}` as MessageKey)}</span>
                  <span className="build-cost">
                    <CostItems hand={view.mine!.costs[piece]} />
                  </span>
                </button>
                <button
                  type="button"
                  className="info-dot"
                  data-info={piece}
                  aria-expanded={open}
                  aria-label={t('build.info.open', { piece: t(`piece.${piece}`) })}
                  onClick={() => setInfo(open ? null : piece)}
                >
                  <span className="info-mark" aria-hidden="true">?</span>
                </button>
              </div>
              {sub && (
                <p className="build-reason" data-reason={piece}>
                  {sub}
                </p>
              )}
              {open && (
                <p className="build-rule field-hint" role="status" data-rule={piece}>
                  {t(`build.rule.${piece}` as MessageKey, { n: PIECE_LIMITS[piece] })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
