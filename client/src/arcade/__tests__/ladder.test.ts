import { beforeEach, describe, expect, it } from 'vitest';

import debate from '../fixtures/debate-state.json';
import learn from '../fixtures/learn-state.json';
import sparring from '../fixtures/sparring-state.json';
import { LADDER_KEY, advance, loadLadder, rungFor, saveLadder } from '../ladder';
import { useArcadeStore } from '../store';
import type { DebateSnapshot } from '../types';

const last = (frames: unknown[]) => frames.at(-1) as DebateSnapshot;

describe('the ladder', () => {
  it('maps each scored mode to its rung, and the explorer to none', () => {
    expect(rungFor('learn')).toBe('learn');
    expect(rungFor('sparring')).toBe('spar');
    expect(rungFor('debate')).toBe('debate');
    expect(rungFor('explore')).toBeNull();
    expect(rungFor(null)).toBeNull();
  });

  it('lights a rung on a verdict the player won, for the theory they held', () => {
    const won = { ...last(learn), verdict: { winner: 'user' as const, rationale: 'r' } };
    expect(advance({}, won)).toEqual({ gwt: { learn: true } });
    const spar = { ...last(sparring), verdict: { winner: 'user' as const, rationale: 'r' } };
    expect(advance({ gwt: { learn: true } }, spar)).toEqual({ gwt: { learn: true, spar: true } });
  });

  it('lights nothing on a loss, a draw, a frame with no verdict, or no theory', () => {
    const base = last(debate);
    expect(advance({}, { ...base, verdict: { winner: 'bot', rationale: 'r' } })).toEqual({});
    expect(advance({}, { ...base, verdict: { winner: 'draw', rationale: 'r' } })).toEqual({});
    expect(advance({}, { ...base, verdict: null })).toEqual({});
    const won = { ...base, verdict: { winner: 'user' as const, rationale: 'r' } };
    expect(advance({}, { ...won, user: { ...won.user, theory_id: null } })).toEqual({});
  });

  it('returns the same object when nothing changed, so the store can skip a save', () => {
    const ladder = { gwt: { learn: true as const } };
    const won = { ...last(learn), verdict: { winner: 'user' as const, rationale: 'r' } };
    expect(advance(ladder, won)).toBe(ladder);
  });

  it('round-trips through storage, and reads garbage or no storage as empty', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    } as Storage;
    saveLadder(storage, { iit: { debate: true } });
    expect(JSON.parse(memory.get(LADDER_KEY)!)).toEqual({ iit: { debate: true } });
    expect(loadLadder(storage)).toEqual({ iit: { debate: true } });
    memory.set(LADDER_KEY, '{not json');
    expect(loadLadder(storage)).toEqual({});
    memory.set(LADDER_KEY, '[1,2]');
    expect(loadLadder(storage)).toEqual({});
    expect(loadLadder(null)).toEqual({});
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadLadder(throwing)).toEqual({});
  });
});

describe('the store keeps the ladder', () => {
  // vitest runs in the node environment here (vitest.config.ts), so there is
  // no localStorage unless the test provides one; the ladder reads
  // globalThis.localStorage at call time, never at import.
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    };
    useArcadeStore.setState({ ladder: {} });
    useArcadeStore.getState().clear();
  });

  it('advances it on a won verdict and persists it, and keeps it across clear()', () => {
    const store = useArcadeStore.getState();
    for (const frame of learn) store.receive(frame);
    expect(useArcadeStore.getState().ladder).toEqual({ gwt: { learn: true } });
    expect(JSON.parse(memory.get(LADDER_KEY)!)).toEqual({ gwt: { learn: true } });
    store.clear();
    expect(useArcadeStore.getState().ladder).toEqual({ gwt: { learn: true } });
  });
});
