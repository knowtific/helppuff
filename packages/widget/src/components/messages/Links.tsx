import type { LinkItem } from '@murmur/protocol';
import { Icon } from '../Icon.js';

/** Stacked rows with a title, optional description and an arrow. */
export function Links({ title, links }: { title?: string | undefined; links: LinkItem[] }) {
  return (
    <div class="mm-links">
      {title ? <div class="mm-links-title">{title}</div> : null}
      {links.map((link) => (
        <a
          key={link.url + link.label}
          class="mm-link-row"
          href={link.url}
          {...(link.url.startsWith('http') ? { target: '_blank' } : {})}
          rel="noopener noreferrer nofollow"
        >
          <span class="mm-link-text">
            <span class="mm-link-label">{link.label}</span>
            {link.description ? <span class="mm-link-desc">{link.description}</span> : null}
          </span>
          <Icon name="arrow-right" size={16} />
        </a>
      ))}
    </div>
  );
}
