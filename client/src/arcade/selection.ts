/**
 * The select screen's two-step pick, as pure rules: what gets said to the bot,
 * which slots a step leaves open, and how the cursor moves among them.
 *
 * Step one is the player's own theory. Step two offers that theory's listed
 * rivals for the house to defend — the same list the server chooses from, so a
 * pick here is always one it will honour — or leaves the choice to the house.
 */

import type { GridKey } from './gridNav';
import type { TheoryCard } from './types';

/** What a pick says, as if the player had typed it. `house: null` leaves the rival to the bot. */
export const pickLine = (mine: TheoryCard, house: TheoryCard | null): string =>
  house
    ? `My view is ${mine.name}, and I want you to defend ${house.name} against it.`
    : `My view is ${mine.name}.`;

/** Roster slots holding the rivals of `mine`, in roster order. */
export const rivalIndices = (mine: TheoryCard, cards: TheoryCard[]): number[] =>
  cards.flatMap((card, i) => (mine.rivals.includes(card.id) ? [i] : []));

/**
 * Cursor movement when only some slots are open: the arrows step through the
 * open ones and stop at the ends, so a closed slot is never landed on. The
 * roster is a single column, so left/right mean up/down.
 */
export const moveAmong = (index: number, key: GridKey, enabled: number[]): number => {
  if (enabled.length === 0) return index;
  if (key === 'Home') return enabled[0];
  if (key === 'End') return enabled[enabled.length - 1];
  const forward = key === 'ArrowDown' || key === 'ArrowRight';
  const next = forward
    ? enabled.find((i) => i > index)
    : [...enabled].reverse().find((i) => i < index);
  if (next !== undefined) return next;
  // Nothing further that way: stay, or step in from outside the open set.
  if (enabled.includes(index)) return index;
  return forward ? enabled[enabled.length - 1] : enabled[0];
};
