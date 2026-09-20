import type { JSX } from 'react';

/**
 * The stage: a wood-panelled study at night, drawn as inline SVG rects on a
 * coarse 160 × 100 grid. One fire, centred, with the floor either side of it
 * left clear for the two armchairs (task U.3).
 *
 * Scaling. The scene is drawn once at 1.6:1 and painted with
 * `preserveAspectRatio="xMidYMax slice"`, so it always covers the viewport and
 * always keeps the floor. A 1280 × 800 desktop is an exact fit; a wider screen
 * loses ceiling; a 375 × 667 phone keeps only the middle 56 units — which is
 * exactly the fireplace and the bookcase either side of it. The composition is
 * built around that crop, and the wall and floor colours are repeated in CSS
 * (`.stage` in arcade.css) so no aspect ratio can expose an unpainted edge.
 *
 * Cost. Every element below is built once, at module load, and reused; the
 * flicker is three CSS `steps()` animations. Nothing runs per frame.
 */

const FLOOR_Y = 72;

/* ------------------------------------------------------------------ helpers */

/** mulberry32 — a tiny deterministic PRNG, so the shelves look hand-stocked
 *  but are identical on every load. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SPINES = [
  '#5c1a22',
  '#2f4a2a',
  '#3b2a4d',
  '#7a5a2a',
  '#2e3f5c',
  '#6b2f1f',
  '#8a7048',
  '#332a24',
  '#754c20',
  '#44262c',
];

/** One bookcase: carcass, shelf boards, and a run of varied spines per shelf. */
const bookcase = (
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  shelves: number,
  seed: number
): JSX.Element => {
  const next = rng(seed);
  const gap = h / shelves;
  const parts: JSX.Element[] = [
    <rect key="back" x={x} y={y} width={w} height={h} fill="#1d120b" />,
    <rect key="l" x={x} y={y} width={1} height={h} fill="#4a3120" />,
    <rect key="r" x={x + w - 1} y={y} width={1} height={h} fill="#4a3120" />,
    <rect key="t" x={x} y={y} width={w} height={1} fill="#5a3a22" />,
  ];

  for (let s = 0; s < shelves; s += 1) {
    const board = Math.round(y + gap * (s + 1));
    parts.push(
      <rect key={`b${s}`} x={x} y={board - 1} width={w} height={1} fill="#4a3120" />
    );
    let bx = x + 1;
    const limit = x + w - 1;
    while (bx < limit) {
      const bw = Math.min(1 + Math.floor(next() * 3), limit - bx);
      const bh = 5 + Math.floor(next() * (gap - 5));
      const top = board - 1 - bh;
      // A gap in the row now and then: a leaning book, or nothing at all.
      if (next() > 0.09) {
        parts.push(
          <rect
            key={`s${s}-${bx}`}
            x={bx}
            y={top}
            width={bw}
            height={bh}
            fill={SPINES[Math.floor(next() * SPINES.length)]}
          />
        );
        if (bw > 1 && next() > 0.72) {
          parts.push(
            <rect
              key={`g${s}-${bx}`}
              x={bx}
              y={top + Math.floor(bh / 2)}
              width={bw}
              height={1}
              fill="#c9a227"
            />
          );
        }
      }
      bx += bw;
    }
  }
  return <g key={key}>{parts}</g>;
};

/** Vertical wainscot panelling, repeated across the wall. */
const PANELLING: JSX.Element = (
  <g>
    <rect x={0} y={0} width={160} height={FLOOR_Y} fill="#2b1d14" />
    {Array.from({ length: 21 }, (_, i) => (
      <rect key={i} x={i * 8} y={0} width={1} height={FLOOR_Y} fill="#221609" />
    ))}
    {/* cornice and picture rail */}
    <rect x={0} y={0} width={160} height={4} fill="#241810" />
    <rect x={0} y={4} width={160} height={1} fill="#5a3a22" />
    {/* skirting */}
    <rect x={0} y={FLOOR_Y - 3} width={160} height={3} fill="#241810" />
    <rect x={0} y={FLOOR_Y - 4} width={160} height={1} fill="#5a3a22" />
  </g>
);

/* -------------------------------------------------------------------- floor */

const FLOOR: JSX.Element = (
  <g>
    <rect x={0} y={FLOOR_Y} width={160} height={100 - FLOOR_Y} fill="#3a2717" />
    {[75, 79, 84, 90, 96].map((y) => (
      <rect key={y} x={0} y={y} width={160} height={1} fill="#2e1e12" />
    ))}
    {[18, 62, 104, 140].map((x) => (
      <rect key={x} x={x} y={FLOOR_Y} width={1} height={28} fill="#2e1e12" />
    ))}
  </g>
);

/** A Persian rug in place of an arena floor: navy border, oxblood field,
 *  a cream medallion on the centre line, under the fire. */
