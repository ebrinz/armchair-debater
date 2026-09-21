import { describe, expect, it } from 'vitest';

import fixtures from '../fixtures/debate-state.json';
import { ROUND_LABELS, nextSplash, roundNumber, screenFor, splashKey } from '../screen';
import type { DebateSnapshot } from '../types';

const snapshots = fixtures as DebateSnapshot[];
const at = (stage: string) => snapshots.find((s) => s.stage === stage)!;

describe('screenFor', () => {
  it('is the title screen whenever disconnected, whatever the snapshot', () => {
    expect(screenFor(false, null)).toBe('title');
    expect(screenFor(false, at('closing'))).toBe('title');
  });
  it('is select when connected with no snapshot yet, or in setup', () => {
    expect(screenFor(true, null)).toBe('select');
    expect(screenFor(true, at('setup'))).toBe('select');
  });
  it('is the versus splash for the lock-in: both theories set while still in setup', () => {
    const lockIn = snapshots.find((s) => s.stage === 'setup' && s.user.theory_id)!;
    expect(lockIn.bot.theory_id).toBeTruthy();
    expect(screenFor(true, lockIn)).toBe('versus');
    expect(screenFor(false, lockIn)).toBe('title');
  });
  it('is fight in every debate round', () => {
    for (const stage of ['opening', 'rebuttal', 'closing']) {
      expect(screenFor(true, at(stage))).toBe('fight');
    }
  });
  it('is decision at the verdict', () => {
    expect(screenFor(true, at('verdict'))).toBe('decision');
  });
});

describe('round labels', () => {
  it('uses the spec copy', () => {
    expect(ROUND_LABELS.opening).toBe('ROUND 1 · OPENING');
    expect(ROUND_LABELS.rebuttal).toBe('ROUND 2 · REBUTTAL');
    expect(ROUND_LABELS.closing).toBe('FINAL ROUND · CLOSING');
  });
  it('numbers the rounds', () => {
    expect([roundNumber('setup'), roundNumber('opening'), roundNumber('rebuttal'), roundNumber('closing'), roundNumber('verdict')]).toEqual([0, 1, 2, 3, 3]);
  });
});

describe('the versus splash', () => {
  const lockIn = snapshots.find((s) => s.stage === 'setup' && s.user.theory_id)!;
  const opening = snapshots.find((s) => s.stage === 'opening' && !s.last_hit)!;
  const firstHit = snapshots.find((s) => s.last_hit)!;

  it('is keyed by the pairing, at the start of a debate only', () => {
    expect(splashKey(null)).toBeNull();
    expect(splashKey(snapshots[0])).toBeNull(); // nobody matched yet
    expect(splashKey(lockIn)).toBe('gwt|iit');
    // Live, `opening` lands milliseconds after the lock-in: same splash.
    expect(splashKey(opening)).toBe('gwt|iit');
    // A page reloaded mid-fight, or the verdict, gets no splash.
    expect(splashKey(firstHit)).toBeNull();
    expect(splashKey(snapshots.at(-1)!)).toBeNull();
  });

  it('starts holding when a pairing appears and leaves the hold to the timer', () => {
    const idle = { seen: null, holding: null };
    const started = nextSplash(idle, 'gwt|iit');
    expect(started).toEqual({ seen: 'gwt|iit', holding: 'gwt|iit' });
    // The same key again changes nothing — the same object, so no re-render loop.
    expect(nextSplash(started, 'gwt|iit')).toBe(started);
    // The first hit clears the key; the hold is the timer's to end, not this.
    expect(nextSplash(started, null)).toEqual({ seen: null, holding: 'gwt|iit' });
  });

  it('does not restart once the timer has ended it, but a rematch splashes again', () => {
    const ended = { seen: 'gwt|iit', holding: null };
    expect(nextSplash(ended, 'gwt|iit')).toBe(ended);
    const afterRematch = nextSplash(nextSplash(ended, null), 'gwt|iit');
    expect(afterRematch.holding).toBe('gwt|iit');
  });
});
