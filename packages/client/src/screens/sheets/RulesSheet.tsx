import {
  BASE_COSTS, DEV_CARD_COST, DEV_CARD_KINDS, DEV_DECK_COMPOSITION, LARGEST_ARMY_MIN, LONGEST_ROAD_MIN, MODES, ROLE_LIST,
} from '@ada/game-core';
import { useT } from '../../i18n/context';
import { hasKey, type MessageKey } from '../../i18n';
import { ActionCostTable, CostTable } from '../../ui/CostTable';
import { Sheet } from '../../ui/Sheet';

const BASE = { ...BASE_COSTS, devCard: DEV_CARD_COST };

/**
 * "How to play": read-only reference. It takes no game state (only the public target score, if opened from a game; otherwise
 * rules data from the core), so it can neither change a game nor show anything
 * about a rival's hand, and closing it leaves everything where it was.
 */
export function RulesSheet({ onClose, vpToWin }: { onClose: () => void; /** the target of the game this is opened from (public); left out on the home screen, where both modes are told */ vpToWin?: number }) {
  const t = useT();
  const key = (id: string, part: 'name' | 'desc'): MessageKey | null => (hasKey(`role.${id}.${part}`) ? (`role.${id}.${part}` as MessageKey) : null);
  const score = [
    [t('rules.score.settlement'), 1],
    [t('rules.score.city'), 2],
    [t('rules.score.road', { n: LONGEST_ROAD_MIN }), 2],
    [t('rules.score.army', { n: LARGEST_ARMY_MIN }), 2],
    [t('rules.score.hidden'), 1],
  ] as const;

  return (
    <Sheet title={t('rules.open')} onClose={onClose}>
      <section className="stack" aria-labelledby="rules-loop" data-rules="loop">
        <h3 id="rules-loop">{t('rules.loop.title')}</h3>
        <ol className="rules-steps">
          <li>{t('rules.loop.setup')}</li>
          <li>{t('rules.loop.roll')}</li>
          <li>{t('rules.loop.main')}</li>
          <li>{t('rules.loop.win')}</li>
        </ol>
      </section>

      <section className="stack" aria-labelledby="rules-roles" data-rules="roles">
        <h3 id="rules-roles">{t('rules.roles.title')}</h3>
        <p className="field-hint">{t('rules.roles.help')}</p>
        <dl className="rules-list">
          {ROLE_LIST.map((r) => (
            <div key={r.id} data-role={r.id}>
              <dt>{key(r.id, 'name') ? t(key(r.id, 'name')!) : r.id}</dt>
              <dd>
                {key(r.id, 'desc') ? t(key(r.id, 'desc')!) : ''}
                {Object.entries(r.actions ?? {}).map(([name, a]) => (a.costs ? <ActionCostTable key={name} name={name} costs={a.costs} /> : null))}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="stack" aria-labelledby="rules-cards" data-rules="cards">
        <h3 id="rules-cards">{t('rules.cards.title')}</h3>
        <dl className="rules-list">
          {DEV_CARD_KINDS.map((k) => (
            <div key={k} data-card={k}>
              <dt>
                {t(`devCard.${k}`)} <span className="tag">{t('rules.cards.count', { n: DEV_DECK_COMPOSITION[k] })}</span>
              </dt>
              <dd>{t(`devCardDesc.${k}` as MessageKey)}</dd>
            </div>
          ))}
        </dl>
        <p className="field-hint">{t('rules.cards.limit')}</p>
      </section>

      <section className="stack" aria-labelledby="rules-score" data-rules="score">
        <h3 id="rules-score">{t('rules.score.title')}</h3>
        <p data-rules="win">
          {vpToWin !== undefined ? t('rules.score.win', { vp: vpToWin }) : t('rules.score.winBoth', { standard: MODES.standard.vpToWin, short: MODES.short.vpToWin })}
        </p>
        <table className="cost-table">
          <tbody>
            {score.map(([label, points]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className="score-points">{points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="stack" aria-labelledby="rules-costs" data-rules="costs">
        <h3 id="rules-costs">{t('rules.costs.title')}</h3>
        <p className="field-hint">{t('rules.costs.base')}</p>
        <CostTable costs={BASE} />
      </section>
    </Sheet>
  );
}
