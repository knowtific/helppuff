import { useRef } from 'preact/hooks';
import type { Action, Shortcut } from '@murmur/protocol';
import { Icon } from './Icon.js';
import { useScrollEdges } from '../lib/scroll-edges.js';

/**
 * Shortcuts appear as tiles on the home screen and as chips above the
 * composer. A `url`, `tel` or `email` shortcut is a real anchor; the
 * rest go back through the app.
 */

function href(action: Action): string | null {
  if (action.kind === 'url') return action.url;
  if (action.kind === 'tel') return `tel:${action.phone}`;
  if (action.kind === 'email') return `mailto:${action.email}`;
  return null;
}

export function ShortcutTiles({
  shortcuts,
  onPick,
}: {
  shortcuts: Shortcut[];
  onPick: (shortcut: Shortcut) => void;
}) {
  if (shortcuts.length === 0) return null;

  return (
    <div class="mm-tiles">
      {shortcuts.map((shortcut) => {
        const link = href(shortcut.action);
        const inner = (
          <>
            {shortcut.icon ? (
              <span class="mm-tile-icon">
                <Icon name={shortcut.icon} />
              </span>
            ) : null}
            <span class="mm-tile-label">{shortcut.label}</span>
            {shortcut.description ? <span class="mm-tile-desc">{shortcut.description}</span> : null}
          </>
        );

        return link ? (
          <a
            key={shortcut.id}
            class="mm-tile"
            href={link}
            {...(shortcut.action.kind === 'url' ? { target: '_blank' } : {})}
            rel="noopener noreferrer nofollow"
          >
            {inner}
          </a>
        ) : (
          <button key={shortcut.id} type="button" class="mm-tile" onClick={() => onPick(shortcut)}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The chip row above the composer. It collapses once the conversation is
 * under way, so it does not compete with the thread.
 *
 * The row scrolls horizontally, and its scrollbar is hidden — so an edge
 * fade marks the chips that are out of view, a vertical wheel scrolls it
 * sideways, and Tab reaches every chip regardless.
 */
export function ShortcutBar({
  shortcuts,
  collapsed,
  expanded,
  onPick,
  onExpand,
}: {
  shortcuts: Shortcut[];
  collapsed: boolean;
  expanded: boolean;
  onPick: (shortcut: Shortcut) => void;
  onExpand: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const { edges, scrollByStep } = useScrollEdges(track, [shortcuts.length, collapsed, expanded]);

  if (shortcuts.length === 0) return null;

  if (collapsed && !expanded) {
    return (
      <div class="mm-shortcut-wrap">
        <div class="mm-shortcut-bar" ref={track}>
          <button type="button" class="mm-chip" aria-label="Show shortcuts" onClick={onExpand}>
            ⋯
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      class="mm-shortcut-wrap"
      {...(edges.atStart ? {} : { 'data-more-start': '' })}
      {...(edges.atEnd ? {} : { 'data-more-end': '' })}
    >
      <div class="mm-shortcut-bar" ref={track}>
        {shortcuts.map((shortcut) => {
          const link = href(shortcut.action);
          return link ? (
            <a
              key={shortcut.id}
              class="mm-chip"
              href={link}
              {...(shortcut.action.kind === 'url' ? { target: '_blank' } : {})}
              rel="noopener noreferrer nofollow"
            >
              {shortcut.label}
            </a>
          ) : (
            <button key={shortcut.id} type="button" class="mm-chip" onClick={() => onPick(shortcut)}>
              {shortcut.label}
            </button>
          );
        })}
      </div>

      {edges.atEnd ? null : (
        <button
          type="button"
          class="mm-shortcut-nav"
          aria-label="More shortcuts"
          onClick={() => scrollByStep(1)}
        >
          <Icon name="arrow-right" size={16} />
        </button>
      )}
    </div>
  );
}
