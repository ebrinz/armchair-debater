import { useEffect, useState } from 'react';

import { decisionBanners } from '../battleText';
import { PixelButton } from '../components/PixelButton';
import '../fight.css';
import { useCountdown } from '../hooks/useCountdown';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { TYPE_CPS } from '../hooks/useTypewriter';
import type { DebateSnapshot, Side } from '../types';

import { FightScreen } from './FightScreen';

export interface DecisionScreenProps {
  snapshot: DebateSnapshot;
  /** Asks for another debate: the live app says so to the bot, `?mock` replays. */
  onRematch: () => void;
  /** No Pipecat client behind the UI, so no transcript button in the box. */
  mock?: boolean;
}

/**
 * The end-of-match sequence, as a list of moments. Each one is a mark in
 * milliseconds from the screen's first render; the phase is simply how many
 * marks have gone by, so a single timer per mark drives the whole screen and
 * nothing has to be reset between them.
 */
const TITLE = 0;
const COUNT = 1;
const BANNER = 2;
const RATIONALE = 3;
const CONTINUE = 4;

const COUNT_AT = 700;
const BANNER_AT = 1850;
const RATIONALE_AT = 2550;
/** A beat after the rationale has finished typing before CONTINUE? appears. */
const CONTINUE_PAD_MS = 700;

/** The count-up: sixteen steps of the two numbers, a shade under a second. */
const COUNT_STEPS = 16;
const COUNT_STEP_MS = 55;

const COUNT_FROM = 9;

/**
 * The judge's decision: the fight's own HUD frozen underneath (dimmed fire,
 * no hit effects, no announcer), with the arcade finish played over it —
 * `JUDGE'S DECISION`, the two final numbers counting up, the result banners,
 * the rationale typing into the battle box, then `CONTINUE?` counting down.
 *
 * Every flourish here is timing only: the screen it belongs to is decided by
 * `screenFor` from the server's state, and clicking REMATCH does not switch
 * screens — it asks, and the next snapshot moves the game on.
 */
export const DecisionScreen = ({ snapshot, onRematch, mock = false }: DecisionScreenProps) => {
  const reduced = useReducedMotion();
  const verdict = snapshot.verdict;
  const banners = decisionBanners(snapshot);
  const rationale = verdict?.rationale ?? '';

  const [step, setStep] = useState(TITLE);
  useEffect(() => {
    if (reduced) return;
    // The typing is part of the sequence, so CONTINUE? waits for it to finish.
    const typingMs = (rationale.length / TYPE_CPS) * 1000;
    const marks = [COUNT_AT, BANNER_AT, RATIONALE_AT, RATIONALE_AT + typingMs + CONTINUE_PAD_MS];
    // Forward only: if the rationale changes under the screen the marks are
    // rescheduled, and they must not walk the sequence back to the count-up.
    const timers = marks.map((at, i) =>
      window.setTimeout(() => setStep((step) => Math.max(step, i + 1)), at)
    );
    return () => timers.forEach(window.clearTimeout);
  }, [reduced, rationale]);

  // Reduced motion: no slam, no count-up, no staged reveal — the whole finish
  // is simply there. The countdown still counts; it is the prompt's content,
  // not an animation.
  const phase = reduced ? CONTINUE : step;

  // The count-up, one step at a time so the numbers tick rather than sweep.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced || phase < COUNT || tick >= COUNT_STEPS) return;
    const timer = window.setTimeout(() => setTick(tick + 1), COUNT_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [reduced, phase, tick]);

  const counted = (health: number): number =>
    reduced || tick >= COUNT_STEPS ? health : Math.round((health * tick) / COUNT_STEPS);

  const left = useCountdown(COUNT_FROM, phase >= CONTINUE);
  const [asked, setAsked] = useState(false);

  const winner: Side | null =
    verdict && verdict.winner !== 'draw' ? verdict.winner : null;
  const poses = winner
    ? ({ user: winner === 'user' ? 'win' : 'lose', bot: winner === 'bot' ? 'win' : 'lose' } as const)
    : undefined;

  return (
    <div className="decision">
      {/* The fight, over: the same bars, chairs and text box, holding still.
          hitCount 0 because `frozen` already silences every hit effect — the
          box is showing the verdict, not the last blow. */}
      <FightScreen
        snapshot={snapshot}
        hitCount={0}
        frozen
        mock={mock}
        poses={poses}
        text={{ lines: phase >= RATIONALE && rationale ? [rationale] : [], cue: null }}
      />

      <div className="decision__overlay">
        {/* The title, the numbers and the banners are pure show: the same words
            reach a screen reader through the app's one live region. */}
        <div className="decision__plate" aria-hidden="true">
          <p className="decision__title pixel-text">JUDGE&apos;S DECISION</p>

          {verdict && phase >= COUNT && (
            <p className="decision__score">
              <span className={`decision__num decision__num--${winner === 'user' ? 'win' : 'lose'}`}>
                {counted(snapshot.user.health)}
              </span>
              {' — '}
              <span className={`decision__num decision__num--${winner === 'bot' ? 'win' : 'lose'}`}>
                {counted(snapshot.bot.health)}
              </span>
            </p>
          )}

          {phase >= BANNER &&
            banners.map((banner, i) => (
              <p
                key={banner}
                className={`decision__banner pixel-text decision__banner--${
                  i === banners.length - 1 ? 'result' : 'flourish'
                }`}
              >
                {banner}
              </p>
            ))}
        </div>

        {verdict && phase >= CONTINUE && (
          <div className="decision__continue">
            <p className="decision__prompt pixel-text">
              {asked ? (
                'HERE COMES A NEW CHALLENGER…'
              ) : left > 0 ? (
                <>
                  CONTINUE? <span className="decision__count">{left}</span>
                </>
              ) : (
                'GAME OVER — THANKS FOR PLAYING'
              )}
            </p>
            <PixelButton
              size="lg"
              blink={!asked && left > 0}
              onClick={() => {
                setAsked(true);
                onRematch();
              }}
            >
              REMATCH
            </PixelButton>
          </div>
        )}
      </div>
    </div>
  );
};
