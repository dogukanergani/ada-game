import { useEffect, useState } from 'react';
import { useT } from '../i18n/context';
import { TUMBLE_FACES, TUMBLE_STEP_MS, type RollStage } from '../game/roll';

/** Where the pips sit on a 3 x 3 grid (percent of the face), per face value. */
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[27, 27], [73, 73]],
  3: [[27, 27], [50, 50], [73, 73]],
  4: [[27, 27], [73, 27], [27, 73], [73, 73]],
  5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
  6: [[27, 27], [73, 27], [27, 50], [73, 50], [27, 73], [73, 73]],
};

/** One die face drawn with dots, like a real die (1-6). */
export function Die({ value }: { value: number }) {
  return (
    <svg className="die-face" data-value={value} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="92" height="92" rx="20" fill="#f4ead0" stroke="#5b4a2b" strokeWidth="4" />
      {(PIPS[value] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" fill="#2a2418" />
      ))}
    </svg>
  );
}

interface Props {
  /** the real result; read only once the dice have stopped */
  dice: [number, number] | null;
  stage: RollStage;
  /** the big one in the middle of the board while the roll plays; false for the small, permanent one in the corner */
  stageLayer?: boolean;
}

/**
 * Two dice and their total. While `rolling` the faces run through a fixed
 * sequence that does not depend on the result and the total is not written, so
 * nothing about the outcome is in the page until the dice stop.
 */
export function DiceTray({ dice, stage, stageLayer = false }: Props) {
  const t = useT();
  const rolling = stage === 'rolling';
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setTick((n) => n + 1), TUMBLE_STEP_MS);
    return () => clearInterval(id);
  }, [rolling]);

  if (!rolling && !dice) return null;
  const faces: [number, number] = rolling ? [TUMBLE_FACES[tick % TUMBLE_FACES.length], TUMBLE_FACES[(tick + 3) % TUMBLE_FACES.length]] : dice!;
  const total = rolling ? null : dice![0] + dice![1];
  const seven = total === 7;
  const announcement = total === null ? '' : t('dice.announce', { a: dice![0], b: dice![1], total });

  return (
    <div className={stageLayer ? 'dice dice-stage' : 'dice dice-tray'} data-stage={stage} data-layer={stageLayer ? 'stage' : 'corner'} data-seven={seven} data-faces={rolling ? undefined : faces.join(',')}>
      <span className="dice-faces" aria-hidden="true">
        <span className="die" data-die="0"><Die value={faces[0]} /></span>
        <span className="die" data-die="1"><Die value={faces[1]} /></span>
      </span>
      {total !== null && (
        <span className="dice-sum" aria-hidden="true">
          <span className="dice-total" data-total={total}>{total}</span>
          {seven && <span className="dice-robber">{t('dice.robber')}</span>}
        </span>
      )}
      {/* only one of the two copies speaks, and only after the dice have stopped */}
      {!stageLayer && (
        <span className="visually-hidden" role="status">
          {announcement}
        </span>
      )}
    </div>
  );
}
