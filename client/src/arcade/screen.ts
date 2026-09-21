import type { DebateSnapshot, Stage } from './types';

export type Screen = 'title' | 'select' | 'versus' | 'fight' | 'decision';

/** Which screen to show. A pure function of the server's state, so the UI cannot drift from it. */
export const screenFor = (connected: boolean, snapshot: DebateSnapshot | null): Screen => {
  if (!connected) return 'title';
  if (!snapshot) return 'select';
  // The lock-in: both sides matched to a theory, the first round not yet begun.
  if (snapshot.stage === 'setup') return splashKey(snapshot) ? 'versus' : 'select';
  return snapshot.stage === 'verdict' ? 'decision' : 'fight';
};

/**
 * The pairing a versus splash would introduce, or null when there is none to
 * show: only at the start of a debate — matched, and no blow landed yet — so a
 * page reloaded mid-fight goes straight back to the fight.
 */
export const splashKey = (snapshot: DebateSnapshot | null): string | null => {
  if (!snapshot || snapshot.last_hit) return null;
  if (snapshot.stage !== 'setup' && snapshot.stage !== 'opening') return null;
  const { user, bot } = snapshot;
  return user.theory_id && bot.theory_id ? `${user.theory_id}|${bot.theory_id}` : null;
};

/** How long the splash stays up once a pairing appears. */
export const VERSUS_MS = 2600;

/**
 * The one piece of the splash the server's state cannot give: time. Live, the
 * lock-in snapshot and the `opening` one arrive milliseconds apart, so the
 * splash is held on screen — `holding` — while the bot is still composing its
 * opening anyway. `seen` is the last key noticed, so a pairing starts the hold
 * once: a repeat of the same snapshot does not restart it, and a rematch, which
 * passes through an unmatched setup first, does.
 *
 * Pure, and the SAME object back when nothing changed, because the view applies
 * it during render (see `nextSpoken` for why that shape matters). Ending the
 * hold is the view's timer's job.
 */
export interface SplashState {
  seen: string | null;
  holding: string | null;
}

export const nextSplash = (state: SplashState, key: string | null): SplashState =>
  key === state.seen ? state : { seen: key, holding: key ?? state.holding };

export const ROUND_LABELS: Record<Stage, string> = {
  setup: 'CHOOSE YOUR THEORY',
  opening: 'ROUND 1 · OPENING',
  rebuttal: 'ROUND 2 · REBUTTAL',
  crossexam: 'ROUND 3 · CROSS-EXAMINATION',
  closing: 'FINAL ROUND · CLOSING',
  verdict: "JUDGE'S DECISION",
};

/** How many rounds a debate has: the pips on the round plate. */
export const ROUNDS = 4;

export const roundNumber = (stage: Stage): number =>
  ({ setup: 0, opening: 1, rebuttal: 2, crossexam: 3, closing: ROUNDS, verdict: ROUNDS })[stage];

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
  crossexam: [
    ['ROUND 3', 900],
    ['CROSS-EXAMINE!', 800],
  ],
  closing: [['FINAL ROUND', 900]],
};

/** The same words the banners show, for the one shared live region. */
export const announcerText = (stage: Stage): string =>
  (ANNOUNCER_SEQUENCE[stage] ?? []).map(([text]) => text).join('. ');
