import { describe, expect, it } from 'vitest';

import { battleLines, decisionBanners, fightAnnouncement, hitTier, speakerName } from '../battleText';
import states from '../fixtures/debate-state.json';
import { ROUND_LABELS, announcerText } from '../screen';
import type { DebateSnapshot, Hit, Verdict } from '../types';

const hit = (over: Partial<Hit>): Hit => ({ by: 'user', damage: 10, recovery: 0, reason: 'Made a point.', ...over });

const snapshot = (stage: DebateSnapshot['stage'], last_hit: Hit | null): DebateSnapshot => ({
  type: 'debate_state',
  stage,
  user: { theory_id: 't1', theory_name: 'Theory', health: 80 },
  bot: { theory_id: 't2', theory_name: 'Theory', health: 80 },
  last_hit,
  verdict: null,
});

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

describe('fightAnnouncement', () => {
  it('reads the round banner once on a stage change with no hit', () => {
    const previous = { stage: 'opening' as const, hitCount: 0 };
    expect(fightAnnouncement(previous, snapshot('rebuttal', null), 0)).toBe(
      `${announcerText('rebuttal')}. ${ROUND_LABELS.rebuttal}`
    );
  });

  it('reads only the hit lines for a hit within the same stage', () => {
    const previous = { stage: 'opening' as const, hitCount: 1 };
    const landed = hit({ damage: 24 });
    expect(fightAnnouncement(previous, snapshot('opening', landed), 2)).toEqual(battleLines(landed).join('. '));
  });

  it('reads the banner and the hit lines when a stage change arrives with a hit', () => {
    const previous = { stage: 'opening' as const, hitCount: 1 };
    const landed = hit({ damage: 24 });
    expect(fightAnnouncement(previous, snapshot('rebuttal', landed), 2)).toBe(
      [announcerText('rebuttal'), ROUND_LABELS.rebuttal, ...battleLines(landed)].join('. ')
    );
  });

  it('has nothing new to say for an identical repeated snapshot', () => {
    const previous = { stage: 'opening' as const, hitCount: 1 };
    const landed = hit({ damage: 24 });
    expect(fightAnnouncement(previous, snapshot('opening', landed), 1)).toBe('');
  });
});

describe('names and banners', () => {
  it('maps sides to the spec copy', () => {
    expect(speakerName('user')).toBe('YOU');
    expect(speakerName('bot')).toBe('THE HOUSE');
  });
});

describe('decisionBanners', () => {
  /** A finished debate: health either side, and who the judge gave it to. */
  const finished = (user: number, bot: number, winner: Verdict['winner'] | null): DebateSnapshot => ({
    type: 'debate_state',
    stage: 'verdict',
    user: { theory_id: 't1', theory_name: 'Theory', health: user },
    bot: { theory_id: 't2', theory_name: 'Theory', health: bot },
    last_hit: null,
    verdict: winner ? { winner, rationale: 'Because.' } : null,
  });

  // The Style guide's rule table, one case per row, checked in its order.
  it('calls both bars at zero a double K.O., whoever the judge named', () => {
    expect(decisionBanners(finished(0, 0, 'user'))).toEqual(['DOUBLE K.O.']);
  });

  it('calls a draw a draw game', () => {
    expect(decisionBanners(finished(40, 40, 'draw'))).toEqual(['DRAW GAME']);
  });

  it('calls a loser at zero a K.O., with the result beneath', () => {
    expect(decisionBanners(finished(30, 0, 'user'))).toEqual(['K.O.!', 'YOU WIN']);
    expect(decisionBanners(finished(0, 30, 'bot'))).toEqual(['K.O.!', 'YOU LOSE']);
  });

  it('calls an untouched winner perfect, with the result beneath', () => {
    expect(decisionBanners(finished(100, 22, 'user'))).toEqual(['PERFECT!', 'YOU WIN']);
    expect(decisionBanners(finished(22, 100, 'bot'))).toEqual(['PERFECT!', 'YOU LOSE']);
  });

  it('otherwise shows the result alone', () => {
    expect(decisionBanners(finished(49, 15, 'user'))).toEqual(['YOU WIN']);
    expect(decisionBanners(finished(15, 49, 'bot'))).toEqual(['YOU LOSE']);
  });

  it('has no banner without a verdict — the screen shows the title alone', () => {
    expect(decisionBanners(finished(49, 15, null))).toEqual([]);
  });

  it('has no banner without a verdict even when both bars are empty', () => {
    expect(decisionBanners(finished(0, 0, null))).toEqual([]);
  });
  it('calls a draw a draw game even with one bar at zero', () => {
    expect(decisionBanners(finished(0, 4, 'draw'))).toEqual(['DRAW GAME']);
  });
  it('reads the contract fixture’s final snapshot as YOU WIN', () => {
    const final = (states as DebateSnapshot[]).at(-1) as DebateSnapshot;
    expect(final.stage).toBe('verdict');
    expect(final.user.health).toBe(49);
    expect(final.bot.health).toBe(15);
    expect(decisionBanners(final)).toEqual(['YOU WIN']);
  });
});
