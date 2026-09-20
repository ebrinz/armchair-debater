/**
 * Roving focus for the character-select grid — pure, so the keyboard rules are
 * unit-tested rather than eyeballed in a browser.
 *
 * The two axes behave differently on purpose, and that difference is what makes
 * a grid of slots feel like a fighting game's roster rather than a list:
 * left/right run round the row you are on (the roster never dead-ends under
 * your thumb), while up/down hold the column and stop at the edges (so you
 * always know which slot is above the one you are on, even when the last row is
 * short).
 */

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

export const moveFocus = (index: number, key: GridKey, count: number, columns: number): number => {
  if (count <= 0) return 0;
  const width = Math.max(1, columns);
  const from = clamp(Math.trunc(index), count - 1);

  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowUp':
      return from - width >= 0 ? from - width : from;
    case 'ArrowDown':
      return from + width < count ? from + width : from;
    default: {
      // Wrap inside this row, which may be shorter than a full one.
      const start = Math.floor(from / width) * width;
      const length = Math.min(width, count - start);
      const step = key === 'ArrowRight' ? 1 : length - 1;
      return start + ((from - start + step) % length);
    }
  }
};
