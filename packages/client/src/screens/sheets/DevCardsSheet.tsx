import { useState } from 'react';
import { DEV_CARD_KINDS, RESOURCES, type DevCardKind, type GameView, type LegalMoves, type Resource } from '@ada/game-core';
import { useT } from '../../i18n/context';
import type { MessageKey } from '../../i18n';
import { handText } from '../../i18n/format';
import { DeckInfoButton } from '../../ui/DeckInfo';
import { ResourceIcon } from '../../ui/ResourceIcon';
import { Sheet } from '../../ui/Sheet';

interface Props {
  view: GameView;
  legal: LegalMoves;
  onClose: () => void;
  onBuy: () => void;
  send: (action: Record<string, unknown>) => Promise<boolean>;
}

type Step = { kind: 'monopoly' } | { kind: 'plenty'; picks: Resource[] } | null;
const isPlay = (kind: DevCardKind, a: { type: string }) =>
  (kind === 'knight' && a.type === 'playKnight') ||
  (kind === 'roadBuilding' && a.type === 'playRoadBuilding') ||
  (kind === 'monopoly' && a.type === 'playMonopoly') ||
  (kind === 'yearOfPlenty' && a.type === 'playYearOfPlenty');

/** The player's development cards, what each does, and a Play button that is on only when the server lists the play as legal. */
export function DevCardsSheet({ view, legal, onClose, onBuy, send }: Props) {
  const t = useT();
  const [step, setStep] = useState<Step>(null);
  const me = view.players.find((p) => p.id === view.me)!;
  const cards = me.devCards ?? [];
  const myTurn = view.current === view.me;
  const army = view.largestArmy.holder ? view.players.find((p) => p.id === view.largestArmy.holder)!.name : null;

  const reasonFor = (kind: DevCardKind, copies: { boughtTurn: number }[]): MessageKey | null => {
    if (legal.devPlays.some((a) => isPlay(kind, a))) return null;
    if (kind === 'victoryPoint') return 'dev.reason.victory';
    if (!myTurn) return 'dev.reason.turn';
    if (view.phase !== 'roll' && view.phase !== 'main') return 'dev.reason.phase';
    if (view.turnFlags.devPlayed) return 'dev.reason.limit';
    if (copies.every((c) => c.boughtTurn >= view.turn)) return 'dev.reason.bought';
    if (kind === 'roadBuilding') return 'dev.reason.noSpot';
    if (kind === 'yearOfPlenty') return 'dev.reason.bank';
    return 'dev.reason.phase';
  };

  const play = async (action: Record<string, unknown>) => {
    if (await send(action)) onClose();
  };

  return (
    <Sheet title={t('dev.title')} onClose={onClose}>
      <p className="field-hint">
        {army ? t('dev.army', { player: army, size: view.largestArmy.size }) : t('dev.armyNone')} · {t('dev.deck', { n: view.devDeckCount })}
      </p>
      {cards.length === 0 && <p>{t('dev.none')}</p>}
      <ul className="dev-list">
        {DEV_CARD_KINDS.filter((k) => cards.some((c) => c.kind === k)).map((kind) => {
          const copies = cards.filter((c) => c.kind === kind);
          const reason = reasonFor(kind, copies);
          return (
            <li key={kind} className="dev-card" data-kind={kind}>
              <div>
                <strong>
                  {t(`devCard.${kind}`)} × {copies.length}
                </strong>
                <p className="field-hint">{t(`devCardDesc.${kind}` as MessageKey)}</p>
                {reason && <p className="field-hint reason">{t(reason)}</p>}
              </div>
              {kind !== 'victoryPoint' && (
                <button
                  type="button"
                  className="btn primary"
                  data-action={`play-${kind}`}
                  aria-disabled={reason !== null}
                  onClick={() => {
                    if (reason) return;
                    if (kind === 'knight') void play({ type: 'playKnight' });
                    if (kind === 'roadBuilding') void play({ type: 'playRoadBuilding' });
                    if (kind === 'monopoly') setStep({ kind: 'monopoly' });
                    if (kind === 'yearOfPlenty') setStep({ kind: 'plenty', picks: [] });
                  }}
                >
                  {t('dev.play')}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {step?.kind === 'monopoly' && (
        <section className="stack" aria-label={t('devCard.monopoly')}>
          <h3>{t('dev.pickOne')}</h3>
          <ul className="res-picker">
            {RESOURCES.map((r) => (
              <li key={r}>
                <button type="button" className="res-button" data-resource={r} onClick={() => void play({ type: 'playMonopoly', resource: r })}>
                  <ResourceIcon resource={r} />
                  <span>{t(`resource.${r}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step?.kind === 'plenty' && (
        <section className="stack" aria-label={t('devCard.yearOfPlenty')}>
          <h3>{t('dev.pickTwo', { n: step.picks.length })}</h3>
          <ul className="res-picker">
            {RESOURCES.map((r) => (
              <li key={r}>
                <button
                  type="button"
                  className="res-button"
                  data-resource={r}
                  disabled={step.picks.length >= 2}
                  onClick={() => setStep({ kind: 'plenty', picks: [...step.picks, r] })}
                >
                  <ResourceIcon resource={r} />
                  <span>{t(`resource.${r}`)}</span>
                </button>
              </li>
            ))}
          </ul>
          {step.picks.length > 0 && <p className="field-hint">{handText(t, step.picks.reduce((h, r) => ({ ...h, [r]: (h[r] ?? 0) + 1 }), {} as Partial<Record<Resource, number>>))}</p>}
          <div className="row">
            <button
              type="button"
              className="btn primary grow"
              data-action="plenty-confirm"
              aria-disabled={step.picks.length !== 2 || !legal.devPlays.some((a) => a.type === 'playYearOfPlenty' && a.a === step.picks[0] && a.b === step.picks[1])}
              onClick={() => {
                const [a, b] = step.picks;
                if (step.picks.length === 2 && legal.devPlays.some((x) => x.type === 'playYearOfPlenty' && x.a === a && x.b === b)) void play({ type: 'playYearOfPlenty', a, b });
              }}
            >
              {t('dev.confirm')}
            </button>
            <button type="button" className="btn" onClick={() => setStep({ kind: 'plenty', picks: [] })}>
              {t('game.action.cancel')}
            </button>
          </div>
        </section>
      )}

      <div className="buy-row">
      <button type="button" className="btn wide" data-action="buy-in-sheet" aria-disabled={!legal.canBuyDevCard} onClick={() => legal.canBuyDevCard && onBuy()}>
        {t('dev.buy')} · {t('dev.cost', { cost: handText(t, view.mine!.costs.devCard) })}
      </button>
      <DeckInfoButton left={view.devDeckCount} />
      </div>
    </Sheet>
  );
}
