import { decisionBanner } from '../battleText';
import type { DebateSnapshot } from '../types';

export interface DecisionScreenProps {
  snapshot: DebateSnapshot;
}

/** Placeholder. Task U.6 replaces this with the verdict flourishes. */
export const DecisionScreen = ({ snapshot }: DecisionScreenProps) => (
  <div className="placeholder">
    <h2 className="pixel-text placeholder__name">DECISION</h2>
    <p className="placeholder__prompt">
      {snapshot.verdict ? decisionBanner(snapshot.verdict.winner) : "JUDGE'S DECISION"}
    </p>
    <dl className="pixel-panel placeholder__data">
      <dt>stage</dt>
      <dd>{snapshot.stage}</dd>
      <dt>you</dt>
      <dd>{snapshot.user.health}</dd>
      <dt>the house</dt>
      <dd>{snapshot.bot.health}</dd>
      <dt>rationale</dt>
      <dd>{snapshot.verdict?.rationale ?? '—'}</dd>
    </dl>
  </div>
);
