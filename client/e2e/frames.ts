import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Frame = Record<string, unknown> & { stage: string };

const read = (name: string): Frame[] =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../src/arcade/fixtures/${name}-state.json`, import.meta.url)), 'utf8')
  );

const FIXTURES: Record<string, Frame[]> = {
  debate: read('debate'),
  learn: read('learn'),
  sparring: read('sparring'),
};

/** The index of the first fixture frame in `mode` that satisfies `pick`. */
export const frameIndex = (mode: 'debate' | 'learn' | 'sparring', pick: (f: Frame) => boolean): number => {
  const index = FIXTURES[mode].findIndex(pick);
  if (index < 0) throw new Error(`no ${mode} frame matches`);
  return index;
};
