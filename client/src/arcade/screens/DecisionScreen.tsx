import { decisionBanner } from '../battleText';
import { HealthBar } from '../components/HealthBar';
import '../fight.css';
import type { DebateSnapshot } from '../types';

export interface DecisionScreenProps {
  snapshot: DebateSnapshot;
}

/** Judge's decision: final health bars, verdict banner, score, and rationale. */
export const DecisionScreen = ({ snapshot }: DecisionScreenProps) => (
  <div className="decision-hud">
    <div className="decision-hud__bars">
      <HealthBar side="user" label="1P YOU" theory={snapshot.user.theory_name} health={snapshot.user.health} />
      <HealthBar
        side="bot"
        label="CPU THE HOUSE"
        theory={snapshot.bot.theory_name}
        health={snapshot.bot.health}
      />
    </div>
    <div className="decision-hud__banner">
      <div className="decision-hud__title pixel-text">JUDGE&apos;S DECISION</div>
      {snapshot.verdict && (
        <>
          <div className="decision-hud__result pixel-text">{decisionBanner(snapshot.verdict.winner)}</div>
          <div className="decision-hud__score">
            {snapshot.user.health} — {snapshot.bot.health}
          </div>
          <div className="decision-hud__rationale pixel-panel">{snapshot.verdict.rationale}</div>
        </>
      )}
    </div>
  </div>
);
