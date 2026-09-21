import { useState } from 'react';

import { CardGrid } from '../components/CardGrid';
import { PixelButton } from '../components/PixelButton';
import { TheoryCardFace } from '../components/TheoryCardFace';
import '../fight.css';
import '../select.css';
import { playSfx } from '../sfxPlayer';
import type { TheoryCard } from '../types';

export interface DeckScreenProps {
  cards: TheoryCard[];
  onBack: () => void;
}

/**
 * THE DECK — the twelve theory cards, to read before (or instead of) a debate.
 *
 * It is the select screen with nothing at stake: the same roster and the same
 * card face, but a slot only shows its card, and the rival chips on a card are
 * links to the cards they name. No connection is needed, so it opens from the
 * title screen; Escape or BACK returns there.
 */
export const DeckScreen = ({ cards, onBack }: DeckScreenProps) => {
  const [focused, setFocused] = useState(0);
  const shown = cards[focused];

  const goTo = (id: string) => {
    const index = cards.findIndex((c) => c.id === id);
    if (index < 0) return;
    if (index !== focused) playSfx('pick');
    setFocused(index);
  };

  const leave = () => {
    playSfx('back');
    onBack();
  };

  return (
    <div
      className="select select--deck"
      onKeyDown={(event) => {
        if (event.key === 'Escape') leave();
      }}
    >
      <header className="select__head">
        <h2 className="select__title pixel-text">The deck</h2>
        <p className="select__sub">— twelve theories of consciousness —</p>
      </header>

      <div className="select__body">
        <div className="select__roster">
          <CardGrid
            cards={cards}
            focused={focused}
            onFocusChange={setFocused}
            onPick={(card) => goTo(card.id)}
            lockedId={null}
            disabled={false}
            cursorLabel={null}
          />
          <div className="select__house">
            <PixelButton onClick={leave}>Back</PixelButton>
          </div>
        </div>

        <div className="select__card">
          {shown && <TheoryCardFace key={shown.id} card={shown} cards={cards} onRival={goTo} />}
        </div>
      </div>

      <footer className="select__foot">
        <p className="select__hint">
          Each card is one theory: its claim, three arguments it fights with, and the rivals it is
          weak against. Pick a rival&apos;s tag to turn to its card.
        </p>
        <p className="select__status pixel-text">
          <span className="select__prompt">Arrow keys move · Esc goes back</span>
        </p>
      </footer>
    </div>
  );
};
