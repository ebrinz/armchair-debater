import type { DebateSnapshot, Stage } from './types';

export type Screen = 'title' | 'select' | 'fight' | 'decision';

/** Which screen to show. A pure function of the server's state, so the UI cannot drift from it. */
export const screenFor = (connected: boolean, snapshot: DebateSnapshot | null): Screen => {
  if (!connected) return 'title';
  if (!snapshot || snapshot.stage === 'setup') return 'select';
  return snapshot.stage === 'verdict' ? 'decision' : 'fight';
};

export const ROUND_LABELS: Record<Stage, string> = {
  setup: 'CHOOSE YOUR THEORY',
  opening: 'ROUND 1 · OPENING',
  rebuttal: 'ROUND 2 · REBUTTAL',
  closing: 'FINAL ROUND · CLOSING',
  verdict: "JUDGE'S DECISION",
};

export const roundNumber = (stage: Stage): 0 | 1 | 2 | 3 =>
  ({ setup: 0, opening: 1, rebuttal: 2, closing: 3, verdict: 3 })[stage] as 0 | 1 | 2 | 3;
