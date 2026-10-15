import { useEffect, useState } from 'react';

import { CardGrid } from '../components/CardGrid';
import { PixelButton } from '../components/PixelButton';
import { TheoryCardFace } from '../components/TheoryCardFace';
import '../fight.css';
import '../select.css';
import { playSfx } from '../sfxPlayer';
import { useArcadeStore } from '../store';
import type { TheoryCard } from '../types';

/** How long one ask keeps the next from being sent, if the guide has not turned to a card by then. */
const ASK_PATIENCE_MS = 12000;

export interface DeckScreenProps {
  cards: TheoryCard[];
  onBack: () => void;
  /** The explorer: the card the guide is talking about. The cursor goes there
   *  whenever it changes, and is the player's to move in between. */
  follow?: string | null;
  /** The explorer: choosing a card asks the guide about it. */
  onAsk?: (card: TheoryCard) => void;
}

/**
 * THE DECK — the twelve theory cards, to read before (or instead of) a debate.
 *
 * It is the select screen with nothing at stake: the same roster and the same
 * card face, but a slot only shows its card, and the rival chips on a card are
 * links to the cards they name. No connection is needed, so it opens from the
 * title screen; Escape or BACK returns there.
 */
export const DeckScreen = ({ cards, onBack, follow = null, onAsk }: DeckScreenProps) => {
  const [focused, setFocused] = useState(0);
  const ladder = useArcadeStore((s) => s.ladder);
  // Following is an event, not a binding: when the guide turns to a new card the
  // cursor goes with it, once, and the player can still wander off afterwards.
  // Applied during render, like the other derived state in this UI.
  const [followed, setFollowed] = useState<string | null>(null);
  // One ask at a time: a held Enter key once sent the same line 25 times in
  // eleven seconds. The guide turning to a card is the answer, and clears it.
  const [asking, setAsking] = useState(false);
  if (follow !== followed) {
    setFollowed(follow);
    setAsking(false);
    const index = cards.findIndex((c) => c.id === follow);
    if (index >= 0) setFocused(index);
  }
  useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => setAsking(false), ASK_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [asking]);
  const exploring = onAsk !== undefined;
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
        <h2 className="select__title pixel-text">{exploring ? 'Explore' : 'The deck'}</h2>
        <p className="select__sub">
          {exploring ? '— ask about any theory, or pick a card —' : '— twelve theories of consciousness —'}
        </p>
      </header>

      <div className="select__body">
        <div className="select__roster">
          <CardGrid
            cards={cards}
            focused={focused}
            onFocusChange={setFocused}
            onPick={(card) => {
              goTo(card.id);
              if (!onAsk || asking) return;
              setAsking(true);
              onAsk(card);
            }}
            lockedId={null}
            disabled={false}
            cursorLabel={null}
            ladder={ladder}
          />
          <div className="select__house">
            <PixelButton onClick={leave}>{exploring ? 'Menu' : 'Back'}</PixelButton>
          </div>
        </div>

        <div className="select__card">
          {shown && <TheoryCardFace key={shown.id} card={shown} cards={cards} onRival={goTo} />}
        </div>
      </div>

      <footer className="select__foot">
        <p className="select__hint">
          {exploring
            ? 'Your mic is open: ask what a theory says, what is wrong with it, or how two differ. The screen turns to whatever the guide is talking about.'
            : 'Each card is one theory: its claim, three arguments it fights with, and the rivals it is weak against. Pick a rival’s tag to turn to its card.'}
        </p>
        <p className="select__status pixel-text">
          <span className="select__prompt">
            {!exploring
              ? 'Arrow keys move · Esc goes back'
              : asking
                ? 'Asking the guide…'
                : 'Arrow keys move · Enter asks · Esc for the menu'}
          </span>
        </p>
      </footer>
    </div>
  );
};
