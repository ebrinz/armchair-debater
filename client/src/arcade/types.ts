/**
 * The two server messages the arcade UI consumes. Contract and examples:
 * docs/design/2026-09-19-debate-ui-design.md and the fixtures beside this folder.
 */

export type Stage =
  | 'mode'
  | 'setup'
  | 'opening'
  | 'rebuttal'
  | 'crossexam'
  | 'closing'
  | 'verdict'
  | 'sparring'
  | 'explore';

/** What the player chose at the front door. */
export type Mode = 'debate' | 'sparring' | 'explore';
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
  /** `null` until chosen. A server from before the modes sends none of these
   *  three; the store fills them in as `null`, which reads as a debate. */
  mode: Mode | null;
  /** The explorer: the card being talked about. */
  focus: string | null;
  /** Sparring: which question this is. */
  question: { number: number; of: number } | null;
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

const MODE_NAMES: readonly string[] = ['debate', 'sparring', 'explore'];

const STAGES: readonly string[] = [
  'mode',
  'sparring',
  'explore',
  'setup',
  'opening',
  'rebuttal',
  'crossexam',
  'closing',
  'verdict',
];
const SIDES: readonly string[] = ['user', 'bot'];

type Loose = Record<string, unknown> | null | undefined;

const isDebater = (d: Loose): boolean => !!d && typeof d.health === 'number';

const isHit = (h: Loose): boolean =>
  !!h &&
  SIDES.includes(h.by as string) &&
  typeof h.damage === 'number' &&
  typeof h.recovery === 'number' &&
  typeof h.reason === 'string';

const isVerdict = (v: Loose): boolean =>
  !!v && typeof v === 'object' && typeof v.winner === 'string' && typeof v.rationale === 'string';

/**
 * Everything the screens read without checking, so a snapshot that would crash
 * one is dropped at the door and the last good one stays on screen.
 */
export const isDebateSnapshot = (data: unknown): data is DebateSnapshot => {
  if (!hasType(data, 'debate_state')) return false;
  const s = data as Record<string, Loose>;
  return (
    STAGES.includes(s.stage as unknown as string) &&
    isDebater(s.user) &&
    isDebater(s.bot) &&
    (s.last_hit == null || isHit(s.last_hit)) &&
    (s.verdict == null || isVerdict(s.verdict)) &&
    (s.mode == null || MODE_NAMES.includes(s.mode as unknown as string)) &&
    (s.focus == null || typeof s.focus === 'string') &&
    (s.question == null ||
      (typeof s.question === 'object' &&
        typeof s.question.number === 'number' &&
        typeof s.question.of === 'number'))
  );
};

export const isTheoryCardsMessage = (data: unknown): data is TheoryCardsMessage =>
  hasType(data, 'theory_cards') && Array.isArray((data as { cards?: unknown }).cards);
