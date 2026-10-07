import { DEFAULT_LEAD_FIELDS } from '@helppuff/protocol';

/**
 * The preview page's own content: a button for every kind of message the
 * widget can show, the whole `window.HelpPuff` API, and a log of what the
 * widget reports. The page is the host site, so this is exactly what a site's
 * own code can do.
 */

type Method = (...args: unknown[]) => unknown;
type Field = { name?: unknown; type?: unknown; required?: unknown; options?: unknown };

/** Every echo command, by what it shows. */
const MESSAGE_TYPES: { label: string; send: string; note: string }[] = [
  { label: 'Text', send: 'Hello there', note: 'A plain reply, with Markdown' },
  { label: 'Options', send: '/options', note: 'Chips to tap' },
  { label: 'Multi-select', send: '/multi', note: 'Pick several, then confirm' },
  { label: 'Card', send: '/card', note: 'Image, text and buttons' },
  { label: 'Carousel', send: '/carousel', note: 'Cards that scroll sideways' },
  { label: 'Links', send: '/links', note: 'A list of pages' },
  { label: 'Inline form', send: '/form', note: 'Fields inside the chat' },
  { label: 'Notice', send: '/notice', note: 'A system warning' },
  { label: 'Typing indicator', send: '/slow', note: 'A three-second wait' },
  { label: 'Long reply', send: '/long', note: 'Scrolling and streaming' },
  { label: 'Two messages', send: '/multipart', note: 'Several in one reply' },
  { label: 'Error', send: '/error', note: 'Retry and fallback contact' },
];

const SHOWCASE_QUESTIONS = ['How much is a blocked drain?', 'Do you do emergency callouts?', 'What services do you offer?', 'Can someone come tomorrow?'];

/**
 * Details for every required field of the configured pre-chat form, so a
 * message button can go straight to its reply. `identify()` is the real API a
 * site uses when it already knows who the visitor is.
 */
export function demoLead(widget: unknown): Record<string, string> {
  const form = (widget as { leadForm?: { enabled?: unknown; fields?: unknown } } | null)?.leadForm;
  if (form?.enabled === false) return {};
  const fields = (Array.isArray(form?.fields) ? form.fields : DEFAULT_LEAD_FIELDS) as Field[];
  const lead: Record<string, string> = {};
  for (const field of fields) {
    if (field.required !== true || typeof field.name !== 'string') continue;
    const options = Array.isArray(field.options) ? field.options.filter((o): o is string => typeof o === 'string') : [];
    lead[field.name] =
      field.type === 'email' ? 'ada@example.com'
      : field.type === 'tel' ? '0400 000 000'
      : field.type === 'select' ? (options[0] ?? 'Other')
      : field.name === 'name' ? 'Ada Lovelace'
      : field.name === 'message' ? 'Hello'
      : 'Demo';
  }
  return lead;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

export type Controls = { log: (line: string) => void };

export function renderControls(root: HTMLElement, options: { widget: unknown; showcase: boolean; fill: boolean }): Controls {
  const call = (name: string, ...args: unknown[]) => {
    const method = window.HelpPuff?.[name];
    return typeof method === 'function' ? (method as Method)(...args) : undefined;
  };

  const position = (options.widget as { launcher?: { position?: unknown } } | null)?.launcher?.position;
  if (!options.fill) document.body.dataset['side'] = position === 'bottom-left' ? 'left' : 'right';

  const logBox = el('div', { id: 'log', role: 'log', ariaLive: 'polite' }, el('div', { className: 'muted', textContent: 'Events appear here as you use the widget.' }));
  const log = (line: string) => {
    logBox.querySelector('.muted')?.remove();
    logBox.prepend(el('div', { textContent: `${new Date().toLocaleTimeString()}  ${line}` }));
    while (logBox.childElementCount > 80) logBox.lastElementChild?.remove();
  };

  /** Straight to the reply: known details instead of the pre-chat form, then the message. */
  const instant = (text: string) => {
    const lead = demoLead(options.widget);
    if (Object.keys(lead).length) call('identify', lead);
    call('send', text);
  };

  const tryButton = (label: string, note: string, text: string, showCommand: boolean) =>
    el(
      'button',
      { type: 'button', className: 'try', onclick: () => instant(text) },
      el('b', {}, label, ...(showCommand ? [' ', el('code', { textContent: text })] : [])),
      el('span', { textContent: note }),
    );

  const apiButton = (label: string, run: () => void) => el('button', { type: 'button', onclick: run }, el('code', { textContent: label }));

  root.replaceChildren(
    el('h1', { textContent: 'Try it' }),
    el('p', { className: 'lede', textContent: 'This page plays your website. Each button below does what a visitor or your own page code would, and the chat answers right away.' }),
    ...(options.showcase
      ? [
          el('h2', { textContent: 'Ask it' }),
          el('div', { className: 'grid' }, ...SHOWCASE_QUESTIONS.map((q) => tryButton(`“${q}”`, 'A scripted answer', q, false))),
        ]
      : []),
    el('h2', { textContent: 'Message types' }),
    el('div', { className: 'grid' }, ...MESSAGE_TYPES.map((t) => tryButton(t.label, t.note, t.send, t.send.startsWith('/')))),
    el(
      'p',
      { className: 'note' },
      'These fill the pre-chat form with demo details so nothing stands in the way. To see the form, ',
      el('button', { type: 'button', textContent: 'start over', onclick: () => location.reload() }),
      ' and use the chat’s own button.',
    ),
    el('h2', { textContent: 'JavaScript API' }),
    el(
      'div',
      { className: 'api' },
      apiButton('open()', () => call('open')),
      apiButton('close()', () => call('close')),
      apiButton('toggle()', () => call('toggle')),
      apiButton("send('Hi')", () => call('send', 'Hi')),
      apiButton('identify({ name, email })', () => call('identify', { name: 'Ada Lovelace', email: 'ada@example.com' })),
      apiButton('reset()', () => call('reset')),
      apiButton('debug()', () => log(`debug ${JSON.stringify(call('debug'))}`)),
      apiButton('destroy()', () => call('destroy')),
    ),
    el('p', { className: 'note', textContent: 'The real calls, unchanged: send() asks for the pre-chat form first if the details it needs are missing.' }),
    el('h2', { textContent: 'Events' }),
    logBox,
  );

  return { log };
}
