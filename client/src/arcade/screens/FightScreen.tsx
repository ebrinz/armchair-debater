import { battleLines } from '../battleText';
import { HealthBar } from '../components/HealthBar';
import '../fight.css';
import { ROUND_LABELS } from '../screen';
import type { DebateSnapshot, Side } from '../types';

export interface FightScreenProps {
  snapshot: DebateSnapshot;
  hitCount: number;
}

const otherSide = (side: Side): Side => (side === 'user' ? 'bot' : 'user');

/** Fight HUD: health bars, round plate, battle text, and floating damage numbers. */
export const FightScreen = ({ snapshot, hitCount }: FightScreenProps) => {
  const hit = snapshot.last_hit;
  const lines = hit ? battleLines(hit) : ['THE HOUSE steps up…'];
  const shouldShake = Boolean(hit && hit.damage >= 30);

  return (
    // Keyed on hitCount so a repeat big hit restarts the (one-shot) CSS animation.
    <div key={hitCount} className={`fight-hud${shouldShake ? ' fight-hud--shake' : ''}`}>
      <div className="fight-hud__top">
        <HealthBar side="user" label="1P YOU" theory={snapshot.user.theory_name} health={snapshot.user.health} />
        <div className="fight-hud__round pixel-text">{ROUND_LABELS[snapshot.stage]}</div>
        <HealthBar
          side="bot"
          label="CPU THE HOUSE"
          theory={snapshot.bot.theory_name}
          health={snapshot.bot.health}
        />
      </div>

      {hit && hit.damage > 0 && (
        <span
          key={`dmg-${hitCount}`}
          className={`fight-hud__damage fight-hud__damage--${otherSide(hit.by)}`}
        >
          −{hit.damage}
        </span>
      )}
      {hit && hit.recovery > 0 && (
        <span
          key={`heal-${hitCount}`}
          className={`fight-hud__damage fight-hud__damage--heal fight-hud__damage--${hit.by}`}
        >
          +{hit.recovery}
        </span>
      )}

      <div className="fight-hud__battle-text pixel-panel" key={hitCount}>
        {lines.map((line, i) => (
          <div className="fight-hud__battle-line" key={i}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};
