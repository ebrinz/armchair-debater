import { ROUND_LABELS, announcerText } from './screen';
import type { DebateSnapshot, Hit, Mode, Side, Stage } from './types';

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

/**
 * How hard a hit should FEEL — the damage the shake, flash and sound are tiered
 * on. Sparring scores at half the debate's scale (one bar, five questions), so
 * it is felt at double: the worst answer shakes the room like the hardest blow.
 */
export const feltDamage = (hit: Hit, mode: Mode | null): number =>
  mode === 'sparring' ? hit.damage * 2 : hit.damage;

/** Sparring's damage, worded from the side that is defending. */
const HELD: Record<HitTier, (damage: number) => string> = {
  miss: () => 'Answered in full!',
  glancing: (damage) => `A scratch…  −${damage}`,
  solid: (damage) => `That one landed.  −${damage}`,
  super: (damage) => `A hole in the view!  −${damage}`,
};

/** The lines the battle text box types out for one hit. */
export const battleLines = (hit: Hit, mode: Mode | null = null): string[] => {
  // Sparring records each scored ANSWER as a hit by the examiner: the reason
  // names the question and what the answer did with it, the damage is what the
  // player lost, and the recovery is what the PLAYER won back.
  if (mode === 'sparring') {
    const lines = [`THE EXAMINER: "${hit.reason}"`, HELD[hitTier(feltDamage(hit, mode))](hit.damage)];
    if (hit.recovery > 0) lines.push(`YOU won some back!  +${hit.recovery}`);
    return lines;
  }
  const who = speakerName(hit.by);
  const lines = [`${who} used "${hit.reason}"`, EFFECTIVENESS[hitTier(hit.damage)](hit.damage)];
  if (hit.recovery > 0) lines.push(`${who} shook off the last hit!  +${hit.recovery}`);
  return lines;
};

/**
 * Whose turn it is, derived only from the snapshot: the house opens, and after
 * that each hit hands the floor to the other side. Nothing here guesses at
 * state the server does not send — there is no "thinking…", because the
 * contract cannot tell us that.
 *
 * Flips on `last_hit.by` alone, so it relies on the server strictly alternating
 * scored turns (bot, user, bot, …). Cross-examination opens with two turns that
 * are not scored — the house's invitation and the player's question — so there
 * the last hit is still the player's rebuttal, and the cue says what the round
 * wants from them rather than naming the house.
 */
export const turnCue = (hit: Hit | null, stage: Stage): string => {
  // The examiner only asks, so once a question is out the floor is the player's.
  if (stage === 'sparring') return 'ANSWER THE EXAMINER';
  if (!hit) return stage === 'opening' ? 'THE HOUSE steps up…' : 'YOUR MOVE';
  if (stage === 'crossexam') {
    return hit.by === 'user' ? 'ASK THE HOUSE ONE QUESTION' : 'ANSWER THE HOUSE';
  }
  return hit.by === 'bot' ? 'YOUR MOVE' : 'THE HOUSE steps up…';
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
  if (!verdict) return [];
  // Sparring has one bar and no opponent: the finding is how much of it is left.
  if (snapshot.mode === 'sparring') {
    return [user.health >= 70 ? 'YOUR VIEW HOLDS' : user.health >= 40 ? 'SHAKEN' : 'IN TATTERS'];
  }
  if (user.health <= 0 && bot.health <= 0) return ['DOUBLE K.O.'];
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

/** The fight screen's live-region state: what was last announced, and the
 * words that went with it. */
export interface Spoken {
  announced: Announced | null;
  text: string;
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

/**
 * Advances the fight screen's live-region state by one snapshot. Returns the
 * SAME `spoken` object, not a new one with identical fields, when the stage
 * and hit count have not moved since the last call — so a caller that does
 * this from inside a render (`setSpoken(nextSpoken(spoken, snapshot,
 * hitCount))`) gets React's Object.is bail-out for free instead of deriving
 * the text itself afterwards.
 *
 * That "afterwards" is exactly the regression this guards against: an
 * earlier version updated `announced` during render and then computed the
 * text from `announced` on the next line, comparing it against the value it
 * had just written — so previous and current always matched, and the live
 * region read '' for the whole fight even though every pure-function test of
 * `fightAnnouncement` passed. Computing the text here, before `announced` is
 * replaced, is what keeps that comparison honest.
 */
export const nextSpoken = (
  spoken: Spoken,
  snapshot: DebateSnapshot | null,
  hitCount: number
): Spoken => {
  const announced: Announced | null = snapshot ? { stage: snapshot.stage, hitCount } : null;
  if (announced?.stage === spoken.announced?.stage && announced?.hitCount === spoken.announced?.hitCount) {
    return spoken;
  }
  return { announced, text: snapshot ? fightAnnouncement(spoken.announced, snapshot, hitCount) : '' };
};
