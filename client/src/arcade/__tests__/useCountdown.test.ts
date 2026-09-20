import { describe, expect, it } from 'vitest';

import { countdownStep } from '../hooks/useCountdown';

describe('countdownStep', () => {
  it('counts 9 down to 0, one step at a time', () => {
    const seen: number[] = [9];
    let value = 9;
    for (let i = 0; i < 9; i += 1) {
      value = countdownStep(value, false);
      seen.push(value);
    }
    expect(seen).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('stops at 0 rather than going negative', () => {
    expect(countdownStep(0, false)).toBe(0);
    expect(countdownStep(countdownStep(0, false), false)).toBe(0);
  });

  it('pauses while the tab is hidden', () => {
    expect(countdownStep(5, true)).toBe(5);
    // …and picks up from the same number when the tab comes back.
    expect(countdownStep(countdownStep(5, true), false)).toBe(4);
  });
});
