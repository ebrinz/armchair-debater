import type { CSSProperties } from 'react';

import type { HitTier } from '../battleText';
import { Announcer } from '../components/Announcer';
import { Armchair } from '../components/Armchair';
import { BattleTextBox } from '../components/BattleTextBox';
import { DamageNumber } from '../components/DamageNumber';
import { HealthBar } from '../components/HealthBar';
import { Puffs } from '../components/Puffs';
import { RoundPlate } from '../components/RoundPlate';
import '../fight.css';
import { useHitEffects } from '../hooks/useHitEffects';
import type { DebateSnapshot, Side } from '../types';

export interface FightScreenProps {
  snapshot: DebateSnapshot;
  hitCount: number;
  /** The HUD with no hit effects, no bobbing and no announcer — task U.5 shows
   *  this behind the decision banner, where the fight is already over. */
  frozen?: boolean;
  /** Live audio levels, 0..1, for the bob and the mouth. Supplied by the
   *  component that lives inside PipecatClientProvider; 0 in `?mock`. */
  userLevel?: number;
  botLevel?: number;
  /** No Pipecat client at all, so no transcript to open. */
  mock?: boolean;
}

/** How hard the target rocks back, per tier: a flinch, a rock, a hard rock. */
const ROCK_DEG: Record<HitTier, number> = { miss: 0, glancing: 4, solid: 9, super: 17 };
/** The white flash is for a hit you feel — not for a glance, and not for a miss. */
const FLASH: Record<HitTier, 0 | 1> = { miss: 0, glancing: 0, solid: 1, super: 1 };
/** Stuffing bursting out of the seams. A miss throws dust at the attacker instead. */
const PUFFS: Record<HitTier, number> = { miss: 0, glancing: 0, solid: 4, super: 10 };

const SIDES: Side[] = ['user', 'bot'];

/**
 * The fight: two bars draining toward the round plate, two wingbacks facing
 * each other across the fire, and the battle text along the bottom.
 *
 * Every transient here is derived from `hitCount` and `snapshot.last_hit` and
 * lives for a few hundred milliseconds. None of it decides which screen is
 * showing — `screenFor` does that, from the server's state alone.
 */
export const FightScreen = ({
  snapshot,
  hitCount,
  frozen = false,
  userLevel = 0,
  botLevel = 0,
  mock = false,
}: FightScreenProps) => {
  const hit = snapshot.last_hit;
  const fx = useHitEffects(hitCount, hit, frozen);
  const tier = fx.tier;
  const level = { user: frozen ? 0 : userLevel, bot: frozen ? 0 : botLevel };
  const debater = { user: snapshot.user, bot: snapshot.bot };

  const rootStyle = { '--shake-px': `${fx.shakePx}px` } as CSSProperties;
  const rootClass = [
    'fight',
    fx.shakePx ? 'fight--shake' : '',
    fx.frozen ? 'fight--frozen' : '',
    tier ? `fight--${tier}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // No key: the shake and hurt classes are always removed between hits (the
    // effects settle back to nothing), so adding them again restarts the
    // one-shot animations on their own. Remounting here would close the
    // transcript drawer and re-run the announcer on every hit.
    <div className={rootClass} style={rootStyle}>
      <div className="fight__bars">
        <HealthBar
          side="user"
          label="1P YOU"
          theory={snapshot.user.theory_name}
          health={snapshot.user.health}
        />
        <RoundPlate stage={snapshot.stage} />
        <HealthBar
          side="bot"
          label="CPU THE HOUSE"
          theory={snapshot.bot.theory_name}
          health={snapshot.bot.health}
        />
      </div>

      <div className="fight__arena">
        {SIDES.map((side) => {
          const hurt = fx.hurt === side;
          const style = {
            '--rock-deg': `${ROCK_DEG[hurt && tier ? tier : 'solid']}deg`,
            '--flash': FLASH[hurt && tier ? tier : 'miss'],
          } as CSSProperties;

          return (
            <div className={`fighter fighter--${side}`} key={side} style={style}>
              <Armchair
                side={side}
                variant={side === 'user' ? 'challenger' : 'champion'}
                level={level[side]}
                hurt={hurt}
                healed={fx.healed === side}
                health={debater[side].health}
              />

              {hit && fx.target === side && tier && tier !== 'miss' && (
                <DamageNumber key={`d${hitCount}`} side={side} amount={-hit.damage} tier={tier} />
              )}
              {hit && fx.healed === side && (
                <DamageNumber key={`h${hitCount}`} side={side} amount={hit.recovery} />
              )}
              {tier && fx.target === side && PUFFS[tier] > 0 && (
                <Puffs key={`p${hitCount}`} side={side} count={PUFFS[tier]} kind="stuffing" />
              )}
              {tier === 'miss' && fx.attacker === side && (
                <Puffs key={`w${hitCount}`} side={side} count={3} kind="dust" />
              )}
            </div>
          );
        })}
      </div>

      <BattleTextBox hit={hit} hitCount={hitCount} stage={snapshot.stage} mock={mock} />

      {!frozen && <Announcer stage={snapshot.stage} />}
    </div>
  );
};
