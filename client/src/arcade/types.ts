/**
 * The two server messages the arcade UI consumes. Contract and examples:
 * docs/design/2026-09-19-debate-ui-design.md and the fixtures beside this folder.
 */

export type Stage = 'setup' | 'opening' | 'rebuttal' | 'closing' | 'verdict';
export type Side = 'user' | 'bot';

export interface Debater {
  theory_id: string | null;
  theory_name: string | null;
  health: number;
}

export interface Hit {
  by: Side;
  damage: number;
  recovery: number;
  reason: string;
}

export interface Verdict {
  winner: Side | 'draw';
  rationale: string;
}

export interface DebateSnapshot {
  type: 'debate_state';
  stage: Stage;
  user: Debater;
  bot: Debater;
  last_hit: Hit | null;
  verdict: Verdict | null;
}

export interface TheoryCard {
  id: string;
  name: string;
  kuhn_category: string;
  claim: string;
  /** Three move names, one per argument, in the same order. Display only. */
  moves: string[];
  arguments: string[];
  rivals: string[];
}

export interface TheoryCardsMessage {
  type: 'theory_cards';
  cards: TheoryCard[];
}

const hasType = (data: unknown, type: string): boolean =>
  typeof data === 'object' && data !== null && (data as { type?: unknown }).type === type;

export const isDebateSnapshot = (data: unknown): data is DebateSnapshot =>
  hasType(data, 'debate_state');

export const isTheoryCardsMessage = (data: unknown): data is TheoryCardsMessage =>
  hasType(data, 'theory_cards') && Array.isArray((data as { cards?: unknown }).cards);
