import cards from './fixtures/theory-cards.json';
import debate from './fixtures/debate-state.json';
import explore from './fixtures/explore-state.json';
import learn from './fixtures/learn-state.json';
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
  learn: learn as DebateSnapshot[],
};

/** `?mock` replays the debate; `?mock=sparring` and `?mock=explore` the other two. */
export const mockKind = (search: string): Mode => {
  const value = new URLSearchParams(search).get('mock');
  return value === 'sparring' || value === 'explore' || value === 'learn' ? value : 'debate';
};

/** `?frame=n` pins fixture frame n, for tests that must land on one exact screen. */
export const mockFrame = (search: string, length: number): number | null => {
  const raw = new URLSearchParams(search).get('frame');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const frame = Number(raw);
  return frame < length ? frame : null;
};

/** `?talk=bot` or `?talk=user` feeds that side a fake voice, so its mouth moves. */
export const mockTalk = (search: string): 'bot' | 'user' | null => {
  const value = new URLSearchParams(search).get('talk');
  return value === 'bot' || value === 'user' ? value : null;
};

/** The fake voice's level at a moment: a slow wobble that never reaches silence. */
export const mockLevel = (ms: number): number => 0.55 + 0.35 * Math.sin(ms / 180);

/** How many frames a mode's replay has, for validating `?frame=`. */
export const mockLength = (kind: Mode): number => FIXTURES[kind].length;

/**
 * Replays one mode's contract fixture into the store, looping. Every frame is
 * what the server really sends — including the lock-in, pushed the moment it
 * matches the player to a theory while the stage is still `setup` — and the
 * loop only decides how long to sit on the screens a person would linger on.
 * Returns a stop function.
 */
export const startMockReplay = (kind: Mode = 'debate', frame: number | null = null): (() => void) => {
  const { receive, clear } = useArcadeStore.getState();
  const snapshots = FIXTURES[kind];
  if (frame !== null) {
    clear();
    receive(cards);
    receive(snapshots[frame]);
    return () => {};
  }
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
