/**
 * One small emblem per theory, stitched onto the chair's headrest — what makes
 * the twelve armchairs twelve, rather than one chair in six colours.
 *
 * Each is a 7×5 bitmap: a `#` is one sprite pixel of thread. They are data so the
 * deck and the emblems cannot drift apart without a test saying so, and small
 * because the headrest gives five rows above the eyes and no more.
 */

export const EMBLEM_COLS = 7;
export const EMBLEM_ROWS = 5;

export const EMBLEMS: Record<string, string[]> = {
  // A signal going out to everything at once.
  gwt: [
    '.#####.',
    '#.....#',
    '..###..',
    '.#...#.',
    '...#...',
  ],
  // Phi.
  iit: [
    '...#...',
    '.#####.',
    '.#.#.#.',
    '.#####.',
    '...#...',
  ],
  // A thought about a thought: a frame within a frame.
  hot: [
    '#######',
    '#.....#',
    '#.###.#',
    '#.....#',
    '#######',
  ],
  // Feedforward, and back again.
  rpt: [
    '....#..',
    '######.',
    '.......',
    '.######',
    '..#....',
  ],
  // The prediction and the error riding on it.
  predictive_processing: [
    '.......',
    '#...#..',
    '.#.#.#.',
    '..#...#',
    '.......',
  ],
  // An eye, attending to its own attention.
  ast: [
    '..###..',
    '.#...#.',
    '#..#..#',
    '.#...#.',
    '..###..',
  ],
  // Is it really there?
  illusionism: [
    '.####..',
    '....#..',
    '..##...',
    '.......',
    '..#....',
  ],
  // Something that grows.
  biological_naturalism: [
    '...#...',
    '..###..',
    '.#####.',
    '...#...',
    '...#...',
  ],
  // The lattice of a microtubule wall.
  orch_or: [
    '#.#.#.#',
    '.#.#.#.',
    '#.#.#.#',
    '.#.#.#.',
    '#.#.#.#',
  ],
  // A little mind in every speck.
  panpsychism: [
    '#...#..',
    '..#...#',
    '.#..#..',
    '...#..#',
    '#.....#',
  ],
  // Two kinds of property, side by side.
  property_dualism: [
    '.##.##.',
    '#..#..#',
    '#..#..#',
    '.##.##.',
    '.......',
  ],
  // One mind, and everything else its light.
  analytic_idealism: [
    '#..#..#',
    '..###..',
    '#######',
    '..###..',
    '#..#..#',
  ],
};

export type Rect = [x: number, y: number, w: number, h: number];

/**
 * The emblem for `theoryId` as one-pixel rects with its top-left corner at
 * (`x0`, `y0`). `flipped` draws it back to front, for a sprite that is itself
 * drawn mirrored — the two flips cancel and the emblem reads the right way round.
 */
export const emblemRects = (
  theoryId: string | null | undefined,
  x0: number,
  y0: number,
  flipped = false
): Rect[] =>
  (theoryId ? (EMBLEMS[theoryId] ?? []) : []).flatMap((row, y) =>
    [...(flipped ? [...row].reverse() : row)].flatMap((mark, x): Rect[] =>
      mark === '#' ? [[x0 + x, y0 + y, 1, 1]] : []
    )
  );
