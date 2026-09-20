import type { Hit, Side, Verdict } from './types';

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

export const decisionBanner = (winner: Verdict['winner']): 'YOU WIN' | 'YOU LOSE' | 'DRAW GAME' =>
  winner === 'user' ? 'YOU WIN' : winner === 'bot' ? 'YOU LOSE' : 'DRAW GAME';
