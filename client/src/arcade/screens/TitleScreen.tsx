import { PixelButton } from '../components/PixelButton';
import { playSfx } from '../sfxPlayer';

export interface TitleScreenProps {
  onStart: () => void;
  /** Opens the card browser; it needs no connection. */
  onDeck: () => void;
  busy: boolean;
  error: string | null;
}

/**
 * Two idle wingback silhouettes, one either side of the fire. Placeholder art
 * for the title screen only: the real `<Armchair>`, with faces and states,
 * arrives in task U.3.
 */
const Silhouette = ({ side, fill }: { side: 'left' | 'right'; fill: string }) => (
  <svg
    className={`title__chair title__chair--${side}`}
    viewBox="0 0 24 32"
    preserveAspectRatio="xMidYMax meet"
    aria-hidden="true"
    focusable="false"
  >
    <g transform={side === 'right' ? 'translate(24,0) scale(-1,1)' : undefined}>
      {/* wings, back, seat, legs — read as a chair at a glance, nothing more */}
      <rect x={4} y={5} width={2} height={1} fill={fill} />
      <rect x={3} y={6} width={4} height={16} fill={fill} />
      <rect x={18} y={5} width={2} height={1} fill={fill} />
      <rect x={17} y={6} width={4} height={16} fill={fill} />
      <rect x={7} y={9} width={10} height={1} fill={fill} />
      <rect x={6} y={10} width={12} height={12} fill={fill} />
      <rect x={4} y={20} width={16} height={6} fill={fill} />
      <rect x={4} y={26} width={16} height={2} fill="#1d120b" />
      <rect x={5} y={28} width={3} height={4} fill="#1d120b" />
      <rect x={16} y={28} width={3} height={4} fill="#1d120b" />
      {/* a seam of firelight down the near edge */}
      <rect x={20} y={7} width={1} height={15} fill="#e0662a" opacity={0.45} />
    </g>
  </svg>
);

export const TitleScreen = ({ onStart, onDeck, busy, error }: TitleScreenProps) => (
  <div className="title">
    <Silhouette side="left" fill="#27351f" />
    <Silhouette side="right" fill="#3d161b" />

    <h1 className="title__wordmark" aria-label="Armchair Debater">
      <span className="logo logo__line--1">ARMCHAIR</span>
      <span className="logo logo__line--2">DEBATER</span>
    </h1>
    <p className="logo__rule pixel-text title__subtitle">ARCADE EDITION</p>

    <div className="title__start">
      <PixelButton
        size="lg"
        blink={!busy}
        disabled={busy}
        onClick={() => {
          // The first gesture on the page: it is also what lets the browser play sound.
          playSfx('pick');
          onStart();
        }}
      >
        {busy ? 'CONNECTING…' : 'PRESS START'}
      </PixelButton>

      <p className="title__instruction">
        Say what you think consciousness is. The house will disagree.
      </p>

      <PixelButton
        disabled={busy}
        onClick={() => {
          playSfx('pick');
          onDeck();
        }}
      >
        The deck
      </PixelButton>

      {error && (
        <p className="pixel-panel title__error" role="alert">
          {error}
        </p>
      )}
    </div>
  </div>
);
