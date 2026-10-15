import { playSfx } from '../sfxPlayer';

/**
 * The microphone's mute, beside the SFX toggle. Off, the bot hears nothing, so
 * a room's conversation cannot become the player's turns; the label is always
 * on screen, so a bot that hears nothing has a visible reason.
 */
export const MicToggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
  <button
    type="button"
    className="crt-toggle mic-toggle"
    aria-pressed={on}
    onClick={() => {
      playSfx('pick');
      onToggle();
    }}
  >
    MIC {on ? 'ON' : 'OFF'}
  </button>
);
