import { ROUND_LABELS, announcerText } from './screen';
import type { DebateSnapshot, Hit, Side, Stage } from './types';

export const speakerName = (side: Side): 'YOU' | 'THE HOUSE' => (side === 'user' ? 'YOU' : 'THE HOUSE');

/** How hard a hit landed. `damage` is the server's applied value, 0–50. */
export type HitTier = 'miss' | 'glancing' | 'solid' | 'super';

/**
 * The one place the damage thresholds live. The battle text and every hit
 * effect read them from here, so the words and the feel can never disagree.
 * Spec: docs/design/2026-09-19-debate-ui-design.md, "Hit feel: scaled to the damage".
 */
export const hitTier = (damage: number): HitTier => {
  if (damage <= 0) return 'miss';
  if (damage <= 10) return 'glancing';
  if (damage <= 29) return 'solid';
  return 'super';
};

/** The effectiveness line, one per tier. Unicode minus (U+2212), two spaces. */
const EFFECTIVENESS: Record<HitTier, (damage: number) => string> = {
  miss: () => 'But it missed!',
  glancing: (damage) => `It's not very effective…  −${damage}`,
  solid: (damage) => `−${damage}`,
  super: (damage) => `It's super effective!  −${damage}`,
};

/** The lines the battle text box types out for one hit. */
export const battleLines = (hit: Hit): string[] => {
  const who = speakerName(hit.by);
  const lines = [`${who} used "${hit.reason}"`, EFFECTIVENESS[hitTier(hit.damage)](hit.damage)];
  if (hit.recovery > 0) lines.push(`${who} shook off the last hit!  +${hit.recovery}`);
  return lines;
};

/**
 * The end-of-match banners, from the Style guide's rule table ("The finish"),
 * checked in its order: a double K.O. beats everything, then a draw, then a
 * flourish — `K.O.!` for a bar at zero, `PERFECT!` for a winner never touched —
 * over the result. The last entry is always the result itself, so the screen
 * can set the flourish above it in a different size.
 *
 * A snapshot with no verdict is not a row of the table: it returns nothing, and
 * the screen shows `JUDGE'S DECISION` alone.
 */
export const decisionBanners = (snapshot: DebateSnapshot): string[] => {
  const { user, bot, verdict } = snapshot;
  if (user.health <= 0 && bot.health <= 0) return ['DOUBLE K.O.'];
  if (!verdict) return [];
  if (verdict.winner === 'draw') return ['DRAW GAME'];

  const won = verdict.winner === 'user';
  const result = won ? 'YOU WIN' : 'YOU LOSE';
  const winner = won ? user : bot;
  const loser = won ? bot : user;

  if (loser.health <= 0) return ['K.O.!', result];
  if (winner.health >= 100) return ['PERFECT!', result];
  return [result];
};

/** What the fight screen's live region last said, so the next snapshot knows
 * what's already been announced. */
export interface Announced {
  stage: Stage;
  hitCount: number;
}

/**
 * The fight screen's live-region text for an incoming snapshot, given what
 * was last announced. The round banner ("ROUND 1. ROUND 1 · OPENING") reads
 * once, on the stage that introduces it; a hit that lands within the same
 * stage announces only its own lines, so a screen reader doesn't hear the
 * banner replayed on every hit. An unchanged stage and hit count — a repeat
 * of the same snapshot — has nothing new to say, and returns ''.
 */
export const fightAnnouncement = (
  previous: Announced | null,
  snapshot: DebateSnapshot,
  hitCount: number
): string => {
  const lines: string[] = [];
  if (!previous || snapshot.stage !== previous.stage) {
    lines.push(announcerText(snapshot.stage), ROUND_LABELS[snapshot.stage]);
  }
  if (snapshot.last_hit && hitCount !== previous?.hitCount) {
    lines.push(...battleLines(snapshot.last_hit));
  }
  return lines.filter(Boolean).join('. ');
};
