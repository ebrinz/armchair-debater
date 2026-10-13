/**
 * The four things to do in the study, and what the UI says to the bot to ask
 * for them. Every line is something a person would say, because saying it is
 * the other way in: the buttons only ever send what the player could have said.
 */

import type { Mode } from './types';

export const MODES: { id: Mode; title: string; blurb: string }[] = [
  {
    id: 'learn',
    title: 'LEARN',
    blurb: 'Pick a theory. The tutor teaches it in four steps, then checks that it has landed.',
  },
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
  learn: 'Teach me a theory.',
};

export const MENU_LINE = 'Take me back to the menu.';

/** Asking for another go, in the mode's own terms. */
export const againLine = (mode: Mode | null): string =>
  mode === 'sparring'
    ? "I'd like another round of questions."
    : mode === 'learn'
      ? 'Teach me that one again.'
      : "I'd like a rematch.";

/** What clicking a card says to the tutor. */
export const teachLine = (theoryName: string): string => `Teach me ${theoryName}.`;

/** The report's two hand-offs: the next rungs of the ladder. */
export const SPAR_THIS_LINE = 'Let me spar with it: question me on this theory.';
export const DEBATE_THIS_LINE = 'Let me debate with it.';

/** What clicking a card says in the explorer. */
export const askLine = (theoryName: string): string => `Tell me about ${theoryName}.`;
