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
  [-58, -46, 0, 11],
  [44, -60, 20, 9],
  [-28, -74, 40, 13],
  [68, -34, 10, 10],
  [-76, -20, 60, 9],
  [18, -84, 30, 12],
  [-12, -54, 70, 8],
  [86, -62, 50, 9],
  [-92, -56, 90, 11],
  [36, -22, 80, 8],
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
