import { useEffect } from 'react';

import type { SfxName } from '../sfx';
import { playSfx } from '../sfxPlayer';

/**
 * Plays `name` each time `key` changes to something truthy — a hit count, a
 * stage, a countdown number. `null` for the name means "nothing to play now",
 * so callers can write the condition inline instead of wrapping the hook.
 */
export const useSfx = (name: SfxName | null, key: unknown, delayMs = 0): void => {
  useEffect(() => {
    if (!name || !key) return;
    if (!delayMs) return playSfx(name);
    const timer = window.setTimeout(() => playSfx(name), delayMs);
    return () => window.clearTimeout(timer);
  }, [name, key, delayMs]);
};
