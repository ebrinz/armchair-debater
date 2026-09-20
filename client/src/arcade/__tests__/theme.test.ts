import { describe, expect, it } from 'vitest';

import cardsFixture from '../fixtures/theory-cards.json';
import { shortName, typeOf } from '../theme';
import type { TheoryCard } from '../types';

const cards = cardsFixture.cards as TheoryCard[];
const card = (id: string) => cards.find((c) => c.id === id)!;

describe('typeOf', () => {
  it('labels with the last category segment and colours by the first', () => {
    expect(typeOf(card('gwt'))).toEqual({ label: 'Global workspace', colorVar: '--type-materialism' });
    expect(typeOf(card('iit')).colorVar).toBe('--type-information');
    expect(typeOf(card('orch_or')).colorVar).toBe('--type-quantum');
    expect(typeOf(card('panpsychism')).colorVar).toBe('--type-panpsychism');
    expect(typeOf(card('property_dualism')).colorVar).toBe('--type-dualism');
    expect(typeOf(card('analytic_idealism')).colorVar).toBe('--type-idealism');
  });
  it('falls back to a neutral colour for an unknown category', () => {
    expect(typeOf({ ...card('gwt'), kuhn_category: 'Something New' }).colorVar).toBe('--type-neutral');
  });
  it('gives every real card a type', () => {
    for (const c of cards) expect(typeOf(c).label.length).toBeGreaterThan(0);
  });
});

describe('shortName', () => {
  it('has a short grid name of at most 6 characters for all twelve cards', () => {
    for (const c of cards) {
      expect(shortName(c.id).length).toBeLessThanOrEqual(6);
      expect(shortName(c.id)).toBe(shortName(c.id).toUpperCase());
    }
  });
  it('falls back to the upper-cased id for an unknown card', () => {
    expect(shortName('brand_new')).toBe('BRAND_');
  });
});
