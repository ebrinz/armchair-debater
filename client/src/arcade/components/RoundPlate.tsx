import { ROUNDS, ROUND_LABELS, roundNumber } from '../screen';
import type { Stage } from '../types';

/**
 * The centre plate: which round this is, and a pip per round filled up to it.
 * There is no countdown — the debate has no clock, and a fake one would lie.
 */
export const RoundPlate = ({ stage }: { stage: Stage }) => {
  const round = roundNumber(stage);
  const [title, ...rest] = ROUND_LABELS[stage].split(' · ');

  return (
    <div className="round-plate">
      <div className="round-plate__title pixel-text">{title}</div>
      {rest.length > 0 && <div className="round-plate__stage pixel-text">{rest.join(' · ')}</div>}
      <div className="round-plate__pips" aria-hidden="true">
        {Array.from({ length: ROUNDS }, (_, i) => i + 1).map((pip) => (
          <span
            key={pip}
            className={`round-plate__pip${pip <= round ? ' round-plate__pip--on' : ''}`}
          />
        ))}
      </div>
    </div>
  );
};
