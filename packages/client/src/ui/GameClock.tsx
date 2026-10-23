import { useEffect, useState } from 'react';
import { elapsedMinutes, msToNextMinute, type ServerClock } from '../game/clock';
import { useT } from '../i18n/context';

/** "12 dk": how long the game has been going, to the minute. The figure is the server's; this only counts on from when it arrived. */
export function GameClock({ clock }: { clock: ServerClock | null }) {
  const t = useT();
  const [, wake] = useState(0);
  useEffect(() => {
    if (!clock?.running) return;
    const id = setTimeout(() => wake((n) => n + 1), msToNextMinute(clock, performance.now()) + 50);
    return () => clearTimeout(id);
  });
  if (!clock) return null;
  const minutes = elapsedMinutes(clock, performance.now());
  const text = minutes >= 60 ? t('clock.hours', { h: Math.floor(minutes / 60), m: minutes % 60 }) : t('clock.minutes', { n: minutes });
  return (
    <span className="game-clock" data-clock={minutes} role="timer" aria-label={`${t('clock.label')}: ${text}`} title={t('clock.label')}>
      {text}
    </span>
  );
}
