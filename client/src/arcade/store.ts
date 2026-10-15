import { create } from 'zustand';

import { advance, loadBrowserLadder, saveBrowserLadder } from './ladder';
import type { Ladder } from './ladder';
import { isDebateSnapshot, isSessionLostMessage, isTheoryCardsMessage } from './types';
import type { DebateSnapshot, TheoryCard } from './types';

interface ArcadeStore {
  snapshot: DebateSnapshot | null;
  cards: TheoryCard[];
  /** Increments once per distinct hit; key hit animations on it. */
  hitCount: number;
  /** The rungs cleared per theory; persisted, and kept across clear(). */
  ladder: Ladder;
  /** Why the bot ended the session, if it did; shown on the title screen after
   *  the disconnect that follows, so it survives clear(). */
  lost: string | null;
  /** Feed every RTVI server message here; unknown messages are ignored. */
  receive: (data: unknown) => void;
  /** Forget the debate (on disconnect). The cards, and the reason it ended, are kept. */
  clear: () => void;
  dismissLost: () => void;
}

const sameHit = (a: DebateSnapshot['last_hit'], b: DebateSnapshot['last_hit']) =>
  JSON.stringify(a) === JSON.stringify(b);

export const useArcadeStore = create<ArcadeStore>((set) => ({
  snapshot: null,
  cards: [],
  hitCount: 0,
  ladder: loadBrowserLadder(),
  lost: null,
  receive: (data) => {
    if (isTheoryCardsMessage(data)) {
      set({ cards: data.cards });
      return;
    }
    if (isSessionLostMessage(data)) {
      set({ lost: data.reason });
      return;
    }
    if (!isDebateSnapshot(data)) return;
    // A server from before the modes sends none of their fields.
    const snapshot = { ...data, mode: data.mode ?? null, focus: data.focus ?? null, question: data.question ?? null, lesson: data.lesson ?? null, floor: data.floor ?? null };
    set((state) => {
      const ladder = advance(state.ladder, snapshot);
      if (ladder !== state.ladder) saveBrowserLadder(ladder);
      return {
        snapshot,
        ladder,
        hitCount:
          data.last_hit && !sameHit(data.last_hit, state.snapshot?.last_hit ?? null)
            ? state.hitCount + 1
            : state.hitCount,
      };
    });
  },
  clear: () => set({ snapshot: null, hitCount: 0 }),
  dismissLost: () => set({ lost: null }),
}));
