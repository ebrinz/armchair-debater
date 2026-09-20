import cards from './fixtures/theory-cards.json';
import snapshots from './fixtures/debate-state.json';
import { useArcadeStore } from './store';

const STEP_MS = 3000;
/** How long to sit on the select screen and the decision screen in the loop. */
const HOLD_STEPS = 3;

/** Replays the contract fixtures into the store, looping. Returns a stop function. */
export const startMockReplay = (): (() => void) => {
  const { receive, clear } = useArcadeStore.getState();
  // The server pushes a snapshot the moment it matches the player to a theory,
  // while the stage is still `setup` (server/handlers.py:53 calls
  // DebateState.set_positions, which emits without touching the stage;
  // server/flow.yaml only moves to `opening` afterwards). The contract fixture
  // has no such frame, so the select screen's lock-in is reconstructed here
  // from the first debate frame.
  const lockedIn = { ...snapshots[1], stage: snapshots[0].stage };
  const frames = [
    ...Array<unknown>(HOLD_STEPS).fill(snapshots[0]),
    lockedIn,
    ...snapshots.slice(1),
    ...Array<unknown>(HOLD_STEPS).fill(snapshots.at(-1)),
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
