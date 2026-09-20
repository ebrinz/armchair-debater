import { useEffect, useState } from 'react';

/**
 * One tick of the arcade's CONTINUE? countdown — pure, so the three rules that
 * matter are unit-tested rather than eyeballed against a wall clock: it counts
 * down by one, it stops at 0, and it stands still while the tab is hidden
 * (a player who tabs away should come back to the same number, not to
 * GAME OVER).
 */
export const countdownStep = (value: number, hidden: boolean): number =>
  hidden || value <= 0 ? value : value - 1;

const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Counts `from` down to 0, one step a second, once `running` is true. The
 * countdown is not motion in the reduced-motion sense — it is the prompt's
 * content — so it runs either way.
 */
export const useCountdown = (from: number, running = true): number => {
  const [value, setValue] = useState(from);
  const done = value <= 0;

  useEffect(() => {
    if (!running || done) return;
    const timer = window.setInterval(() => setValue((v) => countdownStep(v, hidden())), 1000);
    return () => window.clearInterval(timer);
  }, [running, done]);

  return value;
};
