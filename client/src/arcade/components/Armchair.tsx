import type { CSSProperties, JSX } from 'react';

import type { Side } from '../types';

/**
 * The fighters: two rival wingbacks, drawn as inline SVG rects on a coarse
 * 32 x 44 grid so every edge stays hard at any scale.
 *
 * The anatomy is the joke, and it comes straight from the Style guide: the
 * wings are shoulders — they stand proud of the arched backrest, which is why
 * the silhouette reads as a wingback and not a slab — two button-tufts on the
 * backrest are the eyes, and the seam across the seat cushion is the mouth.
 * The chair is turned toward the centre of the room: the far wing shows its
 * outer thickness and carries the shadow, the near one is foreshortened and
 * rim-lit by the fire, the arms roll forward past both, and the face sits off
 * to the near side, looking at the opponent.
 *
 * Every colour is a CSS custom property (`--chair-base` and friends, set per
 * variant in fight.css), so the same sprite serves the worn green challenger,
 * the studded oxblood champion, and — for a later task's card portraits — a
 * chair upholstered in any theory's type colour.
 *
 * What the component draws vs. what CSS drives: the props here decide which
 * PIXELS are drawn (eyes, tear, stuffing, mouth). How hard the chair rocks
 * back and whether it flashes white are set by the caller as `--rock-deg` and
 * `--flash` on an ancestor, because those scale with the hit's tier and the
 * props the plan fixed for this component have no room for one.
 */

type Rect = [x: number, y: number, w: number, h: number];

/**
 * One layer of the sprite. Every call needs an `id`, because the layers are
 * spliced into the same parent as siblings and a bare index would collide.
 */
const rects = (id: string, list: Rect[], fill: string, opacity?: number): JSX.Element[] =>
  list.map(([x, y, w, h], i) => (
    <rect key={`${id}${i}`} x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />
  ));

const BASE = 'var(--chair-base)';
const LIGHT = 'var(--chair-light)';
const DARK = 'var(--chair-dark)';
const DEEP = 'var(--chair-deep)';
const PATCH = 'var(--chair-patch)';
const STUD = 'var(--chair-stud)';
const STUFFING = '#f0e4c4';
const VOID = '#130d08';
const FIRELIGHT = '#e0662a';

/* ---------------------------------------------------------------- the masses */

/**
 * The chair's outline. Drawn three times: grown by a pixel in near-black as a
 * keyline that lifts the sprite off the busy bookshelves behind it, then in
 * white for the hit flash and in green for the heal glow.
 */
const SILHOUETTE: Rect[] = [
  [12, 4, 8, 1],
  [10, 5, 12, 2],
  [8, 7, 16, 20],
  [4, 2, 6, 21],
  [3, 5, 1, 18],
  [23, 3, 5, 20],
  [1, 21, 9, 14],
  [22, 22, 9, 13],
  [9, 24, 14, 11],
  [5, 35, 22, 3],
  [7, 38, 4, 5],
  [21, 38, 4, 5],
  [6, 42, 6, 1],
  [20, 42, 6, 1],
];

/** The same shapes, grown a pixel all round: the sprite's keyline. */
const OUTLINE: Rect[] = SILHOUETTE.map(([x, y, w, h]) => [x - 1, y - 1, w + 2, h + 2]);

/** Far wing: standing proud of the back, showing its outer thickness, in shade. */
const FAR_WING: JSX.Element[] = [
  ...rects('L1', [[5, 2, 5, 1]], BASE),
  ...rects('L2', [[4, 3, 6, 20]], DARK),
  ...rects('L3', [[3, 5, 1, 18]], DEEP),
  ...rects('L4', [[4, 4, 1, 19]], DEEP),
  ...rects('L5', [[9, 7, 1, 16]], VOID, 0.5),
];

/** Near wing: foreshortened, catching the fire down its outer edge. */
const NEAR_WING: JSX.Element[] = [
  ...rects('L6', [[23, 3, 4, 1]], LIGHT),
  ...rects('L7', [[23, 4, 5, 19]], BASE),
  ...rects('L8', [[26, 4, 2, 19]], LIGHT),
  ...rects('L9', [[27, 5, 1, 17]], FIRELIGHT, 0.5),
  ...rects('L10', [[23, 7, 1, 16]], VOID, 0.4),
];

