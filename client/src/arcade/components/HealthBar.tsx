export interface HealthBarProps {
  side: 'user' | 'bot';
  label: string;
  theory: string | null;
  health: number;
  /** Someone with no bar to lose — sparring's examiner. The name plate stays,
   *  so the HUD keeps its two sides; the number and the meter do not exist. */
  barless?: boolean;
}

/**
 * A fighting-game health bar. The fill is anchored to the CENTRE end of its
 * track, so the outer end of the screen empties first; behind it a red ghost
 * on a delayed transition holds the previous value for a beat after a hit,
 * then shrinks to meet it.
 *
 * A heal needs no special case: the ghost lags on the way up too, but it is
 * then NARROWER than the fill painted over it, so it is hidden for the whole
 * delay and no red is ever seen growing.
 */
export const HealthBar = ({ side, label, theory, health, barless = false }: HealthBarProps) => {
  const clamped = Math.max(0, Math.min(100, health));
  const danger = clamped < 30;

  return (
    <div className={`hp-bar hp-bar--${side}${danger ? ' hp-bar--danger' : ''}`}>
      <div className="hp-bar__labels">
        <span className="hp-bar__label pixel-text">{label}</span>
        <span className="hp-bar__theory">{theory ?? '???'}</span>
      </div>

      {/* Hidden rather than removed when barless, so both plates stay level. */}
      <div className="hp-bar__row" style={barless ? { visibility: 'hidden' } : undefined} aria-hidden={barless || undefined}>
        <span className="hp-bar__number pixel-text">{clamped}</span>
        <div
          className="hp-bar__track pixel-border"
          role="meter"
          aria-label={`${label} health`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped}
        >
          <div className="hp-bar__ghost" style={{ width: `${clamped}%` }} />
          <div className="hp-bar__fill" style={{ width: `${clamped}%` }} />
        </div>
      </div>
    </div>
  );
};
