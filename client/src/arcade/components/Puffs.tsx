import type { CSSProperties } from 'react';

import type { Side } from '../types';

/**
 * The particles a hit throws off: stuffing bursting out of the chair that took
 * it, or a dust whiff at the attacker when a swing missed entirely.
 *
 * The spread is a fixed table rather than `Math.random()`, so a hit looks the
 * same every time it is replayed and nothing has to re-render to animate.
 */
const SPREAD: Array<[dx: number, dy: number, delay: number, size: number]> = [
  [-34, -30, 0, 6],
  [28, -38, 20, 5],
  [-18, -46, 40, 7],
  [42, -22, 10, 6],
  [-46, -14, 60, 5],
  [12, -52, 30, 6],
  [-8, -34, 70, 4],
  [52, -40, 50, 5],
  [-56, -36, 90, 6],
  [22, -14, 80, 4],
];

export interface PuffsProps {
  side: Side;
  count: number;
  kind: 'stuffing' | 'dust';
}

export const Puffs = ({ side, count, kind }: PuffsProps) => (
  <span className={`puffs puffs--${side} puffs--${kind}`} aria-hidden="true">
    {SPREAD.slice(0, count).map(([dx, dy, delay, size], i) => (
      <span
        key={i}
        className="puffs__bit"
        style={
          {
            '--dx': `${side === 'bot' ? -dx : dx}px`,
            '--dy': `${kind === 'dust' ? dy / 3 : dy}px`,
            '--delay': `${delay}ms`,
            '--size': `${size}px`,
          } as CSSProperties
        }
      />
    ))}
  </span>
);
