import { describe, expect, it } from 'vitest';

import { moveFocus } from '../gridNav';

/** The real grid: twelve cards, two rows of six. */
const FULL = { count: 12, columns: 6 } as const;
/** A partial last row: three rows of four, the last holding one slot. */
const PARTIAL = { count: 9, columns: 4 } as const;
/** The roster as a single vertical column of twelve. */
const COLUMN = { count: 12, columns: 1 } as const;

describe('moveFocus — left and right wrap within the row', () => {
  it('steps right', () => {
    expect(moveFocus(0, 'ArrowRight', FULL.count, FULL.columns)).toBe(1);
    expect(moveFocus(7, 'ArrowRight', FULL.count, FULL.columns)).toBe(8);
  });
  it('wraps right from the last column to the first of the SAME row', () => {
    expect(moveFocus(5, 'ArrowRight', FULL.count, FULL.columns)).toBe(0);
    expect(moveFocus(11, 'ArrowRight', FULL.count, FULL.columns)).toBe(6);
  });
  it('steps left', () => {
    expect(moveFocus(4, 'ArrowLeft', FULL.count, FULL.columns)).toBe(3);
    expect(moveFocus(11, 'ArrowLeft', FULL.count, FULL.columns)).toBe(10);
  });
  it('wraps left from the first column to the last of the SAME row', () => {
    expect(moveFocus(0, 'ArrowLeft', FULL.count, FULL.columns)).toBe(5);
    expect(moveFocus(6, 'ArrowLeft', FULL.count, FULL.columns)).toBe(11);
  });
  it('wraps within a short last row rather than off the end', () => {
    // Row 2 of the partial grid holds only index 8.
    expect(moveFocus(8, 'ArrowRight', PARTIAL.count, PARTIAL.columns)).toBe(8);
    expect(moveFocus(8, 'ArrowLeft', PARTIAL.count, PARTIAL.columns)).toBe(8);
    expect(moveFocus(7, 'ArrowRight', PARTIAL.count, PARTIAL.columns)).toBe(4);
  });
});

describe('moveFocus — up and down keep the column and clamp at the edges', () => {
  it('goes down to the same column of the next row', () => {
    expect(moveFocus(0, 'ArrowDown', FULL.count, FULL.columns)).toBe(6);
    expect(moveFocus(3, 'ArrowDown', FULL.count, FULL.columns)).toBe(9);
  });
  it('stays put going down from the bottom row', () => {
    expect(moveFocus(6, 'ArrowDown', FULL.count, FULL.columns)).toBe(6);
    expect(moveFocus(11, 'ArrowDown', FULL.count, FULL.columns)).toBe(11);
  });
  it('goes up to the same column of the row above', () => {
    expect(moveFocus(6, 'ArrowUp', FULL.count, FULL.columns)).toBe(0);
    expect(moveFocus(11, 'ArrowUp', FULL.count, FULL.columns)).toBe(5);
  });
  it('stays put going up from the top row', () => {
    expect(moveFocus(0, 'ArrowUp', FULL.count, FULL.columns)).toBe(0);
    expect(moveFocus(5, 'ArrowUp', FULL.count, FULL.columns)).toBe(5);
  });
  it('stays put when the slot below does not exist in a partial last row', () => {
    // Column 1 of row 1 (index 5) has nothing beneath it: row 2 is only index 8.
    expect(moveFocus(5, 'ArrowDown', PARTIAL.count, PARTIAL.columns)).toBe(5);
    expect(moveFocus(4, 'ArrowDown', PARTIAL.count, PARTIAL.columns)).toBe(8);
    expect(moveFocus(8, 'ArrowUp', PARTIAL.count, PARTIAL.columns)).toBe(4);
  });
});

describe('moveFocus — a single column of twelve', () => {
  it('steps down the column and clamps at the bottom', () => {
    expect(moveFocus(0, 'ArrowDown', COLUMN.count, COLUMN.columns)).toBe(1);
    expect(moveFocus(10, 'ArrowDown', COLUMN.count, COLUMN.columns)).toBe(11);
    expect(moveFocus(11, 'ArrowDown', COLUMN.count, COLUMN.columns)).toBe(11);
  });
  it('steps up the column and clamps at the top', () => {
    expect(moveFocus(11, 'ArrowUp', COLUMN.count, COLUMN.columns)).toBe(10);
    expect(moveFocus(1, 'ArrowUp', COLUMN.count, COLUMN.columns)).toBe(0);
    expect(moveFocus(0, 'ArrowUp', COLUMN.count, COLUMN.columns)).toBe(0);
  });
  it('leaves the cursor alone on left and right — every row is one slot wide', () => {
    for (const i of [0, 5, 11]) {
      expect(moveFocus(i, 'ArrowLeft', COLUMN.count, COLUMN.columns)).toBe(i);
      expect(moveFocus(i, 'ArrowRight', COLUMN.count, COLUMN.columns)).toBe(i);
    }
  });
  it('jumps to the ends', () => {
    expect(moveFocus(6, 'Home', COLUMN.count, COLUMN.columns)).toBe(0);
    expect(moveFocus(6, 'End', COLUMN.count, COLUMN.columns)).toBe(11);
  });
});

describe('moveFocus — Home and End', () => {
  it('goes to the first and the last slot of the whole grid', () => {
    expect(moveFocus(7, 'Home', FULL.count, FULL.columns)).toBe(0);
    expect(moveFocus(7, 'End', FULL.count, FULL.columns)).toBe(11);
    expect(moveFocus(0, 'End', PARTIAL.count, PARTIAL.columns)).toBe(8);
  });
});

describe('moveFocus — degenerate input never escapes the grid', () => {
  it('clamps an out-of-range index', () => {
    expect(moveFocus(99, 'ArrowRight', FULL.count, FULL.columns)).toBe(6);
    expect(moveFocus(-3, 'ArrowUp', FULL.count, FULL.columns)).toBe(0);
  });
  it('returns 0 for an empty grid', () => {
    expect(moveFocus(0, 'End', 0, FULL.columns)).toBe(0);
    expect(moveFocus(4, 'ArrowDown', 0, FULL.columns)).toBe(0);
  });
  it('always lands on a real slot, from every slot, for every key', () => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const;
    for (const { count, columns } of [FULL, PARTIAL, { count: 12, columns: 1 }]) {
      for (let i = 0; i < count; i += 1) {
        for (const key of keys) {
          const next = moveFocus(i, key, count, columns);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(count);
        }
      }
    }
  });
});
