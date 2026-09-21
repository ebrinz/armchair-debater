import { useState } from 'react';

import { isMuted, playSfx, setMuted } from '../sfxPlayer';

/** The sound effects' mute, beside the CRT toggle and remembered the same way. */
export const SfxToggle = () => {
  const [on, setOn] = useState(() => !isMuted());

  return (
    <button
      type="button"
      className="crt-toggle sfx-toggle"
      aria-pressed={on}
      onClick={() => {
        setMuted(on);
        setOn(!on);
        // Turning it on answers with a sound, so the player hears that it worked.
        if (!on) playSfx('pick');
      }}
    >
      SFX {on ? 'ON' : 'OFF'}
    </button>
  );
};
