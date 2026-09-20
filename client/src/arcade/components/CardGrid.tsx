import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';

import type { GridKey } from '../gridNav';
import { moveFocus } from '../gridNav';
import { inkOn, typeOf } from '../theme';
import type { TheoryCard } from '../types';

/**
 * The roster: twelve slots in one vertical column, one tab stop with roving
 * focus. A column tile is wide and short, so each one carries the theory's
 * whole name rather than a six-letter code.
 *
 * The cursor (`focused`) is owned by the screen, not by this grid, because the
 * server can move it too — when a snapshot says which theory the player was
 * matched to, the cursor jumps there whether they clicked or just said it.
 */

export const COLUMNS = 1;
export const SLOTS = 12;

const NAV_KEYS: GridKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
const isNavKey = (key: string): key is GridKey => (NAV_KEYS as string[]).includes(key);

export interface CardGridProps {
  cards: TheoryCard[];
  /** Index of the slot carrying the 1P cursor. */
  focused: number;
  onFocusChange: (index: number) => void;
  onPick: (card: TheoryCard) => void;
  /** The theory the server has confirmed, if any. */
  lockedId: string | null;
  disabled: boolean;
}

export const CardGrid = ({
  cards,
  focused,
  onFocusChange,
  onPick,
  lockedId,
  disabled,
}: CardGridProps) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const slots = useRef<Array<HTMLButtonElement | null>>([]);

  // Roving tabindex: the browser's focus follows the cursor, but only while the
  // grid already has it. Otherwise a snapshot arriving mid-sentence would yank
  // focus away from whatever the player was actually using.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // The column scrolls on a short viewport, so the cursor is kept in view
    // however it moved — by key, by pointer, or by a snapshot from the server.
    slots.current[focused]?.scrollIntoView({ block: 'nearest' });
    if (!grid.contains(document.activeElement)) return;
    slots.current[focused]?.focus();
  }, [focused]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!isNavKey(event.key)) return;
    event.preventDefault();
    onFocusChange(moveFocus(focused, event.key, cards.length || SLOTS, COLUMNS));
  };

  return (
    <div
      className={`grid${disabled ? ' grid--locked' : ''}`}
      ref={gridRef}
      role="group"
      aria-label="Theory roster"
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: cards.length || SLOTS }, (_, i) => {
        const card = cards[i];
        const type = card ? typeOf(card).colorVar : '--type-neutral';
        const locked = !!card && card.id === lockedId;
        const style = card
          ? ({ '--type': `var(${type})`, '--type-ink': `var(${inkOn(type)})` } as CSSProperties)
          : undefined;

        return (
          <button
            key={card ? card.id : `empty-${i}`}
            ref={(el) => {
              slots.current[i] = el;
            }}
            type="button"
            className={[
              'slot',
              i === focused ? 'slot--focused' : '',
              locked ? 'slot--locked' : '',
              card ? '' : 'slot--empty',
            ]
              .filter(Boolean)
              .join(' ')}
            style={style}
            // One tab stop for the whole roster; the arrows do the rest.
            tabIndex={i === focused ? 0 : -1}
            // An empty slot cannot be picked, but the focused one stays
            // enabled anyway: before `theory_cards` arrives every slot would
            // otherwise be `disabled`, and a disabled button is never a tab
            // stop, so Tab would skip the roster entirely.
            disabled={(!card && i !== focused) || disabled}
            // The theory the server confirmed, not a toggle button's state.
            aria-current={locked ? 'true' : undefined}
            aria-label={card ? card.name : 'Empty slot'}
            onClick={() => card && onPick(card)}
            onFocus={() => onFocusChange(i)}
            onMouseEnter={() => !disabled && card && onFocusChange(i)}
          >
            <span className="slot__name">{card ? card.name : ''}</span>
            {i === focused && (
              <span className="slot__cursor pixel-text" aria-hidden="true">
                1P
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
