/**
 * The ladder: three rungs per theory — LEARN, SPAR, DEBATE — lit when the
 * player has won in that mode with that theory. The server is stateless, so
 * the ladder lives here, in localStorage, and nothing is ever locked by it.
 */

import type { DebateSnapshot, Mode } from './types';

export type Rung = 'learn' | 'spar' | 'debate';
export type Ladder = Record<string, Partial<Record<Rung, true>>>;

export const LADDER_KEY = 'armchair.ladder';
export const RUNGS: Rung[] = ['learn', 'spar', 'debate'];

export const rungFor = (mode: Mode | null): Rung | null =>
  mode === 'learn' ? 'learn' : mode === 'sparring' ? 'spar' : mode === 'debate' ? 'debate' : null;

/**
 * The ladder after a snapshot. Only a verdict the player won lights a rung — a
 * draw lights nothing — and it is the SAME object back when nothing changed.
 */
export const advance = (ladder: Ladder, snapshot: DebateSnapshot): Ladder => {
  const rung = rungFor(snapshot.mode);
  const id = snapshot.user.theory_id;
  if (!rung || !id || snapshot.verdict?.winner !== 'user') return ladder;
  if (ladder[id]?.[rung]) return ladder;
  return { ...ladder, [id]: { ...ladder[id], [rung]: true } };
};

const isLadder = (value: unknown): value is Ladder =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whatever is stored, or an empty ladder when there is nothing, or garbage, or no storage. */
export const loadLadder = (storage: Storage | null): Ladder => {
  try {
    const raw = storage?.getItem(LADDER_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isLadder(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const saveLadder = (storage: Storage | null, ladder: Ladder): void => {
  try {
    storage?.setItem(LADDER_KEY, JSON.stringify(ladder));
  } catch {
    // A full or blocked storage loses the save, not the game.
  }
};

const browserStorage = (): Storage | null =>
  typeof localStorage === 'undefined' ? null : localStorage;

export const loadBrowserLadder = (): Ladder => loadLadder(browserStorage());
export const saveBrowserLadder = (ladder: Ladder): void => saveLadder(browserStorage(), ladder);
