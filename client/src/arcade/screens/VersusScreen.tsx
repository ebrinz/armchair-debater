import type { CSSProperties } from 'react';

import { Armchair } from '../components/Armchair';
import '../fight.css';
import { useSfx } from '../hooks/useSfx';
import { inkOn, typeOf } from '../theme';
import type { DebateSnapshot, Side, TheoryCard } from '../types';
import '../versus.css';

export interface VersusScreenProps {
  snapshot: DebateSnapshot;
  cards: TheoryCard[];
}

const LABELS: Record<Side, string> = { user: '1P YOU', bot: 'CPU THE HOUSE' };

/**
 * The match-up, between the select screen and the first round: the player's
 * theory slams in from the left and the house's from the right, each under its
 * type's colour, with the same two chairs that are about to fight. It is the
 * first time the player sees which theory the house chose.
 *
 * Pure show — nothing here can be clicked, and the words reach a screen reader
 * through the app's one live region.
 */
export const VersusScreen = ({ snapshot, cards }: VersusScreenProps) => {
  useSfx('versus', true);
  return (
  <div className="versus" aria-hidden="true">
    {(['user', 'bot'] as const).map((side) => {
      const debater = snapshot[side];
      const card = cards.find((c) => c.id === debater.theory_id);
      // The cards can arrive after the snapshot; until then the side is neutral.
      const colorVar = card ? typeOf(card).colorVar : '--type-neutral';
      // The family is what the colour stands for. IIT is a family of one, where
      // it would only repeat the name above it.
      const family = card?.kuhn_category.split('>')[0].trim() ?? '';
      const label = family.toLowerCase() === (debater.theory_name ?? '').toLowerCase() ? '' : family;
      const style = {
        '--type': `var(${colorVar})`,
        '--type-ink': `var(${inkOn(colorVar)})`,
      } as CSSProperties;
      return (
        <section className={`versus__side versus__side--${side}`} key={side} style={style}>
          <p className="versus__who pixel-text">{LABELS[side]}</p>
          <div className="versus__chair">
            <Armchair
              side={side}
              variant={side === 'user' ? 'challenger' : 'champion'}
              level={0}
              hurt={false}
              healed={false}
              health={100}
            />
          </div>
          <div className="versus__plate">
            <h2 className="versus__name pixel-text">{debater.theory_name ?? '???'}</h2>
            {label && <p className="versus__type">{label}</p>}
          </div>
        </section>
      );
    })}
    <p className="versus__vs pixel-text">VS</p>
  </div>
  );
};
