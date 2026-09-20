import type { HitTier } from '../battleText';
import type { Side } from '../types';

export interface DamageNumberProps {
  /** Which fighter it rises from. */
  side: Side;
  /** Negative for damage, positive for a recovery. */
  amount: number;
  /** Damage only: how big and how loud. Recoveries are always the same size. */
  tier?: HitTier;
}

/**
 * The number that floats off a chair: `−N` over the fighter that took the hit,
 * `+N` over the one that shook it off. Scaled by tier — a small grey 8 barely
 * registers, a red 44 pops before it floats. The caller keys it on `hitCount`
 * so an identical hit still replays.
 */
export const DamageNumber = ({ side, amount, tier }: DamageNumberProps) => {
  const heal = amount > 0;
  const classes = [
    'damage-number',
    `damage-number--${side}`,
    heal ? 'damage-number--heal' : `damage-number--${tier ?? 'solid'}`,
  ].join(' ');

  return (
    <span className={classes} aria-hidden="true">
      {heal ? `+${amount}` : `−${Math.abs(amount)}`}
    </span>
  );
};
