import { describe, expect, it } from 'vitest';

import { RECIPES, SFX_NAMES, recipeMs, sfxForHit, sfxForVerdict } from '../sfx';

describe('sound recipes', () => {
  it('has a recipe for every sound the UI can ask for', () => {
    for (const name of SFX_NAMES) expect(RECIPES[name].length).toBeGreaterThan(0);
  });

  it('keeps every tone audible, quiet enough to talk over, and in a chiptune register', () => {
    for (const name of SFX_NAMES) {
      for (const tone of RECIPES[name]) {
        expect(tone.ms, name).toBeGreaterThan(0);
        expect(tone.at, name).toBeGreaterThanOrEqual(0);
        expect(tone.gain, name).toBeGreaterThan(0);
        // The mic is open and the bot is speaking through the same speakers.
        expect(tone.gain, name).toBeLessThanOrEqual(0.3);
        if (tone.wave !== 'noise') {
          for (const hz of [tone.from, tone.to ?? tone.from]) {
            expect(hz, name).toBeGreaterThanOrEqual(55);
            expect(hz, name).toBeLessThanOrEqual(3520);
          }
        }
      }
    }
  });

  it('keeps effects short: a cue, never a tune', () => {
    for (const name of SFX_NAMES) expect(recipeMs(name), name).toBeLessThanOrEqual(1400);
    // The ones that fire constantly are the shortest.
    expect(recipeMs('cursor')).toBeLessThanOrEqual(60);
    expect(recipeMs('tick')).toBeLessThanOrEqual(90);
  });
});

describe('choosing a sound', () => {
  it('scales the hit sound with the tier', () => {
    expect(sfxForHit('miss')).toBe('miss');
    expect(sfxForHit('glancing')).toBe('hitGlancing');
    expect(sfxForHit('solid')).toBe('hitSolid');
    expect(sfxForHit('super')).toBe('hitSuper');
    expect(recipeMs('hitSuper')).toBeGreaterThan(recipeMs('hitSolid'));
    expect(recipeMs('hitSolid')).toBeGreaterThan(recipeMs('hitGlancing'));
  });

  it('plays the verdict from the player’s side of it', () => {
    expect(sfxForVerdict('user')).toBe('win');
    expect(sfxForVerdict('bot')).toBe('lose');
    expect(sfxForVerdict('draw')).toBe('draw');
  });
});
