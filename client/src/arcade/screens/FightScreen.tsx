import { battleLines } from '../battleText';
import { ROUND_LABELS } from '../screen';
import type { DebateSnapshot } from '../types';

export interface FightScreenProps {
  snapshot: DebateSnapshot;
  hitCount: number;
}

/** Placeholder. Task U.5 replaces this with the bars, fighters, and text box. */
export const FightScreen = ({ snapshot, hitCount }: FightScreenProps) => (
  <div className="placeholder">
    <h2 className="pixel-text placeholder__name">FIGHT</h2>
    <p className="placeholder__prompt">{ROUND_LABELS[snapshot.stage]}</p>
    <dl className="pixel-panel placeholder__data">
      <dt>stage</dt>
      <dd>{snapshot.stage}</dd>
      <dt>you</dt>
      <dd>
        {snapshot.user.theory_name ?? '—'} · {snapshot.user.health}
      </dd>
      <dt>the house</dt>
      <dd>
        {snapshot.bot.theory_name ?? '—'} · {snapshot.bot.health}
      </dd>
      <dt>hits</dt>
      <dd>{hitCount}</dd>
      <dt>last hit</dt>
      <dd>{snapshot.last_hit ? battleLines(snapshot.last_hit).join(' / ') : 'none yet'}</dd>
    </dl>
  </div>
);
