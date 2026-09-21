/**
 * The three things to do in the study, and what the UI says to the bot to ask
 * for them. Every line is something a person would say, because saying it is
 * the other way in: the buttons only ever send what the player could have said.
 */

import type { Mode } from './types';

export const MODES: { id: Mode; title: string; blurb: string }[] = [
  {
    id: 'debate',
    title: 'DEBATE',
    blurb: 'Pick a theory. The house takes a rival and argues you down — a judge scores every turn.',
  },
  {
    id: 'sparring',
    title: 'SPARRING',
    blurb: 'State your view. The examiner puts five hard questions to it. How much survives?',
  },
  {
    id: 'explore',
    title: 'EXPLORE',
    blurb: 'Be shown round the twelve theories: ask about any of them, or how two differ.',
  },
];

export const MODE_LINES: Record<Mode, string> = {
  debate: "Let's debate.",
  sparring: "I'd like to spar: test my view with questions.",
  explore: 'I want to explore the theories.',
};

export const MENU_LINE = 'Take me back to the menu.';

/** Asking for another go, in the mode's own terms. */
export const againLine = (mode: Mode | null): string =>
  mode === 'sparring' ? "I'd like another round of questions." : "I'd like a rematch.";

/** What clicking a card says in the explorer. */
export const askLine = (theoryName: string): string => `Tell me about ${theoryName}.`;