/** The backrest: the face, under a camel arch. Shaded left, lit right. */
const BACK_PANEL: JSX.Element[] = [
  ...rects(
    'L11',
    [
      [12, 4, 8, 1],
      [10, 5, 12, 1],
      [8, 6, 16, 1],
    ],
    LIGHT,
  ),
  ...rects('L12', [[8, 7, 16, 20]], BASE),
  ...rects('L13', [[8, 7, 3, 20]], DARK),
  ...rects('L14', [[22, 7, 2, 20]], LIGHT),
  ...rects('L15', [[23, 8, 1, 18]], FIRELIGHT, 0.26),
  // quilting, kept off the face so it never competes with the eyes
  ...rects(
    'L16',
    [
      [11, 22, 1, 1],
      [21, 23, 1, 1],
    ],
    VOID,
    0.45,
  ),
];

const SEAT: JSX.Element[] = [
  // the cushion top, drawn as a shallow trapezoid so it sits in perspective
  ...rects('L17', [[10, 24, 12, 1]], LIGHT),
  ...rects('L18', [[9, 25, 14, 2]], LIGHT),
  ...rects('L19', [[9, 25, 14, 1]], BASE),
  ...rects('L20', [[9, 27, 14, 1]], DARK),
  ...rects('L21', [[9, 28, 14, 7]], BASE),
  ...rects('L22', [[9, 34, 14, 1]], DEEP),
];

const ARMS: JSX.Element[] = [
  // far arm, rolling forward past the wing above it
  ...rects('L23', [[1, 21, 9, 2]], DARK),
  ...rects('L24', [[1, 21, 9, 1]], BASE),
  ...rects('L25', [[1, 23, 9, 12]], DARK),
  ...rects('L26', [[1, 23, 2, 12]], DEEP),
  ...rects('L27', [[9, 23, 1, 12]], VOID, 0.4),
  // near arm, lit
  ...rects('L28', [[22, 22, 9, 2]], LIGHT),
  ...rects('L29', [[22, 24, 9, 11]], BASE),
  ...rects('L30', [[28, 24, 3, 11]], LIGHT),
  ...rects('L31', [[30, 25, 1, 9]], FIRELIGHT, 0.45),
  ...rects('L32', [[22, 24, 1, 11]], VOID, 0.35),
];

const SKIRT: JSX.Element[] = [
  ...rects('L33', [[5, 35, 22, 3]], DEEP),
  ...rects('L34', [[5, 35, 22, 1]], DARK),
];

const LEGS: JSX.Element[] = [
  ...rects('L35', [[3, 36, 2, 5]], '#1d120b'),
  ...rects(
    'L36',
    [
      [7, 38, 4, 4],
      [21, 38, 4, 4],
      [6, 42, 6, 1],
      [20, 42, 6, 1],
    ],
    '#6b4a28',
  ),
  ...rects(
    'L37',
    [
      [7, 38, 1, 4],
      [21, 38, 1, 4],
      [6, 42, 1, 1],
      [20, 42, 1, 1],
    ],
    '#2a1a10',
  ),
];

const PATCHES: JSX.Element[] = [
  ...rects('L38', [[2, 26, 5, 4]], PATCH),
  ...rects(
    'L39',
    [
      [2, 26, 1, 1],
      [4, 26, 1, 1],
      [6, 26, 1, 1],
      [2, 29, 1, 1],
      [4, 29, 1, 1],
      [6, 29, 1, 1],
    ],
    VOID,
    0.75,
  ),
  ...rects('L40', [[24, 16, 4, 4]], PATCH),
  ...rects(
    'L41',
    [
      [24, 16, 1, 1],
      [27, 16, 1, 1],
      [24, 19, 1, 1],
      [27, 19, 1, 1],
    ],
    VOID,
    0.75,
  ),
  // scuffed leather
  ...rects(
    'L42',
    [
      [19, 29, 3, 1],
      [11, 33, 3, 1],
    ],
    LIGHT,
    0.38,
  ),
];

