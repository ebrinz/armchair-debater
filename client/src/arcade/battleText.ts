import type { Hit, Side, Verdict } from './types';

export const speakerName = (side: Side): 'YOU' | 'THE HOUSE' => (side === 'user' ? 'YOU' : 'THE HOUSE');

const effectiveness = (damage: number): string => {
  if (damage === 0) return 'But it missed!';
  if (damage >= 15) return `It's super effective!  −${damage}`;
  if (damage <= 5) return `It's not very effective…  −${damage}`;
  return `−${damage}`;
};

/** The lines the battle text box types out for one hit. */
export const battleLines = (hit: Hit): string[] => {
  const who = speakerName(hit.by);
  const lines = [`${who} used "${hit.reason}"`, effectiveness(hit.damage)];
  if (hit.recovery > 0) lines.push(`${who} shook off the last hit!  +${hit.recovery}`);
  return lines;
};

export const decisionBanner = (winner: Verdict['winner']): 'YOU WIN' | 'YOU LOSE' | 'DRAW GAME' =>
  winner === 'user' ? 'YOU WIN' : winner === 'bot' ? 'YOU LOSE' : 'DRAW GAME';
