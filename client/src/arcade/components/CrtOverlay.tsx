import { useEffect, useState } from 'react';

const KEY = 'arcade.crt';

/** Reads the remembered choice; the CRT is on until the player turns it off. */
const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

/**
 * Faint scanlines and a soft vignette over everything, with a toggle in the
 * corner. No curvature and no chromatic fringing — the spec asks for a light
 * CRT, not a simulated tube.
 */
export const CrtOverlay = () => {
  const [on, setOn] = useState(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // Private browsing, or storage disabled: the toggle still works for
      // this session, it just will not be remembered.
    }
  }, [on]);

  return (
    <>
      {on && <div className="crt-overlay" />}
      <button
        type="button"
        className="crt-toggle"
        aria-pressed={on}
        onClick={() => setOn((v) => !v)}
      >
        CRT {on ? 'ON' : 'OFF'}
      </button>
    </>
  );
};
