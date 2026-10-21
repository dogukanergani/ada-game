import type { GameView, PieceKind } from '@ada/game-core';
import type { PreviewResult, ServerError } from '@ada/protocol';
import { describeError, handText } from '../i18n/format';
import { useT } from '../i18n/context';

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; preview: PreviewResult }
  | { status: 'error'; error: ServerError };

interface Props {
  view: GameView;
  /** the rival piece the player tapped */
  picked: { kind: PieceKind; id: number } | null;
  state: PreviewState;
  anyTargets: boolean;
}

/**
 * What capturing the tapped piece would cost and change, as the server worked
 * it out (nothing here is computed on the client), or why it cannot be done.
 */
export function CapturePanel({ view, picked, state, anyTargets }: Props) {
  const t = useT();
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="capture" data-state={state.status}>
      {!anyTargets && <p className="field-hint">{t('capture.noTargets')}</p>}
      {anyTargets && !picked && (
        <ul className="legend">
          <li>
            <span className="swatch valid" aria-hidden="true" /> {t('capture.legendValid')}
          </li>
          <li>
            <span className="swatch invalid" aria-hidden="true" /> {t('capture.legendInvalid')}
          </li>
        </ul>
      )}
      {picked && state.status === 'loading' && <p className="field-hint">{t('capture.checking')}</p>}
      {picked && state.status === 'error' && (
        <p className="field-problem" role="alert">
          {t('capture.invalid')} {describeError(t, state.error)}
        </p>
      )}
      {picked && state.status === 'ok' && !state.preview.restricted && (
        <div role="status" className="stack">
          <p>{t('capture.cost', { cost: handText(t, state.preview.cost) })}</p>
          <ul className="points-delta">
            {Object.entries(state.preview.points ?? {})
              .filter(([, v]) => v.before !== v.after)
              .map(([id, v]) => (
                <li key={id}>{t('capture.points', { player: name(id), before: v.before, after: v.after })}</li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
