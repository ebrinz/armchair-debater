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

/**
 * The announcer's banners for each stage, in the spec's words, with how long
 * each one holds. Stages that get no banner are absent.
 */
export const ANNOUNCER_SEQUENCE: Partial<Record<Stage, Array<[text: string, ms: number]>>> = {
  opening: [
    ['ROUND 1', 900],
    ['FIGHT!', 700],
  ],
  rebuttal: [['ROUND 2', 900]],
  closing: [['FINAL ROUND', 900]],
};

/** The same words the banners show, for the one shared live region. */
export const announcerText = (stage: Stage): string =>
  (ANNOUNCER_SEQUENCE[stage] ?? []).map(([text]) => text).join('. ');
