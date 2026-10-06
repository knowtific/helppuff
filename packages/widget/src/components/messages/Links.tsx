import type { LinkItem } from '@helppuff/protocol';
import { Icon } from '../Icon.js';

/** Stacked rows with a title, optional description and an arrow. */
export function Links({ title, links }: { title?: string | undefined; links: LinkItem[] }) {
  return (
    <div class="hp-links">
      {title ? <div class="hp-links-title">{title}</div> : null}
      {links.map((link) => (
        <a
          key={link.url + link.label}
          class="hp-link-row"
          href={link.url}
          {...(link.url.startsWith('http') ? { target: '_blank' } : {})}
          rel="noopener noreferrer nofollow"
        >
          <span class="hp-link-text">
            <span class="hp-link-label">{link.label}</span>
            {link.description ? <span class="hp-link-desc">{link.description}</span> : null}
          </span>
          <Icon name="arrow-right" size={16} />
        </a>
      ))}
    </div>
  );
}
