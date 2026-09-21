import { useState } from 'react';

import { Conversation } from '@/components/pipecat/conversation';

import { battleLines, feltDamage, hitTier, turnCue } from '../battleText';
import { useTypewriter } from '../hooks/useTypewriter';
import type { Hit, Mode, Stage } from '../types';

import { PixelButton } from './PixelButton';

export interface BattleTextBoxProps {
  hit: Hit | null;
  /** Re-types the lines when it changes. */
  hitCount: number;
  stage: Stage;
  /** Sparring words a hit differently: it is an answer, scored. */
  mode?: Mode | null;
  /** No Pipecat client behind the UI, so no transcript to open. */
  mock?: boolean;
  /** Fixed text in place of the hit's lines — the decision screen types the
   *  judge's rationale in here. An empty array types nothing yet. */
  lines?: string[];
  /** Replaces the turn cue; `null` hides it, for a fight that is over. */
  cue?: string | null;
}

/** battleLines always returns the move, then the effectiveness, then a heal. */
const LINE_ROLES = ['move', 'effect', 'recovery'] as const;

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
export const BattleTextBox = ({
  hit,
  hitCount,
  stage,
  mode = null,
  mock = false,
  lines: fixed,
  cue,
}: BattleTextBoxProps) => {
  const [open, setOpen] = useState(false);
  const tier = hit ? hitTier(feltDamage(hit, mode)) : null;
  const lines = fixed ?? (hit ? battleLines(hit, mode) : []);
  const typed = useTypewriter(lines, hitCount, fixed ? false : tier === 'super');
  const turn = cue === undefined ? turnCue(hit, stage) : cue;

  return (
    <div className="battle-box">
      {open && !mock && (
        <div className="battle-box__drawer pixel-panel">
          <Conversation noFunctionCalls />
        </div>
      )}

      <div
        className={`battle-box__panel pixel-panel${!fixed && tier === 'super' ? ' battle-box__panel--slam' : ''}`}
      >
        <div className="battle-box__lines">
          {typed.map((line, i) => (
            // Keyed by position: the lines are a fixed shape per hit (move,
            // effectiveness, recovery), so the node survives as the text grows.
            <p className={`battle-box__line battle-box__line--${LINE_ROLES[i] ?? 'move'}`} key={i}>
              {line}
              {' '}
            </p>
          ))}
          {turn && <p className="battle-box__cue pixel-text">{turn}</p>}
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
