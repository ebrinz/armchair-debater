import type { CSSProperties, JSX } from 'react';

import type { Side } from '../types';

/**
 * The fighters: two rival wingbacks, drawn as inline SVG rects on a coarse
 * 32 x 40 grid so every edge stays hard at any scale.
 *
 * The anatomy is the joke, and it comes straight from the Style guide: the
 * wings are shoulders, two button-tufts on the backrest are the eyes, and the
 * seam across the seat cushion is the mouth. The chair is turned a few degrees
 * toward the centre of the room — the far wing is wide and shaded, the near
 * one foreshortened and rim-lit by the fire, and the eyes sit off-centre,
 * looking at the opponent.
 *
 * Every colour is a CSS custom property (`--chair-base` and friends, set per
 * variant in fight.css), so the same sprite serves the worn green challenger,
 * the studded oxblood champion, and — for a later task's card portraits — a
 * chair upholstered in any theory's type colour.
 *
 * What the component draws vs. what CSS drives: the props here decide which
 * PIXELS are drawn (eyes, tear, stuffing). How hard the chair rocks and
 * whether it flashes white are set by the caller as `--rock-deg` and
 * `--flash` on an ancestor, because those scale with the hit's tier and the
 * props the plan fixed for this component have no room for one.
 */

type Rect = [x: number, y: number, w: number, h: number];

const rects = (list: Rect[], fill: string, opacity?: number): JSX.Element[] =>
  list.map(([x, y, w, h]) => (
    <rect key={`${x},${y},${w},${h}`} x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />
  ));

const BASE = 'var(--chair-base)';
const LIGHT = 'var(--chair-light)';
const DARK = 'var(--chair-dark)';
const DEEP = 'var(--chair-deep)';
const PATCH = 'var(--chair-patch)';
const STUD = 'var(--chair-stud)';
const WOOD = '#2a1a10';
const STUFFING = '#f0e4c4';
const VOID = '#160e09';
const FIRELIGHT = '#e0662a';

/* ---------------------------------------------------------------- the masses */

/** The chair's outline, reused for the white hit flash and the heal glow. */
const SILHOUETTE: Rect[] = [
  [3, 3, 4, 1],
  [2, 4, 6, 21],
  [10, 4, 12, 1],
  [12, 3, 8, 1],
  [8, 5, 16, 20],
  [24, 5, 3, 1],
  [24, 6, 4, 19],
  [6, 24, 20, 4],
  [1, 21, 6, 10],
  [26, 22, 5, 9],
  [5, 27, 22, 6],
  [5, 33, 22, 2],
  [6, 35, 3, 4],
  [23, 35, 3, 4],
];

const REAR_LEGS: Rect[] = [
  [10, 33, 2, 5],
  [21, 33, 2, 5],
];

const FRONT_LEGS: Rect[] = [
  [6, 35, 3, 4],
  [23, 35, 3, 4],
];

/** Far wing: wide, and turned away from the fire, so it carries the shadow. */
const FAR_WING: JSX.Element[] = [
  ...rects([[3, 3, 4, 1]], DARK),
  ...rects([[2, 4, 6, 21]], DARK),
  ...rects(
    [
      [3, 5, 4, 19],
      [3, 4, 4, 1],
    ],
    DEEP
  ),
  ...rects([[7, 5, 1, 20]], VOID, 0.55),
];

/** Near wing: foreshortened, and catching the fire down its outer edge. */
const NEAR_WING: JSX.Element[] = [
  ...rects([[24, 5, 3, 1]], BASE),
  ...rects([[24, 6, 4, 19]], BASE),
  ...rects([[26, 6, 2, 19]], LIGHT),
  ...rects([[27, 7, 1, 17]], FIRELIGHT, 0.5),
];

/** The backrest: the face. Shaded left, lit right, so it reads as turned. */
const BACK_PANEL: JSX.Element[] = [
  ...rects(
    [
      [12, 3, 8, 1],
      [10, 4, 12, 1],
      [8, 5, 16, 20],
    ],
    BASE
  ),
  ...rects([[8, 5, 3, 20]], DARK),
  ...rects([[19, 5, 5, 20]], LIGHT),
  ...rects([[23, 6, 1, 18]], FIRELIGHT, 0.34),
  // quilting, kept to the lit side and well below the eyes so it never
  // competes with them for "face"
  ...rects(
    [
      [17, 17, 1, 1],
      [21, 18, 1, 1],
      [19, 21, 1, 1],
    ],
    VOID,
    0.5
  ),
];

