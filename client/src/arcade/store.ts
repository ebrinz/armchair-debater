import { create } from 'zustand';

import { isDebateSnapshot, isTheoryCardsMessage } from './types';
import type { DebateSnapshot, TheoryCard } from './types';

interface ArcadeStore {
  snapshot: DebateSnapshot | null;
  cards: TheoryCard[];
  /** Increments once per distinct hit; key hit animations on it. */
  hitCount: number;
  /** Feed every RTVI server message here; unknown messages are ignored. */
  receive: (data: unknown) => void;
  /** Forget the debate (on disconnect). The cards are kept. */
  clear: () => void;
}

const sameHit = (a: DebateSnapshot['last_hit'], b: DebateSnapshot['last_hit']) =>
  JSON.stringify(a) === JSON.stringify(b);

export const useArcadeStore = create<ArcadeStore>((set) => ({
  snapshot: null,
  cards: [],
  hitCount: 0,
  receive: (data) => {
    if (isTheoryCardsMessage(data)) {
      set({ cards: data.cards });
      return;
    }
    if (!isDebateSnapshot(data)) return;
    // A server from before the modes sends none of their fields.
    const snapshot = { ...data, mode: data.mode ?? null, focus: data.focus ?? null, question: data.question ?? null };
    set((state) => ({
      snapshot,
      hitCount:
        data.last_hit && !sameHit(data.last_hit, state.snapshot?.last_hit ?? null)
          ? state.hitCount + 1
          : state.hitCount,
    }));
  },
  clear: () => set({ snapshot: null, hitCount: 0 }),
}));