const STUDS: JSX.Element[] = rects(
  'L43',
  [
    [4, 6, 1, 1],
    [4, 9, 1, 1],
    [4, 12, 1, 1],
    [4, 15, 1, 1],
    [4, 18, 1, 1],
    [4, 21, 1, 1],
    [27, 6, 1, 1],
    [27, 9, 1, 1],
    [27, 12, 1, 1],
    [27, 15, 1, 1],
    [27, 18, 1, 1],
    [27, 21, 1, 1],
    [10, 27, 1, 1],
    [13, 27, 1, 1],
    [16, 27, 1, 1],
    [19, 27, 1, 1],
    [22, 27, 1, 1],
    [2, 26, 1, 1],
    [2, 31, 1, 1],
    [29, 27, 1, 1],
    [29, 32, 1, 1],
  ],
  STUD,
);

/** Split leather with the stuffing coming out of it — shown below 30 health. */
const TEAR: JSX.Element[] = [
  ...rects(
    'L44',
    [
      [17, 18, 2, 1],
      [18, 19, 2, 1],
      [16, 20, 3, 1],
      [18, 21, 2, 1],
      [17, 22, 2, 1],
      [18, 23, 2, 1],
      [11, 33, 4, 1],
    ],
    VOID,
  ),
  ...rects(
    'L45',
    [
      [19, 17, 2, 2],
      [14, 19, 2, 1],
      [20, 21, 2, 2],
      [15, 22, 2, 1],
      [11, 32, 3, 1],
    ],
    STUFFING,
  ),
];

/* ------------------------------------------------------------------ the eyes */

type EyeShape = 'open' | 'squeezed' | 'weary' | 'happy' | 'dead';

const EYE_Y = 13;
const EYE_X: [number, number] = [13, 20];

/** `inward` mirrors the chevron so a squeezed pair reads `> <`, not `> >`. */
const eye = (cx: number, shape: EyeShape, inward: 1 | -1): JSX.Element[] => {
  const at = (dx: number, dy: number): Rect => [cx + dx * inward, EYE_Y + dy, 2, 1];
  const flat = (dx: number, dy: number): Rect => [cx + dx, EYE_Y + dy, 2, 1];

  if (shape === 'squeezed') {
    return rects(`L46-${cx}`, [at(-2, -2), at(-1, -1), at(0, 0), at(-1, 1), at(-2, 2)], VOID);
  }
  if (shape === 'happy') {
    return rects(`L47-${cx}`, [flat(-2, 1), flat(-1, 0), flat(0, -1), flat(1, 0), flat(2, 1)], VOID);
  }
  if (shape === 'dead') {
    return rects(
      `L48-${cx}`,
      [
        flat(-2, -2),
        flat(-1, -1),
        flat(0, 0),
        flat(1, 1),
        flat(1, -2),
        flat(0, -1),
        flat(-1, 0),
        flat(-2, 1),
      ],
      VOID,
    );
  }
  if (shape === 'weary') {
    return [
      ...rects(`L49-${cx}`, [[cx - 2, EYE_Y - 2, 5, 2]], DARK),
      ...rects(`L50-${cx}`, [[cx - 2, EYE_Y, 5, 1]], VOID),
      ...rects(`L51-${cx}`, [[cx - 2, EYE_Y + 1, 5, 1]], DEEP),
    ];
  }

  // Idle: a button sunk into a dimple, the leather bunching below it.
  return [
    ...rects(`L52-${cx}`, [[cx - 2, EYE_Y - 2, 5, 5]], DARK),
    ...rects(`L53-${cx}`, [[cx - 2, EYE_Y - 2, 5, 1]], DEEP),
    ...rects(`L54-${cx}`, [[cx - 1, EYE_Y - 1, 3, 3]], VOID),
    ...rects(`L55-${cx}`, [[cx - 1, EYE_Y - 1, 1, 1]], '#f6e9cc'),
    ...rects(`L56-${cx}`, [[cx - 2, EYE_Y + 3, 5, 1]], LIGHT, 0.45),
    // a lit edge on the dimple, so the button sits proud of the leather
    ...rects(`L57-${cx}`, [[cx + 2, EYE_Y - 1, 1, 4]], LIGHT, 0.55),
  ];
};

