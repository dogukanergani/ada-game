import { useState } from 'react';
import { RESOURCES, type GameView, type LegalMoves, type Resource } from '@ada/game-core';
import { countHand } from '../../game/controls';
import { useT } from '../../i18n/context';
import { handText } from '../../i18n/format';
import type { LogEntry } from '../../net/store';
import { ActionCostTable, CostTable } from '../../ui/CostTable';
import { LogList } from '../../ui/LogList';
import { ResourceIcon } from '../../ui/ResourceIcon';
import { Sheet } from '../../ui/Sheet';
import { Stepper } from '../../ui/Stepper';

/** Costs and bank ratios, as the server worked them out for this player's role and harbors. */
export function CostsSheet({ view, onClose }: { view: GameView; onClose: () => void }) {
  const t = useT();
  const mine = view.mine!;
  return (
    <Sheet title={t('costs.title')} onClose={onClose}>
      <p className="field-hint">{t('costs.forRole')}</p>
      <CostTable costs={mine.costs} />
      {Object.entries(mine.actionCosts).map(([name, costs]) => (
        <ActionCostTable key={name} name={name} costs={costs} />
      ))}
      <h3>{t('costs.ratios')}</h3>
      <p className="field-hint">{t('costs.ratiosHelp')}</p>
      <ul className="ratio-list">
        {RESOURCES.map((r) => (
          <li key={r} data-ratio={r}>
            <ResourceIcon resource={r} size={20} /> {t(`resource.${r}`)} <strong>{t('costs.ratio', { ratio: mine.bankRatios[r] })}</strong>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function LogSheet({ view, log, onClose }: { view: GameView; log: LogEntry[]; onClose: () => void }) {
  const t = useT();
  return (
    <Sheet title={t('log.title')} onClose={onClose}>
      <LogList view={view} log={log} />
    </Sheet>
  );
}

/** The forced sheet when a 7 came up: pick exactly as many cards as you must give up. */
export function DiscardSheet({ view, legal, send }: { view: GameView; legal: LegalMoves; send: (a: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  const hand = view.players.find((p) => p.id === view.me)!.hand!;
  const [pick, setPick] = useState<Record<Resource, number>>({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
  const chosen = countHand(pick);
  const ready = chosen === legal.mustDiscard;
  return (
    <Sheet title={t('discard.title')}>
      <p>{t('discard.body', { n: legal.mustDiscard })}</p>
      {RESOURCES.map((r) => (
        <Stepper
          key={r}
          resource={r}
          value={pick[r]}
          max={Math.min(hand[r], pick[r] + (legal.mustDiscard - chosen))}
          onChange={(v) => setPick({ ...pick, [r]: v })}
        />
      ))}
      <p className="field-hint" role="status">
        {t('discard.selected', { n: chosen, total: legal.mustDiscard })}
      </p>
      <button
        type="button"
        className="btn primary wide"
        data-action="discard"
        aria-disabled={!ready}
        onClick={() => {
          if (!ready) return;
          void send({ type: 'discard', resources: Object.fromEntries(RESOURCES.filter((r) => pick[r] > 0).map((r) => [r, pick[r]])) });
        }}
      >
        {t('discard.confirm')} {ready ? `(${handText(t, pick)})` : ''}
      </button>
    </Sheet>
  );
}

/** The forced sheet when the robber stands next to several rivals: choose whom to steal from. Only their card counts are shown. */
export function StealSheet({ view, legal, send }: { view: GameView; legal: LegalMoves; send: (a: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  return (
    <Sheet title={t('steal.title')}>
      <ul className="victim-list">
        {legal.stealVictims.map((id) => {
          const p = view.players.find((x) => x.id === id)!;
          return (
            <li key={id}>
              <button type="button" className="btn wide" data-victim={id} onClick={() => void send({ type: 'steal', victim: id })}>
                {p.name} · {t('steal.cards', { n: p.handCount })}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
