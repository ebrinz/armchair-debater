import { beforeEach, describe, expect, it } from 'vitest';

import cardsFixture from '../fixtures/theory-cards.json';
import fixtures from '../fixtures/debate-state.json';
import { useArcadeStore } from '../store';

const store = () => useArcadeStore.getState();

describe('useArcadeStore.receive', () => {
  beforeEach(() => store().clear());

  it('stores cards and snapshots and ignores everything else', () => {
    store().receive({ type: 'something_else' });
    store().receive(null);
    store().receive('text');
    expect(store().snapshot).toBeNull();
    store().receive(cardsFixture);
    store().receive(fixtures[0]);
    expect(store().cards).toHaveLength(12);
    expect(store().snapshot?.stage).toBe('setup');
  });

  it('counts a hit once, however many snapshots repeat it', () => {
    for (const snapshot of fixtures) store().receive(snapshot);
    const distinctHits = new Set(fixtures.filter((f) => f.last_hit).map((f) => JSON.stringify(f.last_hit))).size;
    expect(store().hitCount).toBe(distinctHits);
  });

  it('clear() empties the snapshot and hit count but keeps the cards', () => {
    store().receive(cardsFixture);
    store().receive(fixtures[3]);
    store().clear();
    expect(store().snapshot).toBeNull();
    expect(store().hitCount).toBe(0);
    expect(store().cards).toHaveLength(12);
  });

  it('keeps the snapshot when theory_cards arrives after it, however late', () => {
    // The contract sends theory_cards once, before the first snapshot — but
    // nothing stops a slow connection from reordering that, and a mid-fight
    // snapshot must not be wiped out by cards arriving on its heels.
    const midFight = fixtures.find((f) => f.stage === 'opening' && f.last_hit)!;
    store().receive(midFight);
    store().receive(cardsFixture);
    expect(store().snapshot?.stage).toBe('opening');
    expect(store().snapshot?.last_hit).toEqual(midFight.last_hit);
    expect(store().cards).toHaveLength(12);
  });
});
