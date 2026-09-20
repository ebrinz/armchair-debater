import { describe, expect, it } from 'vitest';

import fixtures from '../fixtures/debate-state.json';
import { ROUND_LABELS, roundNumber, screenFor } from '../screen';
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
  it('stays on select for the lock-in: theories set while still in setup', () => {
    const lockIn = snapshots.find((s) => s.stage === 'setup' && s.user.theory_id)!;
    expect(lockIn.bot.theory_id).toBeTruthy();
    expect(screenFor(true, lockIn)).toBe('select');
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
