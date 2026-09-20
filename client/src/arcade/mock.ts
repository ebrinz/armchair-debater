import cards from './fixtures/theory-cards.json';
import snapshots from './fixtures/debate-state.json';
import { useArcadeStore } from './store';

const STEP_MS = 3000;
/** How long to sit on the select screen in the loop. */
const HOLD_STEPS = 3;
/**
 * And on the decision screen, which has a sequence to play: the slam, the
 * count-up, the banners, the rationale typing itself out, and then the
 * CONTINUE? countdown from 9 — about twenty seconds all told.
 */
const VERDICT_HOLD_STEPS = 8;

/** Replays the contract fixtures into the store, looping. Returns a stop function. */
export const startMockReplay = (): (() => void) => {
  const { receive, clear } = useArcadeStore.getState();
  // The second fixture is the lock-in: the server pushes it the moment it
  // matches the player to a theory, while the stage is still `setup`.
  const frames = [
    ...Array<unknown>(HOLD_STEPS).fill(snapshots[0]),
    ...snapshots.slice(1),
    ...Array<unknown>(VERDICT_HOLD_STEPS).fill(snapshots.at(-1)),
  ];
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
