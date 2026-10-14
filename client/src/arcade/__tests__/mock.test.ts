import { describe, expect, it } from 'vitest';

import { mockFrame, mockLevel, mockTalk } from '../mock';

describe('pinning a replay frame', () => {
  it('reads a frame index that exists', () => {
    expect(mockFrame('?mock=learn&frame=3', 10)).toBe(3);
    expect(mockFrame('?mock=learn&frame=0', 10)).toBe(0);
  });

  it('ignores a frame that is missing, past the end, or not a number', () => {
    expect(mockFrame('?mock=learn', 10)).toBeNull();
    expect(mockFrame('?mock=learn&frame=10', 10)).toBeNull();
    expect(mockFrame('?mock=learn&frame=-1', 10)).toBeNull();
    expect(mockFrame('?mock=learn&frame=two', 10)).toBeNull();
  });
});

describe('a fake voice', () => {
  it('names the side that talks', () => {
    expect(mockTalk('?mock&talk=bot')).toBe('bot');
    expect(mockTalk('?mock&talk=user')).toBe('user');
    expect(mockTalk('?mock&talk=nobody')).toBeNull();
    expect(mockTalk('?mock')).toBeNull();
  });

  it('never falls silent, so a mouth that should move always can', () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      const level = mockLevel(ms);
      expect(level).toBeGreaterThanOrEqual(0.2);
      expect(level).toBeLessThanOrEqual(0.9);
    }
  });
});