const RUG: JSX.Element = (
  <g>
    <rect x={12} y={79} width={136} height={21} fill="#23334d" />
    <rect x={15} y={81} width={130} height={19} fill="#6b1f22" />
    <rect x={17} y={83} width={126} height={1} fill="#d9c79a" />
    {/* fretwork along the top border */}
    {Array.from({ length: 33 }, (_, i) => (
      <rect key={`f${i}`} x={14 + i * 4} y={79} width={2} height={1} fill="#d9c79a" />
    ))}
    {/* the medallion, blocky, centred on the fire */}
    {[
      [78, 86, 4, 1],
      [75, 87, 10, 1],
      [73, 88, 14, 2],
      [71, 90, 18, 2],
      [73, 92, 14, 2],
      [75, 94, 10, 1],
      [78, 95, 4, 1],
    ].map(([x, y, w, h]) => (
      <rect key={`m${y}`} x={x} y={y} width={w} height={h} fill="#d9c79a" />
    ))}
    {[
      [77, 88, 6, 1],
      [75, 90, 10, 2],
      [77, 92, 6, 1],
    ].map(([x, y, w, h]) => (
      <rect key={`mi${y}`} x={x} y={y} width={w} height={h} fill="#23334d" />
    ))}
    {/* corner motifs */}
    {[26, 42, 118, 134].map((x) => (
      <g key={`c${x}`}>
        <rect x={x + 2} y={87} width={2} height={1} fill="#d9c79a" />
        <rect x={x} y={88} width={6} height={2} fill="#d9c79a" />
        <rect x={x + 2} y={90} width={2} height={1} fill="#d9c79a" />
        <rect x={x + 2} y={88} width={2} height={2} fill="#8a3038" />
      </g>
    ))}
  </g>
);

/* ------------------------------------------------------------------- window */

const WINDOW: JSX.Element = (
  <g>
    <rect x={29} y={12} width={22} height={40} fill="#4a3120" />
    <rect x={31} y={14} width={18} height={36} fill="#101a2e" />
    {/* stars */}
    {[
      [34, 18],
      [36, 17],
      [38, 24],
      [47, 28],
      [33, 33],
      [43, 38],
      [36, 44],
      [48, 45],
      [33, 21],
    ].map(([x, y]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#cfe0ff" />
    ))}
    {/* a blocky crescent moon, tips up and down, thick on the far side */}
    <g>
      {[
        [44, 18, 1],
        [45, 19, 2],
        [46, 20, 2],
        [46, 21, 2],
        [46, 22, 2],
        [45, 23, 2],
        [44, 24, 1],
      ].map(([x, y, w]) => (
        <rect key={`moon${y}`} x={x} y={y} width={w} height={1} fill="#e8e6cf" />
      ))}
    </g>
    {/* muntins and sill */}
    <rect x={39} y={14} width={2} height={36} fill="#4a3120" />
    <rect x={31} y={31} width={18} height={2} fill="#4a3120" />
    <rect x={27} y={52} width={26} height={2} fill="#5a3a22" />
    {/* wainscot below the window */}
    <rect x={29} y={54} width={22} height={FLOOR_Y - 58} fill="#241810" />
    <rect x={32} y={57} width={16} height={FLOOR_Y - 64} fill="#2a1a11" stroke="#4a3120" strokeWidth={1} />
  </g>
);

/* ---------------------------------------------------------------- fireplace */

/** A stack of rects, widest at the base: the pixel silhouette of a flame. */
const flameGroup = (
  cls: string,
  fill: string,
  rows: readonly (readonly [number, number, number, number])[]
): JSX.Element => (
  <g className={`flame ${cls}`}>
    {rows.map(([x, y, w, h]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill={fill} />
    ))}
  </g>
);

