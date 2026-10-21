import type { Resource } from '@ada/game-core';
import { useT } from '../i18n/context';
import { ResourceIcon } from './ResourceIcon';

interface Props {
  resource: Resource;
  value: number;
  max: number;
  onChange: (v: number) => void;
}

/** A resource with minus and plus buttons; the name is written, not only pictured. */
export function Stepper({ resource, value, max, onChange }: Props) {
  const t = useT();
  const name = t(`resource.${resource}`);
  return (
    <div className="stepper" role="group" aria-label={name}>
      <ResourceIcon resource={resource} />
      <span className="stepper-name">{name}</span>
      <button type="button" className="btn step-btn" aria-label={t('trade.dec', { name })} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output className="stepper-value" aria-live="polite">
        {value}
      </output>
      <button type="button" className="btn step-btn" aria-label={t('trade.inc', { name })} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
