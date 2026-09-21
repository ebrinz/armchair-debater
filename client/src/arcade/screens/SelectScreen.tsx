import { useEffect, useState } from 'react';

import { CardGrid } from '../components/CardGrid';
import { PixelButton } from '../components/PixelButton';
import { TheoryCardFace } from '../components/TheoryCardFace';
// The Armchair's own styles live in fight.css with the rest of the sprite's
// variants; the card portrait uses the `armchair--type` one.
import '../fight.css';
import '../select.css';
import { rivalIndices } from '../selection';
import type { DebateSnapshot, TheoryCard } from '../types';

/**
 * SELECT — the character select.
 *
 * The player has two ways in and they are equal: pick here, which sends a typed
 * line as if they had said it, or simply say what they think, which never
 * touches this screen at all. Either way the server decides, and the snapshot's
 * `user.theory_id` is what locks a slot in — so the bot is free to match a
 * spoken view to a different card than the one under the cursor.
 *
 * Picking here takes two steps. First the player's own theory; then the roster
 * closes down to that theory's rivals and the player chooses which one the house
 * must defend — or presses HOUSE'S CHOICE and lets it decide, which is what
 * speaking does. Nothing is sent until the second step, and Escape goes back.
 */

export interface SelectScreenProps {
  snapshot: DebateSnapshot | null;
  cards: TheoryCard[];
  /** Sends the pick: the player's theory and the house's, or `null` to let the
   *  house choose. Supplied by ArcadeApp; logs instead of sending in ?mock. */
  onPick: (mine: TheoryCard, house: TheoryCard | null) => void;
}

/** How long a sent pick keeps the roster shut while waiting for the server to lock it in. */
const PICK_PATIENCE_MS = 12000;

export const SelectScreen = ({ snapshot, cards, onPick }: SelectScreenProps) => {
  const [focused, setFocused] = useState(0);
  // Step two begins once the player has a theory of their own.
  const [mine, setMine] = useState<TheoryCard | null>(null);
  const [sent, setSent] = useState<TheoryCard | null>(null);

  const lockedId = snapshot?.user.theory_id ?? null;
  const lockedIndex = cards.findIndex((c) => c.id === lockedId);
  const locked = lockedIndex >= 0 ? cards[lockedIndex] : null;

  // The snapshot wins, so the cursor is derived rather than synchronised: once
  // the server says which theory the player holds — clicked or spoken — that is
  // where the cursor is, and there is no state to drift.
  const cursor = lockedIndex >= 0 ? lockedIndex : focused;

  const mineIndex = mine ? cards.findIndex((c) => c.id === mine.id) : -1;
  const rivals = mine ? rivalIndices(mine, cards) : null;

  const send = (house: TheoryCard | null) => {
    if (!mine) return;
    setSent(mine);
    onPick(mine, house);
  };

  const pick = (card: TheoryCard) => {
    if (mine) return send(card);
    setMine(card);
    // The cursor becomes the house's, starting on the first rival.
    setFocused(rivalIndices(card, cards)[0] ?? focused);
  };

  const back = () => {
    if (!mine || sent) return;
    setFocused(mineIndex >= 0 ? mineIndex : 0);
    setMine(null);
  };

  // A pick is only a request: the bot may answer with a question instead of
  // locking it in. The roster comes back after a while rather than staying
  // shut for the rest of the session.
  useEffect(() => {
    if (!sent || lockedId) return;
    const timer = window.setTimeout(() => {
      setSent(null);
      setMine(null);
    }, PICK_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [sent, lockedId]);

  const shown = cards[cursor];
  const waiting = sent !== null || lockedId !== null;

  return (
    <div
      className="select"
      onKeyDown={(event) => {
        if (event.key === 'Escape') back();
      }}
    >
      <header className="select__head">
        <h2 className="select__title pixel-text">
          {mine ? 'Choose the house’s theory' : 'Choose your theory'}
        </h2>
        <p className="select__sub">
          {mine ? '— or let the house pick —' : '— or just say what you think —'}
        </p>
      </header>

      {/* The roster comes first in the DOM so one Tab lands on it; the two
          columns are placed by explicit grid areas, so list-left/detail-right
          flips by swapping the two `grid-area` values in select.css. */}
      <div className="select__body">
        <div className="select__roster">
          <CardGrid
            cards={cards}
            focused={cursor}
            onFocusChange={setFocused}
            onPick={pick}
            lockedId={lockedId}
            disabled={waiting}
            open={rivals}
            mineIndex={mineIndex >= 0 ? mineIndex : null}
            cursorLabel={mine ? 'CPU' : '1P'}
          />

          {mine && !waiting && (
            <div className="select__house">
              <PixelButton onClick={() => send(null)}>House&apos;s choice</PixelButton>
              <PixelButton onClick={back}>Back</PixelButton>
            </div>
          )}
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

      {/* A slim bar under both columns, so neither the roster nor the card has
          to give up room to it. */}
      <footer className="select__foot">
        <p className="select__hint">
          {mine
            ? `These are the rivals of ${mine.name}. Pick the one the house must defend, or let it choose.`
            : 'Your mic is already open. Say what you think consciousness is and the house will take the other side — or pick a theory here.'}
        </p>

        <p className="select__status pixel-text" role="status">
          {locked ? (
            <span className="select__locked">Locked in… {locked.name}</span>
          ) : sent ? (
            <span className="select__locked">Locked in…</span>
          ) : (
            <span className="select__prompt">
              {mine ? 'Arrows move · Enter picks · Esc goes back' : 'Arrow keys move · Enter picks'}
            </span>
          )}
        </p>
      </footer>
    </div>
  );
};
