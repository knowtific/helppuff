import { useRef } from 'preact/hooks';
import type { Action, CardItem } from '@murmur/protocol';
import { ActionButtons } from './Actions.js';
import { Icon } from '../Icon.js';
import { useScrollEdges } from '../../lib/scroll-edges.js';

const ASPECT: Record<string, string> = { '1:1': '1 / 1', '16:9': '16 / 9', '4:3': '4 / 3' };

export function Card({
  card,
  consumed,
  onAction,
}: {
  card: CardItem;
  consumed: boolean;
  onAction: (action: Action) => void;
}) {
  return (
    <article class="mm-card">
      {card.image ? (
        <img
          class="mm-card-img"
          src={card.image.src}
          alt={card.image.alt}
          loading="lazy"
          decoding="async"
          style={{ aspectRatio: ASPECT[card.image.aspect ?? '16:9'] ?? '16 / 9' }}
          // A dead image URL must not leave a broken-image glyph in the thread.
          onError={(event) => (event.currentTarget as HTMLImageElement).remove()}
        />
      ) : null}
      <div class="mm-card-body">
        <h3 class="mm-card-title">{card.title}</h3>
        {card.body ? <p class="mm-card-text">{card.body}</p> : null}
        <ActionButtons actions={card.actions ?? []} disabled={consumed} onAction={onAction} />
      </div>
    </article>
  );
}

/**
 * Horizontal scroll-snap, with arrow buttons on pointer devices and swipe on
 * touch.
 *
 * The scrollbar is deliberately hidden — a native bar under a row of cards
 * looks like a mistake — which means the arrows are the only affordance a
 * mouse user gets. Without them the second and third cards are unreachable.
 */
export function Carousel({
  cards,
  consumed,
  onAction,
}: {
  cards: CardItem[];
  consumed: boolean;
  onAction: (action: Action) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const { edges, scrollByStep } = useScrollEdges(track, [cards.length]);

  return (
    <div class="mm-carousel-wrap" data-scrollable={edges.fits ? undefined : ''}>
      <div class="mm-carousel" ref={track} role="group" aria-label={`${cards.length} options`}>
        {cards.map((card, index) => (
          <div class="mm-carousel-item" key={`${card.title}-${index}`}>
            <Card card={card} consumed={consumed} onAction={onAction} />
          </div>
        ))}
      </div>

      {edges.fits ? null : (
        <>
          <button
            type="button"
            class="mm-carousel-nav"
            data-dir="prev"
            aria-label="Previous"
            disabled={edges.atStart}
            onClick={() => scrollByStep(-1, '.mm-carousel-item')}
          >
            <Icon name="arrow-left" size={18} />
          </button>
          <button
            type="button"
            class="mm-carousel-nav"
            data-dir="next"
            aria-label="Next"
            disabled={edges.atEnd}
            onClick={() => scrollByStep(1, '.mm-carousel-item')}
          >
            <Icon name="arrow-right" size={18} />
          </button>
        </>
      )}
    </div>
  );
}
