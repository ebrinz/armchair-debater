import { describe, expect, it } from 'vitest';

import { battleLines, decisionBanner, speakerName } from '../battleText';
import type { Hit } from '../types';

const hit = (over: Partial<Hit>): Hit => ({ by: 'user', damage: 10, recovery: 0, reason: 'Made a point.', ...over });

describe('battleLines', () => {
  it('names the speaker and quotes the reason', () => {
    expect(battleLines(hit({}))[0]).toBe('YOU used "Made a point."');
    expect(battleLines(hit({ by: 'bot' }))[0]).toBe('THE HOUSE used "Made a point."');
  });
  it('adds no effectiveness line for a middling hit', () => {
    expect(battleLines(hit({ damage: 10 }))).toEqual(['YOU used "Made a point."', '−10']);
  });
  it.each([
    [15, "It's super effective!  −15"],
    [25, "It's super effective!  −25"],
    [5, "It's not very effective…  −5"],
    [1, "It's not very effective…  −1"],
    [0, 'But it missed!'],
  ])('damage %i reads %s', (damage, line) => {
    expect(battleLines(hit({ damage }))[1]).toBe(line);
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
