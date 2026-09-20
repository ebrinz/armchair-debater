import type { ReactNode } from 'react';

export interface PixelButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Blink the label, arcade attract-mode style. Off under reduced motion. */
  blink?: boolean;
  size?: 'md' | 'lg';
  type?: 'button' | 'submit';
  className?: string;
}

/** A real <button> in the arcade's border-and-stepped-shadow style. */
export const PixelButton = ({
  children,
  onClick,
  disabled = false,
  blink = false,
  size = 'md',
  type = 'button',
  className,
}: PixelButtonProps) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={[
      'pixel-button',
      `pixel-button--${size}`,
      blink ? 'pixel-button--blink' : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    <span className="pixel-button__label">{children}</span>
  </button>
);