const FIREPLACE: JSX.Element = (
  <g>
    {/* chimney breast, coursed stone */}
    <rect x={62} y={4} width={36} height={FLOOR_Y - 4} fill="#3c2a1e" />
    {[10, 16, 22, 28, 40, 46, 52, 58, 64, 70].map((y) => (
      <rect key={y} x={62} y={y} width={36} height={1} fill="#31221a" />
    ))}
    <rect x={62} y={4} width={1} height={FLOOR_Y - 4} fill="#4d3727" />
    <rect x={97} y={4} width={1} height={FLOOR_Y - 4} fill="#2a1d15" />

    {/* framed portrait over the mantel */}
    <rect x={69} y={8} width={22} height={20} fill="#8a6a2a" />
    <rect x={71} y={10} width={18} height={16} fill="#1c2230" />
    <rect x={77} y={13} width={6} height={5} fill="#6b5b45" />
    <rect x={75} y={18} width={10} height={8} fill="#3c3a44" />

    {/* mantel shelf */}
    <rect x={58} y={30} width={44} height={4} fill="#5a3a22" />
    <rect x={58} y={30} width={44} height={1} fill="#7a5232" />
    {/* candlestick and a carriage clock */}
    <rect x={62} y={25} width={2} height={5} fill="#c9a227" />
    <rect x={61} y={24} width={4} height={1} fill="#c9a227" />
    <rect x={62} y={21} width={1} height={3} fill="#f6e9cc" />
    <rect x={62} y={20} width={1} height={1} fill="#f2c14e" />
    <rect x={94} y={24} width={6} height={6} fill="#8a6a2a" />
    <rect x={95} y={25} width={4} height={4} fill="#1c2230" />
    <rect x={96} y={26} width={1} height={2} fill="#f6e9cc" />

    {/* opening, with a stepped pixel arch */}
    <rect x={67} y={44} width={26} height={FLOOR_Y - 46} fill="#0a0705" />
    <rect x={69} y={41} width={22} height={3} fill="#0a0705" />
    <rect x={72} y={39} width={16} height={2} fill="#0a0705" />
    <rect x={76} y={38} width={8} height={1} fill="#0a0705" />
    {/* arch stones */}
    <rect x={65} y={44} width={2} height={26} fill="#4d3727" />
    <rect x={93} y={44} width={2} height={26} fill="#4d3727" />
    <rect x={67} y={42} width={2} height={2} fill="#4d3727" />
    <rect x={91} y={42} width={2} height={2} fill="#4d3727" />
    <rect x={69} y={39} width={3} height={2} fill="#4d3727" />
    <rect x={88} y={39} width={3} height={2} fill="#4d3727" />
    <rect x={72} y={37} width={16} height={1} fill="#4d3727" />

    {/* hearthstone */}
    <rect x={63} y={FLOOR_Y - 2} width={34} height={4} fill="#56483a" />
    <rect x={63} y={FLOOR_Y - 2} width={34} height={1} fill="#6b5a49" />

    {/* grate, logs, embers */}
    {[70, 73, 76, 79, 82, 85, 88].map((x) => (
      <rect key={x} x={x} y={65} width={1} height={5} fill="#241a14" />
    ))}
    <rect x={71} y={65} width={18} height={3} fill="#3b2318" />
    <rect x={73} y={62} width={14} height={3} fill="#4a2c1c" />
    <rect x={72} y={68} width={16} height={2} fill="#b3271f" />
    <rect x={75} y={67} width={10} height={1} fill="#e0662a" />

    {/* Deliberately off-centre: a symmetrical triangle reads as a road sign. */}
    {flameGroup('flame--outer', '#a3241c', [
      [72, 62, 16, 3],
      [73, 59, 14, 3],
      [74, 56, 11, 3],
      [76, 53, 8, 3],
      [78, 50, 6, 3],
      [80, 47, 3, 3],
      [80, 44, 2, 3],
      [76, 55, 2, 2],
    ])}
    {flameGroup('flame--mid', '#e0662a', [
      [74, 62, 12, 3],
      [75, 59, 10, 3],
      [76, 56, 8, 3],
      [77, 53, 5, 3],
      [79, 50, 4, 3],
      [80, 47, 2, 3],
    ])}
    {flameGroup('flame--core', '#f2c14e', [
      [76, 62, 8, 3],
      [77, 59, 6, 3],
      [78, 56, 4, 3],
      [79, 53, 2, 3],
      [79, 51, 2, 2],
    ])}
    {flameGroup('flame--core', '#fdf3c9', [
      [78, 62, 4, 3],
      [79, 59, 2, 3],
    ])}
  </g>
);

/** What the fire throws onto the room. Stepped, like everything else. */
const FIRELIGHT: JSX.Element = (
  <g className="firelight">
    <polygon points="67,70 93,70 124,100 36,100" fill="#e0662a" opacity={0.1} />
    <polygon points="70,68 90,68 106,86 54,86" fill="#f2c14e" opacity={0.08} />
    <rect x={54} y={36} width={52} height={36} fill="#e0662a" opacity={0.07} />
    <rect x={62} y={28} width={36} height={44} fill="#f2c14e" opacity={0.06} />
  </g>
);

/* -------------------------------------------------------------------- scene */

const SCENE: JSX.Element = (
  <>
    {PANELLING}
    {bookcase('left', 2, 6, 25, FLOOR_Y - 10, 6, 0x5eed1)}
    {WINDOW}
    {bookcase('mid', 53, 6, 9, FLOOR_Y - 10, 6, 0x5eed2)}
    {FIREPLACE}
    {bookcase('right-a', 99, 6, 26, FLOOR_Y - 10, 6, 0x5eed3)}
    {bookcase('right-b', 127, 6, 31, FLOOR_Y - 10, 6, 0x5eed4)}
    {FLOOR}
    {RUG}
    {FIRELIGHT}
  </>
);

export interface StageProps {
  /** Darken the whole stage — title, select, and decision sit on top of it. */
  dim?: boolean;
  /** `flare` blazes briefly (a super-effective hit); `dim` banks it to embers. */
  fire?: 'idle' | 'flare' | 'dim';
}

export const Stage = ({ dim = false, fire = 'idle' }: StageProps) => (
  <div
    className={[
      'stage',
      fire === 'flare' ? 'stage--flare' : '',
      fire === 'dim' ? 'stage--dim-fire' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    aria-hidden="true"
  >
    <svg
      className="stage__scene"
      viewBox="0 0 160 100"
      preserveAspectRatio="xMidYMax slice"
      role="presentation"
    >
      {SCENE}
    </svg>
    {dim && <div className="stage__scrim" />}
  </div>
);
