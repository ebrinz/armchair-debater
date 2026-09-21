import type { CSSProperties } from 'react';

import { feltDamage } from '../battleText';
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
import { useSfx } from '../hooks/useSfx';
import { sfxForHit } from '../sfx';
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
  /** End-of-match poses, per side: the winner hops, the loser slumps. */
  poses?: Partial<Record<Side, 'win' | 'lose'>>;
  /** Fixed text for the battle box — the decision screen's rationale — with
   *  the turn cue it should carry (`null` for none). */
  text?: { lines: string[]; cue?: string | null };
}

/** How hard the target rocks back, per tier: a flinch, a rock, a hard rock. */
const ROCK_DEG: Record<HitTier, number> = { miss: 0, glancing: 4, solid: 8, super: 14 };
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
  poses,
  text,
}: FightScreenProps) => {
  const hit = snapshot.last_hit;
  // The effects are tiered on how hard the hit should feel, which in sparring is
  // not its face value; the number that floats up is always the real one.
  const felt = hit ? { ...hit, damage: feltDamage(hit, snapshot.mode) } : null;
  const fx = useHitEffects(hitCount, felt, frozen);
  const tier = fx.tier;
  const sparring = snapshot.mode === 'sparring';
  // In a debate the side that lands a hit is the side that shakes one off. In
  // sparring every hit is the examiner's question, and what is won back is the
  // player's.
  const healedSide: Side | null = fx.healed ? (sparring ? 'user' : fx.healed) : null;
  // The blow, and a beat later the shake-off if the speaker recovered. `frozen`
  // is the decision screen's replay of this HUD, where nothing lands.
  useSfx(!frozen && hit && tier ? sfxForHit(tier) : null, hitCount);
  useSfx(!frozen && hit && hit.recovery > 0 ? 'heal' : null, hitCount, 420);
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
        <RoundPlate snapshot={snapshot} />
        <HealthBar
          side="bot"
          label={sparring ? 'THE EXAMINER' : 'CPU THE HOUSE'}
          theory={sparring ? 'asks the questions' : snapshot.bot.theory_name}
          health={snapshot.bot.health}
          barless={sparring}
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
                // The lunge lasts as long as the other chair reels from it.
                attacking={fx.attacker === side && fx.hurt !== null}
                theoryId={debater[side].theory_id}
                healed={healedSide === side}
                health={debater[side].health}
                pose={poses?.[side]}
              />

              {hit && fx.target === side && tier && tier !== 'miss' && (
                <DamageNumber key={`d${hitCount}`} side={side} amount={-hit.damage} tier={tier} />
              )}
              {hit && healedSide === side && (
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

      <BattleTextBox
        hit={hit}
        hitCount={hitCount}
        stage={snapshot.stage}
        mode={snapshot.mode}
        mock={mock}
        lines={text?.lines}
        cue={text?.cue}
      />

      {!frozen && <Announcer stage={snapshot.stage} />}
    </div>
  );
};
