import { useEffect, useMemo, useState } from 'react';

import { hitTier } from '../battleText';
import type { HitTier } from '../battleText';
import type { Hit, Side } from '../types';

import { useReducedMotion } from './useReducedMotion';

/** ~4 frames at 60 Hz: the beat a super-effective hit hangs on before it lands. */
export const HITSTOP_MS = 67;
const HURT_MS = 400;
const HEAL_MS = 600;
/** Style guide, "Hit feel": none / none / 2 px·150 ms / 6 px·300 ms. */
const SHAKE: Record<HitTier, { px: number; ms: number }> = {
  miss: { px: 0, ms: 0 },
  glancing: { px: 0, ms: 0 },
  solid: { px: 2, ms: 150 },
  super: { px: 6, ms: 300 },
};

export interface HitEffects {
  /** The tier of the hit on show, or null before the first one. */
  tier: HitTier | null;
  /** The side taking the hit — the opposite of `last_hit.by`. */
  target: Side | null;
  /** The side that landed it; where a miss's whiff puff and a heal's glow go. */
  attacker: Side | null;
  hurt: Side | null;
  healed: Side | null;
  /** Screen-shake amplitude in px; 0 means no shake. */
  shakePx: number;
  /** The hit-stop freeze: the target lights up and nothing moves. */
  frozen: boolean;
}

const NONE: HitEffects = {
  tier: null,
  target: null,
  attacker: null,
  hurt: null,
  healed: null,
  shakePx: 0,
  frozen: false,
};

const other = (side: Side): Side => (side === 'user' ? 'bot' : 'user');

interface Frame {
  at: number;
  frozen: boolean;
  hurt: boolean;
  healed: boolean;
  shakePx: number;
}

/**
 * One hit's timeline, as the handful of moments at which something changes.
 * Keeping it a list of frames means the only state this hook holds is "which
 * frame are we on", which can be derived on the first render of a new hit
 * instead of being set from inside an effect.
 */
const timeline = (tier: HitTier, healing: boolean): Frame[] => {
  const { px, ms } = SHAKE[tier];
  const stop = tier === 'super' ? HITSTOP_MS : 0;
  const hurtUntil = tier === 'miss' ? 0 : stop + HURT_MS;
  const shakeUntil = px ? stop + ms : 0;
  const healUntil = healing ? HEAL_MS : 0;

  const marks = [0, stop, shakeUntil, hurtUntil, healUntil].filter((t) => t > 0);
  const times = [...new Set([0, ...marks])].sort((a, b) => a - b);

  return times.map((at) => ({
    at,
    frozen: at < stop,
    hurt: at < hurtUntil,
    healed: at < healUntil,
    shakePx: at >= stop && at < shakeUntil ? px : 0,
  }));
};

/**
 * The transient flags for one hit, keyed on `hitCount` so a repeat of the same
 * damage still replays. This decides how a hit FEELS; it never decides which
 * screen is showing. Under reduced motion only the tier and the sides survive,
 * so the numbers and the bars still change but nothing moves.
 */
export const useHitEffects = (hitCount: number, hit: Hit | null, disabled = false): HitEffects => {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState({ hitCount: -1, index: 0 });

  const live = !disabled && !reduced && hit !== null && hitCount > 0;
  const tier = hit ? hitTier(hit.damage) : null;
  const healing = Boolean(hit && hit.recovery > 0);
  // Memoised so the timers below are scheduled once per hit, not per render.
  const frames = useMemo(() => (live && tier ? timeline(tier, healing) : null), [live, tier, healing]);

  useEffect(() => {
    if (!frames) return;
    const timers = frames
      .slice(1)
      .map((frame, i) => window.setTimeout(() => setPhase({ hitCount, index: i + 1 }), frame.at));
    return () => timers.forEach(window.clearTimeout);
  }, [hitCount, frames]);

  if (disabled || !hit || hitCount === 0 || !tier) return NONE;

  const base = { tier, target: other(hit.by), attacker: hit.by };
  if (!frames) return { ...NONE, ...base };

  // A new hit starts at frame 0; the timers walk it forward from there.
  const frame = frames[phase.hitCount === hitCount ? Math.min(phase.index, frames.length - 1) : 0];
  return {
    ...base,
    hurt: frame.hurt ? other(hit.by) : null,
    healed: frame.healed ? hit.by : null,
    shakePx: frame.shakePx,
    frozen: frame.frozen,
  };
};

/**
 * True for `ms` after each super-effective hit — what flares the stage's fire.
 * It lives apart from the rest because the fire belongs to the stage, which is
 * mounted above the screens.
 */
export const useSuperFlare = (hitCount: number, hit: Hit | null, ms = 500): boolean => {
  // The last hit whose flare has already burnt out.
  const [spent, setSpent] = useState(-1);
  const isSuper = Boolean(hit && hitCount > 0 && hitTier(hit.damage) === 'super');

  useEffect(() => {
    if (!isSuper) return;
    const timer = window.setTimeout(() => setSpent(hitCount), ms);
    return () => window.clearTimeout(timer);
  }, [hitCount, isSuper, ms]);

  return isSuper && spent !== hitCount;
};
