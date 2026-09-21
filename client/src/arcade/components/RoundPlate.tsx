import { plateFor } from '../screen';
import type { DebateSnapshot } from '../types';

/**
 * The centre plate: which round this is — or, in sparring, which question — and
 * a pip for each, filled up to it. There is no countdown: the debate has no
 * clock, and a fake one would lie.
 */
export const RoundPlate = ({ snapshot }: { snapshot: DebateSnapshot }) => {
  const { title, sub, pips, lit } = plateFor(snapshot);

  return (
    <div className="round-plate">
      <div className="round-plate__title pixel-text">{title}</div>
      {sub && <div className="round-plate__stage pixel-text">{sub}</div>}
      <div className="round-plate__pips" aria-hidden="true">
        {Array.from({ length: pips }, (_, i) => i + 1).map((pip) => (
          <span
            key={pip}
            className={`round-plate__pip${pip <= lit ? ' round-plate__pip--on' : ''}`}
          />
        ))}
      </div>
    </div>
  );
};
