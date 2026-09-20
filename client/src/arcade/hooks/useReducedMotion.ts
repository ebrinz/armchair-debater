import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * arcade.css already kills every CSS animation and transition under this
 * query. This hook is for the motion that CSS cannot see: typing, hit-stop
 * timers, and the audio-level bob, all of which are driven from JS.
 */
export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
};
