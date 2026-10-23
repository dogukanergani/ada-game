import type { GameView, PieceKind } from '@ada/game-core';
import type { PreviewResult, ServerError } from '@ada/protocol';
import { describeError, handText } from '../i18n/format';
import { useT } from '../i18n/context';
import type { Translate } from '../i18n';

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

type LongestRoad = NonNullable<PreviewResult['longestRoad']>;

/** What the demolition does to the longest road, as a sentence; null when nothing changes hands or length. */
export function longestRoadLine(t: Translate, name: (id: string) => string, lr: LongestRoad): string | null {
  const { before, after } = lr;
  if (before.holder === after.holder) {
    if (!after.holder || before.length === after.length) return null;
    return t('demolish.longestRoad.shorter', { player: name(after.holder), before: before.length, after: after.length });
  }
  if (before.holder && after.holder) return t('demolish.longestRoad.moves', { from: name(before.holder), to: name(after.holder), length: after.length });
  if (before.holder) return t('demolish.longestRoad.lost', { player: name(before.holder) });
  return t('demolish.longestRoad.gained', { player: name(after.holder!), length: after.length });
}

/**
 * What demolishing the tapped piece would do, as the server worked it out (nothing here is computed on the client):
 * one sentence with the effect and the price, the points and the longest road that change, or the core's own reason it
 * cannot be done (each reason is its own sentence, with the player it is about).
 */
export function DemolishPanel({ view, picked, state, anyTargets }: Props) {
  const t = useT();
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const owner = picked ? (picked.kind === 'road' ? view.roads[picked.id] : view.buildings[picked.id]?.owner) : undefined;
  return (
    <div className="demolish" data-state={state.status}>
      {!anyTargets && <p className="field-hint">{t('demolish.noTargets')}</p>}
      {anyTargets && !picked && (
        <ul className="legend">
          <li>
            <span className="swatch valid" aria-hidden="true" /> {t('demolish.legendValid')}
          </li>
          <li>
            <span className="swatch invalid" aria-hidden="true" /> {t('demolish.legendInvalid')}
          </li>
        </ul>
      )}
      {picked && state.status === 'loading' && <p className="field-hint">{t('demolish.checking')}</p>}
      {picked && state.status === 'error' && (
        <p className="field-problem" role="alert">
          {describeError(t, state.error, name)}
        </p>
      )}
      {picked && state.status === 'ok' && !state.preview.restricted && owner && (
        <div role="status" className="stack">
          <p className="demolish-sentence">
            {t('demolish.sentence', { effect: t(`demolish.effect.${picked.kind}`, { player: name(owner) }), cost: handText(t, state.preview.cost) })}
          </p>
          <ul className="points-delta">
            {Object.entries(state.preview.points ?? {})
              .filter(([, v]) => v.before !== v.after)
              .map(([id, v]) => (
                <li key={`p${id}`}>{t('demolish.points', { player: name(id), before: v.before, after: v.after })}</li>
              ))}
            {Object.entries(state.preview.roadLengths ?? {})
              .filter(([, v]) => v.before !== v.after)
              .map(([id, v]) => (
                <li key={`r${id}`}>{t('demolish.roadLength', { player: name(id), before: v.before, after: v.after })}</li>
              ))}
            {state.preview.longestRoad && longestRoadLine(t, name, state.preview.longestRoad) && <li>{longestRoadLine(t, name, state.preview.longestRoad)}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
