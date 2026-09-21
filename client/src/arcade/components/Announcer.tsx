import { useEffect, useState } from 'react';

import { useSfx } from '../hooks/useSfx';
import { ANNOUNCER_SEQUENCE } from '../screen';
import type { Stage } from '../types';

/**
 * The banner that slams in on every stage change and leaves again. It is pure
 * decoration over the fight — `pointer-events: none`, `aria-hidden` — because
 * the same words reach a screen reader through the app's one live region,
 * composed in ArcadeApp from `announcerText`.
 */
export const Announcer = ({ stage }: { stage: Stage }) => {
  // The stage travels with the index so a new stage starts at its first
  // banner without anything having to reset it.
  const [step, setStep] = useState<{ stage: Stage; index: number }>({ stage, index: 0 });
  const steps = ANNOUNCER_SEQUENCE[stage] ?? [];
  const index = step.stage === stage ? step.index : 0;
  useSfx(steps.length > 0 ? 'round' : null, stage);

  useEffect(() => {
    const timers: number[] = [];
    let elapsed = 0;
    (ANNOUNCER_SEQUENCE[stage] ?? []).forEach(([, ms], i) => {
      elapsed += ms;
      timers.push(window.setTimeout(() => setStep({ stage, index: i + 1 }), elapsed));
    });
    return () => timers.forEach(window.clearTimeout);
  }, [stage]);

  const current = steps[index];
  if (!current) return null;

  return (
    <div className="announcer" aria-hidden="true">
      {/* Keyed so the slam restarts when the word changes. */}
      <span key={`${stage}-${index}`} className="announcer__banner pixel-text">
        {current[0]}
      </span>
    </div>
  );
};
