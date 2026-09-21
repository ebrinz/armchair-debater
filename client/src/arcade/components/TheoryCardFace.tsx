import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

import { inkOn, shortName, typeOf } from '../theme';
import type { TheoryCard } from '../types';
import { Armchair } from './Armchair';

/**
 * One theory as a trading card, laid out to the spec's Style guide: a thick
 * frame in the theory's type colour, name and HP across the top, a framed
 * portrait window holding that theory's wingback, the Kuhn category as a thin
 * italic strip, three moves, the rivals it is weak against, and the claim as
 * flavour text at the foot.
 *
 * Everything that changes with the theory is a CSS variable set here
 * (`--type`, `--type-ink`), so select.css never names a category.
 *
 * Each move is a button. At desktop width the card is wide enough that every
 * argument is shown whole and no caret appears; where the card is narrow enough
 * to cut one, that move gets a caret and opens on a click or on Enter. Only one
 * is open at a time, and the moves well has a fixed height, so the card is the
 * same size whichever theory the cursor is on and whatever is open. The caller gives this
 * component a `key` of the card's id, so moving the cursor closes what was open.
 */

export interface TheoryCardFaceProps {
  card: TheoryCard;
  /** All twelve, so each rival chip can carry that rival's own type colour. */
  cards: TheoryCard[];
  /** The server has confirmed this is the player's theory. */
  locked?: boolean;
  /** When given, each rival chip is a button that calls this with the rival's
   *  id — the deck uses it to turn to that card. */
  onRival?: (id: string) => void;
}

/**
 * The category in words: the top-level Kuhn family, then the leaf when it says
 * something the family does not. "Materialism > Neurobiological > Global
 * workspace" reads as "Materialism > Global workspace"; a card whose family is
 * its own leaf ("Panpsychisms") just reads once.
 */
const categoryLine = (card: TheoryCard): string => {
  const family = card.kuhn_category.split('>')[0].trim();
  const leaf = typeOf(card).label;
  return leaf && leaf !== family ? `${family} > ${leaf}` : family;
};

export const TheoryCardFace = ({ card, cards, locked = false, onRival }: TheoryCardFaceProps) => {
  const [open, setOpen] = useState<number | null>(null);
  const movesRef = useRef<HTMLUListElement>(null);

  /*
   * Whether an argument is cut off depends on the rendered width, so it can
   * only be known after layout. This writes it straight onto the DOM as a
   * `data-clipped` attribute — no React state, so no cascading render — and
   * select.css shows the caret off it. A ResizeObserver keeps it true as the
   * window changes.
   */
  useEffect(() => {
    const list = movesRef.current;
    if (!list) return;
    const sync = () => {
      for (const item of list.querySelectorAll<HTMLElement>('.card__move')) {
        const text = item.querySelector<HTMLElement>('.card__move-text');
        item.toggleAttribute('data-clipped', !!text && text.scrollHeight > text.clientHeight + 1);
      }
      // Drives the "there is more below" cue; at desktop widths every argument
      // fits and this stays off.
      list.toggleAttribute('data-scrollable', list.scrollHeight > list.clientHeight + 1);
    };
    sync();
    // Whatever was just opened is brought into view, in case the well scrolls.
    list.querySelector('.card__move--open')?.scrollIntoView({ block: 'nearest' });
    const observer = new ResizeObserver(sync);
    observer.observe(list);
    return () => observer.disconnect();
  }, [open]);

  const { colorVar } = typeOf(card);
  const style = {
    '--type': `var(${colorVar})`,
    '--type-ink': `var(${inkOn(colorVar)})`,
  } as CSSProperties;

  return (
    <article
      className={`card${locked ? ' card--locked' : ''}`}
      style={style}
      aria-label={`${card.name}. ${categoryLine(card)}.`}
    >
      <div className="card__body">
        {/* The landscape band: the portrait stands to the left of the titling,
            so the wide area below belongs entirely to the three moves. */}
        <header className="card__band">
          <div className="card__window">
            <Armchair
              variant={{ typeColorVar: colorVar }}
              side="user"
              level={0}
              hurt={false}
              healed={false}
              health={100}
              className="card__chair"
            />
          </div>

          <div className="card__titling">
            <div className="card__head">
              <h3 className="card__name pixel-text">{card.name}</h3>
              <p className="card__hp pixel-text">
                HP<span className="card__hp-value">100</span>
              </p>
            </div>
            <p className="card__category">{categoryLine(card)}</p>
          </div>
        </header>

        <ul className="card__moves" ref={movesRef}>
          {card.moves.map((move, i) => {
            const id = `${card.id}-move-${i}`;
            const expanded = open === i;
            return (
              <li className={`card__move${expanded ? ' card__move--open' : ''}`} key={move}>
                <button
                  type="button"
                  className="card__move-head"
                  aria-expanded={expanded}
                  aria-controls={id}
                  title={card.arguments[i]}
                  onClick={() => setOpen(expanded ? null : i)}
                >
                  <span className="card__move-caret" aria-hidden="true">
                    {expanded ? '▾' : '▸'}
                  </span>
                  <span className="card__move-name pixel-text">{move}</span>
                </button>
                {/* The whole sentence is always in the DOM; collapsed, it is
                    only clamped visually. */}
                <p className="card__move-text" id={id}>
                  {card.arguments[i]}
                </p>
              </li>
            );
          })}
        </ul>

        <p className="card__weak">
          <span className="card__weak-label pixel-text">Weak vs</span>
          {card.rivals.map((id) => {
            const rival = cards.find((c) => c.id === id);
            const chip = {
              '--type': `var(${rival ? typeOf(rival).colorVar : '--type-neutral'})`,
              '--type-ink': `var(${inkOn(rival ? typeOf(rival).colorVar : '--type-neutral')})`,
            } as CSSProperties;
            return onRival && rival ? (
              <button
                type="button"
                className="card__chip card__chip--link pixel-text"
                key={id}
                style={chip}
                aria-label={`Turn to ${rival.name}`}
                title={rival.name}
                onClick={() => onRival(id)}
              >
                {shortName(id)}
              </button>
            ) : (
              <span className="card__chip pixel-text" key={id} style={chip} title={rival?.name}>
                {shortName(id)}
              </span>
            );
          })}
        </p>

        <p className="card__claim">{card.claim}</p>
      </div>
    </article>
  );
};