const SEAT: JSX.Element[] = [
  ...rects([[6, 24, 20, 4]], LIGHT),
  ...rects([[6, 24, 20, 1]], BASE),
  ...rects([[5, 27, 22, 6]], BASE),
  ...rects([[5, 27, 22, 1]], DARK),
  ...rects([[5, 32, 22, 1]], DEEP),
  ...rects([[5, 33, 22, 2]], DEEP),
  ...rects([[5, 33, 22, 1]], DARK),
];

const ARMS: JSX.Element[] = [
  // far arm, in shade
  ...rects([[2, 20, 4, 1]], DARK),
  ...rects([[1, 21, 6, 10]], DARK),
  ...rects([[1, 22, 2, 9]], DEEP),
  // near arm, lit
  ...rects([[27, 21, 3, 1]], LIGHT),
  ...rects([[26, 22, 5, 9]], BASE),
  ...rects([[29, 22, 2, 9]], LIGHT),
  ...rects([[30, 23, 1, 7]], FIRELIGHT, 0.45),
];

const PATCHES: JSX.Element[] = [
  ...rects([[9, 17, 5, 5]], PATCH),
  ...rects(
    [
      [9, 17, 1, 1],
      [11, 17, 1, 1],
      [13, 17, 1, 1],
      [9, 19, 1, 1],
      [13, 19, 1, 1],
      [9, 21, 1, 1],
      [11, 21, 1, 1],
      [13, 21, 1, 1],
    ],
    VOID,
    0.7
  ),
  ...rects([[2, 24, 4, 3]], PATCH),
  ...rects(
    [
      [2, 24, 1, 1],
      [4, 24, 1, 1],
      [2, 26, 1, 1],
      [4, 26, 1, 1],
    ],
    VOID,
    0.7
  ),
  // scuffed leather
  ...rects(
    [
      [8, 30, 2, 1],
      [17, 31, 3, 1],
    ],
    LIGHT,
    0.5
  ),
];

const STUDS: JSX.Element[] = rects(
  [
    [2, 6, 1, 1],
    [2, 9, 1, 1],
    [2, 12, 1, 1],
    [2, 15, 1, 1],
    [2, 18, 1, 1],
    [2, 21, 1, 1],
    [27, 8, 1, 1],
    [27, 11, 1, 1],
    [27, 14, 1, 1],
    [27, 17, 1, 1],
    [27, 20, 1, 1],
    [7, 28, 1, 1],
    [11, 28, 1, 1],
    [15, 28, 1, 1],
    [19, 28, 1, 1],
    [23, 28, 1, 1],
    [2, 25, 1, 1],
    [2, 28, 1, 1],
    [29, 25, 1, 1],
    [29, 28, 1, 1],
  ],
  STUD
);

/** Split leather with the stuffing coming out of it — shown below 30 health. */
const TEAR: JSX.Element[] = [
  ...rects(
    [
      [16, 16, 2, 1],
      [17, 17, 2, 1],
      [16, 18, 3, 1],
      [18, 19, 2, 1],
      [17, 20, 2, 1],
      [13, 30, 3, 1],
    ],
    VOID
  ),
  ...rects(
    [
      [18, 15, 2, 2],
      [19, 17, 1, 1],
      [14, 18, 2, 1],
      [20, 19, 2, 2],
      [13, 29, 2, 1],
    ],
    STUFFING
  ),
];

/* ------------------------------------------------------------------ the eyes */

type EyeShape = 'open' | 'squeezed' | 'weary' | 'happy' | 'dead';

const EYE_Y = 11;
const EYE_X: [number, number] = [13, 19];

