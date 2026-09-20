import { useState } from 'react';

import { Conversation } from '@/components/pipecat/conversation';

import { battleLines, hitTier } from '../battleText';
import { useTypewriter } from '../hooks/useTypewriter';
import type { Hit, Stage } from '../types';

import { PixelButton } from './PixelButton';

export interface BattleTextBoxProps {
  hit: Hit | null;
  /** Re-types the lines when it changes. */
  hitCount: number;
  stage: Stage;
  /** No Pipecat client behind the UI, so no transcript to open. */
  mock?: boolean;
}

/** battleLines always returns the move, then the effectiveness, then a heal. */
const LINE_ROLES = ['move', 'effect', 'recovery'] as const;

/**
 * Whose turn it is, derived only from the snapshot: the house opens, and after
 * that each hit hands the floor to the other side. Nothing here guesses at
 * state the server does not send — there is no "thinking…", because the
 * contract cannot tell us that.
 */
const turnCue = (hit: Hit | null, stage: Stage): string => {
  if (!hit) return stage === 'opening' ? 'THE HOUSE steps up…' : 'YOUR MOVE';
  return hit.by === 'bot' ? 'YOUR MOVE' : 'THE HOUSE steps up…';
};

/**
 * The bordered box along the bottom that reads the fight out. Each hit types
 * in at about 40 characters a second — except a super-effective one, which
 * slams in whole, because waiting two seconds to be told it was super
 * effective takes the punch out of it.
 *
 * The lines also reach a screen reader, once per hit rather than once per
 * character: they go through the app's single live region, which is composed
 * from the snapshot in ArcadeApp and so never sees the typing.
 */
export const BattleTextBox = ({ hit, hitCount, stage, mock = false }: BattleTextBoxProps) => {
  const [open, setOpen] = useState(false);
  const tier = hit ? hitTier(hit.damage) : null;
  const lines = hit ? battleLines(hit) : [];
  const typed = useTypewriter(lines, hitCount, tier === 'super');

  return (
    <div className="battle-box">
      {open && !mock && (
        <div className="battle-box__drawer pixel-panel">
          <Conversation noFunctionCalls />
        </div>
      )}

      <div className={`battle-box__panel pixel-panel${tier === 'super' ? ' battle-box__panel--slam' : ''}`}>
        <div className="battle-box__lines">
          {typed.map((line, i) => (
            // Keyed by position: the lines are a fixed shape per hit (move,
            // effectiveness, recovery), so the node survives as the text grows.
            <p className={`battle-box__line battle-box__line--${LINE_ROLES[i] ?? 'move'}`} key={i}>
              {line}
              {' '}
            </p>
          ))}
          <p className="battle-box__cue pixel-text">{turnCue(hit, stage)}</p>
        </div>

        {!mock && (
          <PixelButton
            className="battle-box__transcript"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'CLOSE' : 'TRANSCRIPT'}
          </PixelButton>
        )}
      </div>
    </div>
  );
};
