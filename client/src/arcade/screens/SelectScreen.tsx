import { useState } from 'react';

import { CardGrid } from '../components/CardGrid';
import { TheoryCardFace } from '../components/TheoryCardFace';
// The Armchair's own styles live in fight.css with the rest of the sprite's
// variants; the card portrait uses the `armchair--type` one.
import '../fight.css';
import '../select.css';
import type { DebateSnapshot, TheoryCard } from '../types';

/**
 * SELECT — the character select.
 *
 * The player has two ways in and they are equal: click a slot, which sends the
 * typed line "My view is {name}.", or simply say what they think, which never
 * touches this screen at all. Either way the server decides, and the snapshot's
 * `user.theory_id` is what locks a slot in — so the bot is free to match a
 * spoken view to a different card than the one under the cursor.
 */

export interface SelectScreenProps {
  snapshot: DebateSnapshot | null;
  cards: TheoryCard[];
  /** Sends the pick. Supplied by ArcadeApp; logs instead of sending in ?mock. */
  onPick: (card: TheoryCard) => void;
}

export const SelectScreen = ({ snapshot, cards, onPick }: SelectScreenProps) => {
  const [focused, setFocused] = useState(0);
  const [sent, setSent] = useState<TheoryCard | null>(null);

  const lockedId = snapshot?.user.theory_id ?? null;
  const lockedIndex = cards.findIndex((c) => c.id === lockedId);
  const locked = lockedIndex >= 0 ? cards[lockedIndex] : null;

  // The snapshot wins, so the cursor is derived rather than synchronised: once
  // the server says which theory the player holds — clicked or spoken — that is
  // where the cursor is, and there is no state to drift.
  const cursor = lockedIndex >= 0 ? lockedIndex : focused;

  const pick = (card: TheoryCard) => {
    setSent(card);
    onPick(card);
  };

  const shown = cards[cursor];
  const waiting = sent !== null || lockedId !== null;

  return (
    <div className="select">
      <header className="select__head">
        <h2 className="select__title pixel-text">Choose your theory</h2>
        <p className="select__sub">— or just say what you think —</p>
      </header>

      {/* The roster comes first in the DOM so one Tab lands on the grid; the
          card is placed to its left by the grid's explicit columns. */}
      <div className="select__body">
        <div className="select__roster">
          <CardGrid
            cards={cards}
            focused={cursor}
            onFocusChange={setFocused}
            onPick={pick}
            lockedId={lockedId}
            disabled={waiting}
          />

          <div className="select__foot">
            <p className="select__hint">
              Your mic is already open. Say what you think consciousness is and the house will
              take the other side — or pick a card here.
            </p>

            <p className="select__status pixel-text" role="status">
              {locked ? (
                <span className="select__locked">Locked in… {locked.name}</span>
              ) : sent ? (
                <span className="select__locked">Locked in…</span>
              ) : (
                <span className="select__prompt">Arrow keys move · Enter picks</span>
              )}
            </p>
          </div>
        </div>

        <div className="select__card">
          {shown ? (
            <TheoryCardFace
              /* A new card is a new component: whatever move was open closes. */
              key={shown.id}
              card={shown}
              cards={cards}
              locked={locked?.id === shown.id}
            />
          ) : (
            <div className="card card--blank" aria-hidden="true">
              <div className="card__body">
                <p className="card__waiting pixel-text">Dealing…</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
