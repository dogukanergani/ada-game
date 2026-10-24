import { RESOURCES, type Hand } from '@ada/game-core';
import { useT } from '../i18n/context';
import { hasKey, type MessageKey } from '../i18n';
import { ResourceIcon } from './ResourceIcon';

export type CostRows = { road: Hand; settlement: Hand; city: Hand; devCard: Hand };

/** The points a piece is worth, in words: a road scores nothing, a settlement 1, a city 2 (in place of the settlement it replaces); a development card depends on the card. */
function PointsCell({ kind }: { kind: 'road' | 'settlement' | 'city' | 'devCard' | 'none' }) {
  const t = useT();
  if (kind === 'settlement') return <td className="cost-points" data-points="1">{t('costs.points.settlement')}</td>;
  if (kind === 'city') {
    return (
      <td className="cost-points" data-points="2">
        {t('costs.points.city')}
        <small className="cost-points-note">{t('costs.points.cityNote')}</small>
      </td>
    );
  }
  if (kind === 'devCard') return <td className="cost-points" data-points="card">{t('costs.points.devCard')}</td>;
  return <td className="cost-points" data-points="0" aria-label={t('costs.points.noneLabel')}>{t('costs.points.none')}</td>;
}

function CostHead() {
  const t = useT();
  return (
    <thead>
      <tr>
        <th scope="col">{t('costs.col.piece')}</th>
        <th scope="col">{t('costs.col.cost')}</th>
        <th scope="col" className="cost-points-head">{t('costs.col.points')}</th>
      </tr>
    </thead>
  );
}

/** The piece costs as a table, with what each is worth in points; one component for the Costs sheet (a player's own, role included) and the rules (the base ones). */
export function CostTable({ costs }: { costs: CostRows }) {
  const t = useT();
  const rows = [
    ['road', t('piece.road')],
    ['settlement', t('piece.settlement')],
    ['city', t('piece.city')],
    ['devCard', t('costs.devCard')],
  ] as const;
  return (
    <table className="cost-table">
      <CostHead />
      <tbody>
        {rows.map(([k, label]) => (
          <tr key={k} data-cost={k}>
            <th scope="row">{label}</th>
            <td>
              {RESOURCES.filter((r) => costs[k][r] > 0).map((r) => (
                <span key={r} className="cost-item">
                  <ResourceIcon resource={r} size={20} /> {costs[k][r]} {t(`resource.${r}`)}
                </span>
              ))}
            </td>
            <PointsCell kind={k} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What a role's own action costs, by the kind of piece it targets (the Soldier's demolition): the same rows as the build costs. */
export function ActionCostTable({ name, costs }: { name: string; costs: Record<string, Hand> }) {
  const t = useT();
  const title = hasKey(`costs.action.${name}`) ? t(`costs.action.${name}` as MessageKey) : name;
  return (
    <section className="stack" data-action-costs={name}>
      <h3>{title}</h3>
      <table className="cost-table">
        <CostHead />
        <tbody>
          {Object.entries(costs).map(([kind, hand]) => (
            <tr key={kind} data-cost={`${name}:${kind}`}>
              <th scope="row">{hasKey(`piece.${kind}`) ? t(`piece.${kind}` as MessageKey) : kind}</th>
              <td>
                {RESOURCES.filter((r) => hand[r] > 0).map((r) => (
                  <span key={r} className="cost-item">
                    <ResourceIcon resource={r} size={20} /> {hand[r]} {t(`resource.${r}`)}
                  </span>
                ))}
              </td>
              <PointsCell kind="none" />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
