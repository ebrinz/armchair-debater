import { describe, expect, it } from 'vitest';

import cardsFixture from '../fixtures/theory-cards.json';
import { moveAmong, pickLine, rivalIndices } from '../selection';
import type { TheoryCard } from '../types';

const cards = (cardsFixture as { cards: TheoryCard[] }).cards;
const byId = (id: string) => cards.find((c) => c.id === id)!;

describe('pickLine', () => {
  it('states the view alone when the house is left to choose', () => {
    expect(pickLine(byId('gwt'), null)).toBe('My view is Global Workspace Theory.');
  });
  it('names the theory the house must defend', () => {
    expect(pickLine(byId('gwt'), byId('rpt'))).toBe(
      'My view is Global Workspace Theory, and I want you to defend Recurrent Processing Theory against it.'
    );
  });
});

describe('rivalIndices', () => {
  it('lists the roster slots of the chosen theory’s rivals, in roster order', () => {
    const gwt = byId('gwt');
    const indices = rivalIndices(gwt, cards);
    expect(indices.map((i) => cards[i].id).sort()).toEqual([...gwt.rivals].sort());
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(indices).not.toContain(cards.indexOf(gwt));
  });
  it('ignores a rival id that is not on the roster', () => {
    const odd = { ...byId('gwt'), rivals: ['iit', 'not_a_card'] };
    expect(rivalIndices(odd, cards).map((i) => cards[i].id)).toEqual(['iit']);
  });
});

describe('moveAmong', () => {
  const enabled = [1, 3, 7];

  it('steps to the next and previous enabled slot and stops at the ends', () => {
    expect(moveAmong(1, 'ArrowDown', enabled)).toBe(3);
    expect(moveAmong(3, 'ArrowDown', enabled)).toBe(7);
    expect(moveAmong(7, 'ArrowDown', enabled)).toBe(7);
    expect(moveAmong(3, 'ArrowUp', enabled)).toBe(1);
    expect(moveAmong(1, 'ArrowUp', enabled)).toBe(1);
  });
  it('treats left and right like up and down in a single column', () => {
    expect(moveAmong(1, 'ArrowRight', enabled)).toBe(3);
    expect(moveAmong(3, 'ArrowLeft', enabled)).toBe(1);
  });
  it('jumps to the ends with Home and End', () => {
    expect(moveAmong(3, 'Home', enabled)).toBe(1);
    expect(moveAmong(3, 'End', enabled)).toBe(7);
  });
  it('enters the enabled set from a slot outside it', () => {
    expect(moveAmong(5, 'ArrowDown', enabled)).toBe(7);
    expect(moveAmong(5, 'ArrowUp', enabled)).toBe(3);
    expect(moveAmong(0, 'ArrowUp', enabled)).toBe(1);
  });
  it('stays put when nothing is enabled', () => {
    expect(moveAmong(4, 'ArrowDown', [])).toBe(4);
  });
});
