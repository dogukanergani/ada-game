import { RESOURCES, type Hand } from '@ada/game-core';
import { useT } from '../i18n/context';
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
