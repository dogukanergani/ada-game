import { useState, type ReactNode } from 'react';
import { audio } from '../audio';
import { blockMoment, blockedNow, type BlockedNote, type Control, type GameControls, type Mode } from '../game/controls';
import { useT } from '../i18n/context';
import { DeckInfoButton } from './DeckInfo';
import { reasonText, shortReason } from './reasons';

export type SheetName = 'build' | 'trade' | 'cards' | 'costs' | 'log';

interface Props {
  controls: GameControls;
  mode: Mode;
  /** the board spot the player tapped and has not confirmed yet, in words */
  selection: string | null;
  busy: boolean;
  onRoll: () => void;
  onEnd: () => void;
  onBuyCard: () => void;
  onMode: (m: Mode) => void;
  onSheet: (s: SheetName) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** extra content for a special mode (the demolish preview) */
  extra?: ReactNode;
  /** a way to reopen the final scores once the game is over */
  onScores?: () => void;
  /** turn, phase and whose move: the explanation of a blocked button belongs to one such moment and goes with it */
  moment?: string;
  /** cards left in the development deck (public), for the deck info beside the buy button */
  deckCount?: number;
}

/** One action: enabled only when the server says it is legal; a disabled one stays tappable and explains itself. */
function ActionButton({
  label,
  control,
  sub,
  onClick,
  primary,
  onBlocked,
  id,
}: {
  label: string;
  control: Control;
  sub?: string | null;
  onClick: () => void;
  primary?: boolean;
  onBlocked: (c: Control) => void;
  id: string;
}) {
  return (
    <button
      type="button"
      data-action={id}
      className={`btn action${primary ? ' primary' : ''}`}
      aria-disabled={!control.enabled}
      onClick={() => (control.enabled ? onClick() : onBlocked(control))}
    >
      <span className="action-label">{label}</span>
      {!control.enabled && sub ? <span className="action-sub">{sub}</span> : null}
    </button>
  );
}

export function ActionDock({ controls, mode, selection, busy, onRoll, onEnd, onBuyCard, onMode, onSheet, onConfirm, onCancel, extra, onScores, moment = '', deckCount = 0 }: Props) {
  const t = useT();
  const [note, setNote] = useState<BlockedNote | null>(null);
  const here = blockMoment(moment, mode);
  /* a tap on a button that was off must not outlive the turn, the phase or the mode it was made in */
  const blocked = blockedNow(note, here);
  const setBlocked = (text: string | null) => setNote(text ? { text, at: here } : null);
  const block = (c: Control) => {
    audio.play('error');
    setBlocked(c.reason ? reasonText(t, c.reason) : null);
  };
  const { intent, forced, phase } = controls;
  const placing = intent !== null;
  const canCancel = mode.kind !== 'none';

  /* the build button opens the sheet whenever building is possible at all (a turn, the main phase); each row of the sheet says for itself why it is off */
  const gate = Object.values(controls.build).find((c) => c.reason && (c.reason.code === 'notYourTurn' || c.reason.code === 'phase'));
  const buildControl: Control = gate ? { enabled: false, reason: gate.reason } : { enabled: true, reason: null };

  return (
    <section className="dock" aria-label={t('hand.title')}>
      <div className="hint-row">
        <p className="hint" role="status" aria-live="polite">
          {t(controls.hint.key, controls.hint.params)}
        </p>
        {/* a row of its own, right above "Kart al": its 44 px touch area overlaps no button */}
        {!placing && !forced && phase !== 'finished' && <DeckInfoButton left={deckCount} />}
      </div>
      {blocked && (
        <p className="hint blocked" role="alert">
          {blocked}
        </p>
      )}

      {placing ? (
        <div className="placing">
          {extra}
          <p className="field-hint">{selection ? t('game.selected', { what: selection }) : t('game.noSelection')}</p>
          <div className="row">
            <button type="button" className="btn primary grow" data-action="confirm" aria-disabled={!selection || busy} onClick={() => selection && !busy && onConfirm()}>
              {t('game.action.confirm')}
            </button>
            {(canCancel || selection) && (
              <button type="button" className="btn" data-action="cancel" onClick={onCancel}>
                {t('game.action.cancel')}
              </button>
            )}
          </div>
        </div>
      ) : phase === 'finished' ? (
        onScores && (
          <button type="button" className="btn primary wide" onClick={onScores}>
            {t('over.scores')}
          </button>
        )
      ) : (
        !forced && (
          <>
            {(phase === 'roll' || phase === 'main') && controls.myTurn && (
              <div className="row">
                {phase === 'roll' ? (
                  <ActionButton id="roll" label={t('game.action.roll')} control={controls.roll} onClick={() => !busy && onRoll()} onBlocked={block} primary />
                ) : (
                  <ActionButton id="end" label={t('game.action.end')} control={controls.endTurn} onClick={() => !busy && onEnd()} onBlocked={block} primary />
                )}
              </div>
            )}
            <div className="actions-grid">
              <ActionButton
                id="build"
                label={t('game.action.build')}
                control={buildControl}
                onBlocked={block}
                onClick={() => {
                  setBlocked(null);
                  onSheet('build');
                }}
              />
              <ActionButton
                id="buy"
                label={t('game.action.buy')}
                control={controls.buyDevCard}
                sub={shortReason(t, controls.buyDevCard.reason)}
                onBlocked={block}
                onClick={() => !busy && onBuyCard()}
              />
            </div>
          </>
        )
      )}

      <div className="actions-grid small">
        <ActionButton id="trade" label={controls.openOffers > 0 ? t('game.action.tradeOpen', { n: controls.openOffers }) : t('game.action.trade')} control={controls.trade} onBlocked={block} onClick={() => onSheet('trade')} />
        <button type="button" className="btn action" data-action="costs" onClick={() => onSheet('costs')}>
          {t('game.action.costs')}
        </button>
        <button type="button" className="btn action" data-action="log" onClick={() => onSheet('log')}>
          {t('game.action.log')}
        </button>
        {controls.demolish && !placing && (
          <ActionButton
            id="demolish"
            label={t('game.action.demolish')}
            control={controls.demolish}
            onBlocked={block}
            onClick={() => {
              setBlocked(null);
              onMode({ kind: 'demolish' });
            }}
          />
        )}
      </div>
    </section>
  );
}

