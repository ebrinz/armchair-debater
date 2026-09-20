import type { DebateSnapshot, TheoryCard } from '../types';

export interface SelectScreenProps {
  snapshot: DebateSnapshot | null;
  cards: TheoryCard[];
}

/** Placeholder. Task U.4 replaces this with the twelve-card character select. */
export const SelectScreen = ({ snapshot, cards }: SelectScreenProps) => (
  <div className="placeholder">
    <h2 className="pixel-text placeholder__name">SELECT</h2>
    <p className="placeholder__prompt">CHOOSE YOUR THEORY — or just say what you think</p>
    <dl className="pixel-panel placeholder__data">
      <dt>stage</dt>
      <dd>{snapshot?.stage ?? '—'}</dd>
      <dt>cards</dt>
      <dd>{cards.length}</dd>
      <dt>your theory</dt>
      <dd>{snapshot?.user.theory_name ?? 'not picked'}</dd>
    </dl>
  </div>
);