/** `inward` mirrors the chevron so a pair reads as `> <` rather than `> >`. */
const eye = (cx: number, shape: EyeShape, inward: 1 | -1): JSX.Element[] => {
  const dot = (dx: number, dy: number, fill: string) => ({ x: cx + dx, y: EYE_Y + dy, fill });
  const pixels =
    shape === 'squeezed'
      ? [
          dot(-2 * inward, -2, VOID),
          dot(-1 * inward, -1, VOID),
          dot(0, 0, VOID),
          dot(-1 * inward, 1, VOID),
          dot(-2 * inward, 2, VOID),
        ]
      : shape === 'happy'
        ? [dot(-2, 1, VOID), dot(-1, 0, VOID), dot(0, -1, VOID), dot(1, 0, VOID), dot(2, 1, VOID)]
        : shape === 'dead'
          ? [
              dot(-2, -2, VOID),
              dot(-1, -1, VOID),
              dot(0, 0, VOID),
              dot(1, 1, VOID),
              dot(1, -2, VOID),
              dot(0, -1, VOID),
              dot(-1, 0, VOID),
              dot(-2, 1, VOID),
            ]
          : [];

  if (pixels.length) {
    return pixels.map((p, i) => (
      <rect key={`${cx}-${shape}-${i}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
    ));
  }

  if (shape === 'weary') {
    return [
      <rect key={`${cx}-lid`} x={cx - 2} y={EYE_Y - 2} width={4} height={2} fill={DARK} />,
      <rect key={`${cx}-slit`} x={cx - 2} y={EYE_Y} width={4} height={1} fill={VOID} />,
    ];
  }

  // Idle: a button sunk into a dimple, with one pixel of firelight on it.
  return [
    <rect key={`${cx}-dimple`} x={cx - 2} y={EYE_Y - 2} width={4} height={4} fill={DARK} />,
    <rect key={`${cx}-ring`} x={cx - 2} y={EYE_Y + 1} width={4} height={1} fill={LIGHT} opacity={0.5} />,
    <rect key={`${cx}-pupil`} x={cx - 1} y={EYE_Y - 1} width={2} height={2} fill={VOID} />,
    <rect key={`${cx}-glint`} x={cx - 1} y={EYE_Y - 1} width={1} height={1} fill="#f6e9cc" />,
  ];
};

/* ------------------------------------------------------------------ the mouth */

/** The seat-cushion seam. It parts when that side's voice is coming through. */
const mouth = (open: number): JSX.Element[] => {
  const y = 30 - Math.floor(open / 2);
  const h = 1 + open;
  return [
    <rect key="seam" x={10} y={y} width={12} height={h} fill={VOID} />,
    <rect key="lip-l" x={9} y={y} width={1} height={1} fill={VOID} opacity={0.7} />,
    <rect key="lip-r" x={22} y={y} width={1} height={1} fill={VOID} opacity={0.7} />,
    ...(open > 0 ? rects([[11, y + h - 1, 10, 1]], '#3a1712') : []),
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

/** At most three sprite pixels of bob — about 24 screen pixels at desktop size. */
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
  const bob = Math.round(Math.max(0, Math.min(1, level)) * MAX_BOB);
  const open = Math.round(Math.max(0, Math.min(1, level)) * MAX_MOUTH);

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
      viewBox="0 0 32 40"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={side === 'bot' ? 'translate(32,0) scale(-1,1)' : undefined}>
        <g className="armchair__rock">
          <g className="armchair__bob" transform={bob ? `translate(0 ${-bob})` : undefined}>
            {rects([[3, 38, 26, 2]], '#090604', 0.45)}
            {rects(REAR_LEGS, '#1d120b')}
            {FAR_WING}
            {BACK_PANEL}
            {typed ? null : variant === 'challenger' ? PATCHES : STUDS}
            {low ? TEAR : null}
            {eye(EYE_X[0], eyeShape, 1)}
            {eye(EYE_X[1], eyeShape, -1)}
            {NEAR_WING}
            {SEAT}
            {ARMS}
            {mouth(open)}
            {rects(FRONT_LEGS, WOOD)}
            {rects(
              [
                [6, 35, 1, 4],
                [23, 35, 1, 4],
              ],
              '#170e07'
            )}
            <g className="armchair__flash">{rects(SILHOUETTE, '#ffffff')}</g>
            <g className="armchair__heal">{rects(SILHOUETTE, 'var(--heal)')}</g>
          </g>
        </g>
      </g>
    </svg>
  );
};
