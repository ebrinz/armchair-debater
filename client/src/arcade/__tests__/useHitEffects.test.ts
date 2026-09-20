import { describe, expect, it } from 'vitest';

import { flareVisible } from '../hooks/useHitEffects';

describe('flareVisible', () => {
  it('shows for a fresh super hit', () => {
    expect(flareVisible(true, -1, 5, false)).toBe(true);
  });

  it('stops once that hit has burnt out', () => {
    expect(flareVisible(true, 5, 5, false)).toBe(false);
  });

  it('never shows for a hit that is not super', () => {
    expect(flareVisible(false, -1, 5, false)).toBe(false);
  });

  it('never shows under reduced motion, even for a fresh super hit', () => {
    expect(flareVisible(true, -1, 5, true)).toBe(false);
  });
});
