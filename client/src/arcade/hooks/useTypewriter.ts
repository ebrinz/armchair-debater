import { useEffect, useState } from 'react';

import { useReducedMotion } from './useReducedMotion';

/**
 * How much of each line has been typed after `elapsedMs` at `cps` characters
 * per second — pure, so the stepping is unit-tested rather than eyeballed.
 *
 * Lines are typed strictly in order: a line does not start until the one
 * before it is finished. The result always has one entry per line, so the
 * caller can render the finished shape from the first frame and the box does
 * not reflow as the text arrives.
 */
export const typedPrefix = (lines: string[], elapsedMs: number, cps: number): string[] => {
  if (!(cps > 0)) return [...lines];
  let budget = Math.max(0, Math.floor((elapsedMs * cps) / 1000));
  return lines.map((line) => {
    const taken = Math.min(line.length, budget);
    budget -= taken;
    return line.slice(0, taken);
  });
};

export const TYPE_CPS = 40;

/**
 * Types `lines` out again on every change of `key`. Returns them in full, with
 * no animation, when `instant` is set or the reader asked for reduced motion.
 */
export const useTypewriter = (lines: string[], key: unknown, instant = false): string[] => {
  const reduced = useReducedMotion();
  const skip = instant || reduced;
  const [typed, setTyped] = useState<{ key: unknown; lines: string[] }>({ key: null, lines: [] });
  // A primitive stand-in for the array, so the effect can depend on the lines
  // themselves without a ref and without re-running on every render.
  const serialised = JSON.stringify(lines);

  useEffect(() => {
    if (skip) return;
    const current = JSON.parse(serialised) as string[];
    const total = current.reduce((n, line) => n + line.length, 0);
    const started = performance.now();
    let frame = 0;
    const step = () => {
      const elapsed = performance.now() - started;
      setTyped({ key, lines: typedPrefix(current, elapsed, TYPE_CPS) });
      if ((elapsed * TYPE_CPS) / 1000 < total) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, serialised, skip]);

  if (skip) return lines;
  // Until the first frame of a new hit lands, show the lines empty rather than
  // the previous hit's text.
  return typed.key === key ? typed.lines : lines.map(() => '');
};