/* ------------------------------------------------------------------ the mouth */

const MOUTH_Y = 31;

/** The seat-cushion seam. It parts when that side's voice is coming through. */
const mouth = (open: number): JSX.Element[] => {
  const y = MOUTH_Y - Math.floor(open / 2);
  const h = 1 + open;
  return [
    ...rects('L57', [[12, y, 10, h]], VOID),
    ...rects(
      'L58',
      [
        [11, y + h - 1, 1, 1],
        [22, y + h - 1, 1, 1],
      ],
      VOID,
      0.75,
    ),
    ...(open > 0 ? rects('L59', [[13, y + h - 1, 8, 1]], '#42180f') : []),
  ];
};

/* ------------------------------------------------------------------ the props */

export type ArmchairVariant = 'challenger' | 'champion' | { typeColorVar: string };

export interface ArmchairProps {
  /** Which side of the fire it stands on; `bot` is mirrored. */
  side: Side;
  variant: ArmchairVariant;
  /** That side's live audio level, 0..1. Drives the bob and the mouth. */
  level: number;
  hurt: boolean;
  healed: boolean;
  /** 0..100. Below 30 the chair splits open and slumps. */
  health: number;
  pose?: 'idle' | 'win' | 'lose';
  className?: string;
}

/** At most three sprite pixels of bob — around 24 screen pixels at fight size. */
const MAX_BOB = 3;
const MAX_MOUTH = 3;

export const Armchair = ({
  side,
  variant,
  level,
  hurt,
  healed,
  health,
  pose = 'idle',
  className,
}: ArmchairProps) => {
  const typed = typeof variant === 'object';
  const low = health < 30 || pose === 'lose';
  const clamped = Math.max(0, Math.min(1, level));
  const bob = Math.round(clamped * MAX_BOB);
  const open = Math.round(clamped * MAX_MOUTH);

  const eyeShape: EyeShape = hurt
    ? 'squeezed'
    : pose === 'lose'
      ? 'dead'
      : pose === 'win'
        ? 'happy'
        : health < 30
          ? 'weary'
          : 'open';

  const classes = [
    'armchair',
    typed ? 'armchair--type' : `armchair--${variant}`,
    `armchair--${side}`,
    hurt ? 'armchair--hurt' : '',
    healed ? 'armchair--healed' : '',
    low ? 'armchair--low' : '',
    pose !== 'idle' ? `armchair--${pose}` : '',
    level > 0 ? 'armchair--talking' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const style = typed ? ({ '--chair-base': `var(${variant.typeColorVar})` } as CSSProperties) : undefined;

  return (
    <svg
      className={classes}
      style={style}
      viewBox="0 0 32 44"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={side === 'bot' ? 'translate(32,0) scale(-1,1)' : undefined}>
        <g className="armchair__rock">
          <g className="armchair__bob" transform={bob ? `translate(0 ${-bob})` : undefined}>
            {rects('L60', [[4, 42, 24, 2]], '#090604', 0.5)}
            {rects('L61', OUTLINE, '#120c08')}
            {FAR_WING}
            {BACK_PANEL}
            {eye(EYE_X[0], eyeShape, 1)}
            {eye(EYE_X[1], eyeShape, -1)}
            {NEAR_WING}
            {SEAT}
            {ARMS}
            {/* Trim last: the patches and studs sit ON the arms, the wings and
                the seat welt, so they have to be painted after them. */}
            {typed ? null : variant === 'challenger' ? PATCHES : STUDS}
            {low ? TEAR : null}
            {mouth(open)}
            {SKIRT}
            {LEGS}
            <g className="armchair__flash">{rects('L62', SILHOUETTE, '#ffffff')}</g>
            <g className="armchair__heal">{rects('L63', SILHOUETTE, 'var(--heal)')}</g>
          </g>
        </g>
      </g>
    </svg>
  );
};
