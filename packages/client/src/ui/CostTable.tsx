import { RESOURCES, type Hand } from '@ada/game-core';
import { useT } from '../i18n/context';
import { hasKey, type MessageKey } from '../i18n';
import { ResourceIcon } from './ResourceIcon';

export type CostRows = { road: Hand; settlement: Hand; city: Hand; devCard: Hand };

/** The piece costs as a table; one component for the Costs sheet (a player's own, role included) and the rules (the base ones). */
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
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
