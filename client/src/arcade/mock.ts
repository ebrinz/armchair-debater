import cards from './fixtures/theory-cards.json';
import debate from './fixtures/debate-state.json';
import explore from './fixtures/explore-state.json';
import sparring from './fixtures/sparring-state.json';
import { useArcadeStore } from './store';
import type { DebateSnapshot, Mode } from './types';

const STEP_MS = 3000;
/** How long to sit on the select screen in the loop. */
const HOLD_STEPS = 3;
/**
 * And on the decision screen, which has a sequence to play: the slam, the
 * count-up, the banners, the rationale typing itself out, and then the
 * CONTINUE? countdown from 9 — about twenty seconds all told.
 */
const VERDICT_HOLD_STEPS = 8;

const FIXTURES: Record<Mode, DebateSnapshot[]> = {
  debate: debate as DebateSnapshot[],
  sparring: sparring as DebateSnapshot[],
  explore: explore as DebateSnapshot[],
};

/** `?mock` replays the debate; `?mock=sparring` and `?mock=explore` the other two. */
export const mockKind = (search: string): Mode => {
  const value = new URLSearchParams(search).get('mock');
  return value === 'sparring' || value === 'explore' ? value : 'debate';
};

/**
 * Replays one mode's contract fixture into the store, looping. Every frame is
 * what the server really sends — including the lock-in, pushed the moment it
 * matches the player to a theory while the stage is still `setup` — and the
 * loop only decides how long to sit on the screens a person would linger on.
 * Returns a stop function.
 */
export const startMockReplay = (kind: Mode = 'debate'): (() => void) => {
  const { receive, clear } = useArcadeStore.getState();
  const snapshots = FIXTURES[kind];
  const frames = snapshots.flatMap((frame, i) => {
    const choosing = frame.stage === 'setup' && !frame.user.theory_id;
    const last = i === snapshots.length - 1;
    const holds = choosing ? HOLD_STEPS : last ? (frame.verdict ? VERDICT_HOLD_STEPS : HOLD_STEPS) : 1;
    return Array<DebateSnapshot>(holds).fill(frame);
  });
  let index = 0;
  receive(cards);
  const tick = () => {
    if (index === 0) clear();
    receive(frames[index]);
    index = (index + 1) % frames.length;
  };
  tick();
  const timer = window.setInterval(tick, STEP_MS);
  return () => window.clearInterval(timer);
};
