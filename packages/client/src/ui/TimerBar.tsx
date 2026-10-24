import { useEffect, useState } from 'react';
import type { GameView } from '@ada/game-core';
import { gameProgress, isUrgent, minutesLeft, mmss, msToNextSecond, remainingMs, type ServerTimerClock } from '../game/timer';
import { useT } from '../i18n/context';

interface Props {
  view: GameView;
  clock: ServerTimerClock | null;
}

/**
 * The timed mode's countdowns in the top row: the turn's time left (urgent in the last 10 seconds: a warning colour and the words
 * "time is nearly up", never colour alone) and the game's time left with a progress bar. Not drawn for an untimed or finished
 * game. This is the time left; the game clock beside it (GameClock) is the time passed.
 */
export function TimerBar({ view, clock }: Props) {
  const t = useT();
  const [, wake] = useState(0);
  const turnLeft = clock && clock.turnRemainingMs !== null ? remainingMs(clock.turnRemainingMs, clock, performance.now()) : null;
  const gameLeft = clock ? remainingMs(clock.gameRemainingMs, clock, performance.now()) : null;
  const running = view.phase !== 'finished' && clock !== null;
  useEffect(() => {
    if (!running) return;
    const next = Math.min(turnLeft === null ? 1000 : msToNextSecond(turnLeft), msToNextSecond(gameLeft ?? 1000));
    const id = setTimeout(() => wake((n) => n + 1), Math.max(50, next) + 20);
    return () => clearTimeout(id);
  });
  if (!view.timer || view.phase === 'finished' || !clock || gameLeft === null) return null;

  const mine = view.current === view.me;
  const urgent = turnLeft !== null && isUrgent(turnLeft);
  const progress = gameProgress(view.timer.gameSeconds, gameLeft);
  const gameText = gameLeft < 60_000 ? t('timer.gameLeft.sec', { n: Math.ceil(gameLeft / 1000) }) : t('timer.gameLeft', { n: minutesLeft(gameLeft) });
  const turnText = turnLeft === null ? t('timer.setup') : mmss(turnLeft);
  return (
    <div className="timer-bar" data-urgent={urgent} data-mine={mine} role="group" aria-label={t('timer.label')}>
      <span className="timer-turn" role="timer" data-turn-left={turnLeft === null ? undefined : Math.ceil(turnLeft / 1000)} aria-label={`${t('timer.turn')}: ${turnText}`}>
        <span className="timer-name">{t('timer.turn')}</span> <span className="timer-value">{turnText}</span>
        {urgent && <span className="timer-hurry"> {t('timer.hurry')}</span>}
      </span>
      <span className="timer-game" data-game-left={Math.ceil(gameLeft / 1000)}>
        {gameText}
      </span>
      <span
        className="timer-progress"
        role="progressbar"
        aria-label={t('timer.gameProgress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span className="timer-progress-fill" style={{ width: `${progress * 100}%` }} />
      </span>
    </div>
  );
}
