import { describe, expect, it } from 'vitest';

import { typedPrefix } from '../hooks/useTypewriter';

const LINES = ['YOU used "Made a point."', "It's super effective!  −30"];

describe('typedPrefix', () => {
  it('has typed nothing at zero elapsed', () => {
    expect(typedPrefix(LINES, 0, 40)).toEqual(['', '']);
  });

  it('types the first line before starting the second', () => {
    // 40 cps → 10 characters at 250 ms.
    expect(typedPrefix(LINES, 250, 40)).toEqual(['YOU used "', '']);
  });

  it('carries the overflow into the next line', () => {
    const elapsed = ((LINES[0].length + 5) / 40) * 1000;
    expect(typedPrefix(LINES, elapsed, 40)).toEqual([LINES[0], "It's "]);
  });

  it('settles on the full text and stays there', () => {
    expect(typedPrefix(LINES, 10_000, 40)).toEqual(LINES);
    expect(typedPrefix(LINES, 1e9, 40)).toEqual(LINES);
  });

  it('treats a non-positive rate as instant, and a negative elapsed as zero', () => {
    expect(typedPrefix(LINES, 100, 0)).toEqual(LINES);
    expect(typedPrefix(LINES, -50, 40)).toEqual(['', '']);
  });

  it('keeps one entry per line, always', () => {
    expect(typedPrefix([], 100, 40)).toEqual([]);
    expect(typedPrefix(['a', 'b', 'c'], 25, 40)).toEqual(['a', '', '']);
  });
});
