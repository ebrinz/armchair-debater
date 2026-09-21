/**
 * The arcade's sound effects, as data: each one is a handful of tones for a
 * square, triangle or sawtooth oscillator (or a burst of noise), synthesized in
 * the browser. There are no audio files, so nothing to license and nothing to
 * load. `sfxPlayer.ts` turns a recipe into Web Audio; everything here is pure,
 * which is what lets the rules below be tested.
 *
 * Everything is short and quiet on purpose. The microphone is open and the bot
 * speaks through the same speakers, so these are cues under a conversation, not
 * a soundtrack over it.
 */

import type { HitTier } from './battleText';
import type { Verdict } from './types';

export interface Tone {
  wave: 'square' | 'triangle' | 'sawtooth' | 'noise';
  /** Pitch in Hz; ignored for noise. */
  from: number;
  /** Slides to this pitch over the tone's length, when given. */
  to?: number;
  /** Start, in ms from the beginning of the effect. */
  at: number;
  ms: number;
  /** Peak gain, 0..1, before the player's own master volume. */
  gain: number;
}

export const SFX_NAMES = [
  'cursor',
  'pick',
  'back',
  'versus',
  'round',
  'miss',
  'hitGlancing',
  'hitSolid',
  'hitSuper',
  'heal',
  'win',
  'lose',
  'draw',
  'tick',
  'gameOver',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

const note = (wave: Tone['wave'], from: number, at: number, ms: number, gain = 0.2, to?: number): Tone => ({
  wave,
  from,
  to,
  at,
  ms,
  gain,
});

// Equal-tempered pitches, named so the recipes read as music rather than numbers.
const C4 = 262;
const E4 = 330;
const G4 = 392;
const A4 = 440;
const C5 = 523;
const E5 = 659;
const G5 = 784;
const C6 = 1047;

export const RECIPES: Record<SfxName, Tone[]> = {
  cursor: [note('square', C5 * 2, 0, 40, 0.1)],
  pick: [note('square', C5, 0, 70), note('square', G5, 70, 110)],
  back: [note('square', G4, 0, 60, 0.16), note('square', C4, 60, 90, 0.16)],
  // Two halves slide in, then the slam.
  versus: [
    note('sawtooth', 110, 0, 320, 0.16, 330),
    note('noise', 0, 380, 160, 0.26),
    note('square', 131, 380, 300, 0.24, 65),
  ],
  round: [note('square', G4, 0, 110), note('square', C5, 120, 110), note('square', G5, 240, 260)],
  miss: [note('triangle', 700, 0, 120, 0.12, 300)],
  hitGlancing: [note('square', 220, 0, 70, 0.18, 150), note('noise', 0, 0, 50, 0.12)],
  hitSolid: [note('square', 196, 0, 130, 0.24, 98), note('noise', 0, 0, 90, 0.2)],
  // Hit-stop first — a beat of nothing — then the blow and a falling tail.
  hitSuper: [
    note('noise', 0, 70, 180, 0.3),
    note('square', 392, 70, 120, 0.26, 131),
    note('sawtooth', 262, 190, 300, 0.2, 55),
  ],
  heal: [note('triangle', C5, 0, 80, 0.16), note('triangle', E5, 80, 80, 0.16), note('triangle', G5, 160, 160, 0.16)],
  win: [
    note('square', C5, 0, 120),
    note('square', E5, 120, 120),
    note('square', G5, 240, 120),
    note('square', C6, 360, 420),
    note('triangle', C4, 360, 420, 0.18),
  ],
  lose: [
    note('square', A4, 0, 200, 0.18),
    note('square', G4, 200, 200, 0.18),
    note('square', E4, 400, 200, 0.18),
    note('sawtooth', C4, 600, 600, 0.16, 110),
  ],
  draw: [note('square', G4, 0, 160, 0.18), note('square', G4, 200, 160, 0.18), note('square', E4, 400, 360, 0.18)],
  tick: [note('square', A4 * 2, 0, 50, 0.12)],
  gameOver: [
    note('square', C5, 0, 220, 0.18),
    note('square', G4, 240, 220, 0.18),
    note('square', E4, 480, 220, 0.18),
    note('square', C4, 720, 560, 0.18),
  ],
};

/** How long an effect lasts, start to the end of its last tone. */
export const recipeMs = (name: SfxName): number =>
  Math.max(...RECIPES[name].map((tone) => tone.at + tone.ms));

export const sfxForHit = (tier: HitTier): SfxName =>
  ({ miss: 'miss', glancing: 'hitGlancing', solid: 'hitSolid', super: 'hitSuper' })[tier] as SfxName;

/** The verdict is heard from the player's side: their win is the fanfare. */
export const sfxForVerdict = (winner: Verdict['winner']): SfxName =>
  winner === 'user' ? 'win' : winner === 'bot' ? 'lose' : 'draw';
