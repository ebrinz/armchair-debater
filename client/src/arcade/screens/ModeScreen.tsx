import { useEffect, useRef, useState } from 'react';

import { moveFocus } from '../gridNav';
import type { GridKey } from '../gridNav';
import '../mode.css';
import { MODES } from '../modes';
import { playSfx } from '../sfxPlayer';
import type { Mode } from '../types';

export interface ModeScreenProps {
  /** What the server has recorded, once it has: that tile locks in. */
  chosen: Mode | null;
  onMode: (mode: Mode) => void;
}

const NAV: string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/**
 * MODE SELECT — the front door. Three big tiles in a row; the arrows move, Enter
 * or a click chooses, and choosing only ever says out loud what the player could
 * have said themselves. As on the select screen, the server decides: a tile locks
 * in when the snapshot names the mode, however it was chosen.
 */
export const ModeScreen = ({ chosen, onMode }: ModeScreenProps) => {
  const [focused, setFocused] = useState(0);
  const [sent, setSent] = useState<Mode | null>(null);
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);
  const row = useRef<HTMLDivElement>(null);

  const locked = chosen ?? sent;
  const cursor = chosen ? MODES.findIndex((m) => m.id === chosen) : focused;

  // Roving focus, as on the roster: it follows the cursor only while the row has it.
  useEffect(() => {
    if (row.current?.contains(document.activeElement)) tiles.current[cursor]?.focus();
  }, [cursor]);

  const choose = (mode: Mode) => {
    if (locked) return;
    playSfx('pick');
    setSent(mode);
    onMode(mode);
  };

  return (
    <div className="mode">
      <header className="mode__head">
        <h2 className="mode__title pixel-text">Choose your game</h2>
        <p className="mode__sub">— or just say what you would like to do —</p>
      </header>

      <div
        className="mode__row"
        ref={row}
        role="group"
        aria-label="Game modes"
        onKeyDown={(event) => {
          if (!NAV.includes(event.key) || locked) return;
          event.preventDefault();
          const next = moveFocus(focused, event.key as GridKey, MODES.length, MODES.length);
          if (next !== focused) playSfx('cursor');
          setFocused(next);
        }}
      >
        {MODES.map((mode, i) => (
          <button
            key={mode.id}
            ref={(el) => {
              tiles.current[i] = el;
            }}
            type="button"
            className={[
              'mode__tile',
              `mode__tile--${mode.id}`,
              i === cursor ? 'mode__tile--focused' : '',
              locked === mode.id ? 'mode__tile--locked' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            tabIndex={i === cursor ? 0 : -1}
            disabled={locked !== null && locked !== mode.id}
            aria-current={locked === mode.id ? 'true' : undefined}
            onClick={() => choose(mode.id)}
            onFocus={() => !locked && setFocused(i)}
            onMouseEnter={() => {
              if (locked) return;
              if (i !== focused) playSfx('cursor');
              setFocused(i);
            }}
          >
            <span className="mode__name pixel-text">{mode.title}</span>
            <span className="mode__blurb">{mode.blurb}</span>
          </button>
        ))}
      </div>

      <p className="mode__status pixel-text" role="status">
        {locked ? `${MODES.find((m) => m.id === locked)?.title}…` : 'Arrow keys move · Enter chooses'}
      </p>
    </div>
  );
};
