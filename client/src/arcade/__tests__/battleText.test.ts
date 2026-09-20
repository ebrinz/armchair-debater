import { describe, expect, it } from 'vitest';

import { battleLines, decisionBanner, hitTier, speakerName } from '../battleText';
import type { Hit } from '../types';

const hit = (over: Partial<Hit>): Hit => ({ by: 'user', damage: 10, recovery: 0, reason: 'Made a point.', ...over });

describe('hitTier', () => {
  it.each([
    [0, 'miss'],
    [1, 'glancing'],
    [10, 'glancing'],
    [11, 'solid'],
    [29, 'solid'],
    [30, 'super'],
    [50, 'super'],
  ] as const)('damage %i is a %s hit', (damage, tier) => {
    expect(hitTier(damage)).toBe(tier);
  });

  it('treats anything at or below zero as a miss', () => {
    expect(hitTier(-5)).toBe('miss');
  });

  it('tiers the six damages the balance rules produce in the fixtures', () => {
    expect([24, 30, 8, 44, 20, 28].map(hitTier)).toEqual([
      'solid',
      'super',
      'glancing',
      'super',
      'solid',
      'solid',
    ]);
  });
});

describe('battleLines', () => {
  it('names the speaker and quotes the reason', () => {
    expect(battleLines(hit({}))[0]).toBe('YOU used "Made a point."');
    expect(battleLines(hit({ by: 'bot' }))[0]).toBe('THE HOUSE used "Made a point."');
  });

  it('adds no effectiveness line for a solid hit', () => {
    expect(battleLines(hit({ damage: 24 }))).toEqual(['YOU used "Made a point."', '−24']);
  });

  it.each([
    [30, "It's super effective!  −30"],
    [44, "It's super effective!  −44"],
    [29, '−29'],
    [11, '−11'],
    [10, "It's not very effective…  −10"],
    [1, "It's not very effective…  −1"],
    [0, 'But it missed!'],
  ])('damage %i reads %s', (damage, line) => {
    expect(battleLines(hit({ damage }))[1]).toBe(line);
  });

  it('can never disagree with hitTier', () => {
    for (let damage = 0; damage <= 50; damage += 1) {
      const line = battleLines(hit({ damage }))[1];
      const tier = hitTier(damage);
      expect(line.startsWith("It's super effective!")).toBe(tier === 'super');
      expect(line.startsWith("It's not very effective…")).toBe(tier === 'glancing');
      expect(line === 'But it missed!').toBe(tier === 'miss');
      expect(line === `−${damage}`).toBe(tier === 'solid');
    }
  });

  it('adds a recovery line naming the healer', () => {
    expect(battleLines(hit({ by: 'bot', recovery: 8 })).at(-1)).toBe('THE HOUSE shook off the last hit!  +8');
    expect(battleLines(hit({ recovery: 0 })).some((l) => l.includes('shook off'))).toBe(false);
  });
});

describe('names and banners', () => {
  it('maps sides and winners to the spec copy', () => {
    expect(speakerName('user')).toBe('YOU');
    expect(speakerName('bot')).toBe('THE HOUSE');
    expect(decisionBanner('user')).toBe('YOU WIN');
    expect(decisionBanner('bot')).toBe('YOU LOSE');
    expect(decisionBanner('draw')).toBe('DRAW GAME');
  });
});
