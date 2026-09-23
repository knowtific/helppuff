import type { Message } from '@murmur/protocol';
import { message, messageId } from './helpers.js';

/**
 * Turning a backend's tool/function calls into protocol messages (§6.3).
 *
 * Retell, the OpenAI Responses API and the Gemini Interactions API all let a
 * model call a named function, so one convention covers all three: declare
 * `show_options`, `show_card` and `show_links` on the agent, and whatever it
 * calls them with becomes a rich message.
 *
 * Everything here is defensive. A model will happily invent an extra field,
 * omit a required one, or return a URL that is not a URL — and a malformed
 * call must degrade to "no rich message", never to a broken thread. The
 * server's sanitizer is the second line of defence; this is the first.
 */

/**
 * The tool definitions to paste into an agent's configuration. Exported so
 * `docs/connectors.md` and the connector READMEs stay in step with the
 * parser rather than drifting from it.
 */
export const RICH_TOOL_SCHEMAS = {
  show_options: {
    name: 'show_options',
    description:
      'Offer the visitor a short list of choices as tappable chips. Use when the reply is a question with a small, known set of answers.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The question shown above the choices.' },
        options: {
          type: 'array',
          description: 'Between 1 and 10 choices.',
          items: { type: 'string' },
        },
        multi: { type: 'boolean', description: 'Allow more than one choice.' },
      },
      required: ['options'],
    },
  },
  show_card: {
    name: 'show_card',
    description: 'Show one item with a title, optional body, optional image and up to three actions.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        image_url: { type: 'string', description: 'An https image URL.' },
        actions: {
          type: 'array',
          description: 'Up to three. Each is {label, value} for a reply, or {label, url}.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['label'],
          },
        },
      },
      required: ['title'],
    },
  },
  show_links: {
    name: 'show_links',
    description: 'Point the visitor at pages that answer their question.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              url: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['label', 'url'],
          },
        },
      },
      required: ['links'],
    },
  },
} as const;

export const RICH_TOOL_NAMES = Object.keys(RICH_TOOL_SCHEMAS);

/**
 * Arguments arrive as a JSON string from Retell and OpenAI, and as an object
 * from Gemini. Accept either, and treat anything unparseable as absent.
 */
export function parseToolArguments(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
};

/** Anything a visitor may be sent to: the protocol's allowed schemes (§4.4). */
const safeUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const { protocol } = new URL(value);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(protocol) ? value : null;
  } catch {
    return null;
  }
};

function optionsMessage(args: Record<string, unknown>): Message | null {
  const raw = Array.isArray(args['options']) ? args['options'] : [];
  const options = raw
    .map((entry, index) => {
      // A model may return plain strings or {label, value} objects.
      if (typeof entry === 'string') {
        const label = text(entry, 120);
        return label ? { id: `o${index}`, label, value: label } : null;
      }
      if (typeof entry === 'object' && entry !== null) {
        const row = entry as Record<string, unknown>;
        const label = text(row['label'], 120);
        if (!label) return null;
        return { id: `o${index}`, label, value: text(row['value'], 500) ?? label };
      }
      return null;
    })
    .filter((option): option is { id: string; label: string; value: string } => option !== null)
    .slice(0, 10);

  if (options.length === 0) return null;
  const prompt = text(args['text'], 2000);
  return message({
    type: 'options',
    options,
    ...(prompt ? { text: prompt } : {}),
    ...(args['multi'] === true ? { multi: true } : {}),
  });
}

function cardActions(args: Record<string, unknown>) {
  const raw = Array.isArray(args['actions']) ? args['actions'] : [];
  return raw
    .map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const label = text(row['label'], 120);
      if (!label) return null;

      const url = safeUrl(row['url']);
      if (url) return { id: `a${index}`, kind: 'url' as const, label, url, newTab: true };

      const value = text(row['value'], 500) ?? label;
      return { id: `a${index}`, kind: 'reply' as const, label, value };
    })
    .filter((action): action is NonNullable<typeof action> => action !== null)
    .slice(0, 3);
}

function cardMessage(args: Record<string, unknown>): Message | null {
  const title = text(args['title'], 160);
  if (!title) return null;

  const body = text(args['body'], 600);
  const image = httpUrl(args['image_url'] ?? args['image']);
  const actions = cardActions(args);

  return message({
    type: 'card',
    title,
    ...(body ? { body } : {}),
    ...(image ? { image: { src: image, alt: text(args['image_alt'], 200) ?? title } } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  });
}

function linksMessage(args: Record<string, unknown>): Message | null {
  const raw = Array.isArray(args['links']) ? args['links'] : [];
  const links = raw
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const label = text(row['label'], 160);
      const url = safeUrl(row['url']);
      if (!label || !url) return null;
      const description = text(row['description'], 300);
      return { label, url, ...(description ? { description } : {}) };
    })
    .filter((link): link is NonNullable<typeof link> => link !== null)
    .slice(0, 10);

  if (links.length === 0) return null;
  const title = text(args['title'], 160);
  return message({ type: 'links', links, ...(title ? { title } : {}) });
}

/**
 * Map one tool call to a message, or null when the call is not one of ours
 * or its arguments cannot be used.
 */
export function toolCallToMessage(name: string, rawArguments: unknown): Message | null {
  const args = parseToolArguments(rawArguments);
  if (!args) return null;

  switch (name) {
    case 'show_options':
      return optionsMessage(args);
    case 'show_card':
      return cardMessage(args);
    case 'show_links':
      return linksMessage(args);
    default:
      return null;
  }
}

/**
 * The inline-marker fallback (§6.3), for an agent that cannot be given tools.
 * A trailing `[[options: A | B | C]]` or `[[link: Label | https://…]]` block
 * is parsed out and stripped; malformed markers are stripped silently rather
 * than shown to the visitor as stray punctuation.
 */
const MARKER = /\[\[\s*(options|link)\s*:\s*([^\]]*)\]\]/gi;

export function parseMarkers(input: string): { text: string; messages: Message[] } {
  const messages: Message[] = [];
  let options: string[] = [];
  const links: { label: string; url: string }[] = [];

  const stripped = input.replace(MARKER, (_match, kind: string, body: string) => {
    const parts = body.split('|').map((part) => part.trim()).filter(Boolean);
    if (kind.toLowerCase() === 'options') {
      options = options.concat(parts);
    } else if (parts.length >= 2) {
      const url = safeUrl(parts[1]);
      if (url && parts[0]) links.push({ label: parts[0], url });
    }
    return '';
  });

  if (options.length > 0) {
    const built = optionsMessage({ options: options.slice(0, 10) });
    if (built) messages.push(built);
  }
  if (links.length > 0) {
    const built = linksMessage({ links: links.slice(0, 10) });
    if (built) messages.push(built);
  }

  return { text: stripped.replace(/[ \t]+\n/g, '\n').trim(), messages };
}

/** A text reply, dropped when the model returned only whitespace. */
export function textMessage(value: string): Message | null {
  const trimmed = value.trim();
  return trimmed ? message({ type: 'text', text: trimmed }, { id: messageId('m') }) : null;
}
