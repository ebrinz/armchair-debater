export interface HealthBarProps {
  side: 'user' | 'bot';
  label: string;
  theory: string | null;
  health: number;
}

/** A fighting-game health bar: yellow fill over a red "ghost" that catches up
 *  after a delay, anchored so the OUTER edge of the screen empties first. */
export const HealthBar = ({ side, label, theory, health }: HealthBarProps) => {
  const clamped = Math.max(0, Math.min(100, health));
  const fillClass = `hp-bar__fill${clamped < 30 ? ' hp-bar__fill--danger' : ''}`;

  return (
    <div className={`hp-bar hp-bar--${side}`}>
      <div className="hp-bar__labels">
        <span className="hp-bar__label pixel-text">{label}</span>
        <span className="hp-bar__theory">{theory ?? '???'}</span>
      </div>
      <div
        className="hp-bar__track pixel-border"
        role="meter"
        aria-label={`${label} health`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
      >
        <div className="hp-bar__ghost" style={{ width: `${clamped}%` }} />
        <div className={fillClass} style={{ width: `${clamped}%` }} />
      </div>
      <span className="hp-bar__number">{clamped}</span>
    </div>
  );
};
