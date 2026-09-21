import { describe, expect, it } from 'vitest';

import { EMBLEMS, EMBLEM_COLS, EMBLEM_ROWS, emblemRects } from '../emblems';
import cardsFixture from '../fixtures/theory-cards.json';

const ids = (cardsFixture as { cards: { id: string }[] }).cards.map((c) => c.id);

describe('theory emblems', () => {
  it('has one for every card in the deck, and no strays', () => {
    expect(Object.keys(EMBLEMS).sort()).toEqual([...ids].sort());
  });

  it('draws each on the same small grid, in two symbols', () => {
    for (const id of ids) {
      expect(EMBLEMS[id], id).toHaveLength(EMBLEM_ROWS);
      for (const row of EMBLEMS[id]) expect(row, id).toMatch(new RegExp(`^[#.]{${EMBLEM_COLS}}$`));
    }
  });

  it('gives every theory a different one, with enough ink to read', () => {
    const drawn = ids.map((id) => EMBLEMS[id].join('\n'));
    expect(new Set(drawn).size).toBe(ids.length);
    for (const id of ids) {
      const ink = EMBLEMS[id].join('').split('#').length - 1;
      expect(ink, id).toBeGreaterThanOrEqual(7);
    }
  });

  it('turns an emblem into one sprite pixel per mark, placed on the headrest', () => {
    const rects = emblemRects('iit', 13, 7);
    const ink = EMBLEMS.iit.join('').split('#').length - 1;
    expect(rects).toHaveLength(ink);
    for (const [x, y, w, h] of rects) {
      expect([w, h]).toEqual([1, 1]);
      expect(x).toBeGreaterThanOrEqual(13);
      expect(x).toBeLessThan(13 + EMBLEM_COLS);
      expect(y).toBeGreaterThanOrEqual(7);
      expect(y).toBeLessThan(7 + EMBLEM_ROWS);
    }
  });

  it('can be drawn flipped, for the house’s chair, which is itself drawn mirrored', () => {
    // Illusionism's question mark must not come out backwards on the right-hand chair.
    const plain = emblemRects('illusionism', 0, 0);
    const flipped = emblemRects('illusionism', 0, 0, true);
    expect(flipped).toHaveLength(plain.length);
    expect(flipped.map(([x, y]) => [EMBLEM_COLS - 1 - x, y]).sort()).toEqual(
      plain.map(([x, y]) => [x, y]).sort()
    );
    expect(flipped).not.toEqual(plain);
  });

  it('draws nothing for a theory it does not know', () => {
    expect(emblemRects('not_a_card', 13, 7)).toEqual([]);
    expect(emblemRects(null, 13, 7)).toEqual([]);
  });
});
