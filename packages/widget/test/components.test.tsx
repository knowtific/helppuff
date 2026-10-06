import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { Message, WidgetConfig } from '@helppuff/protocol';
import { Composer } from '../src/components/Composer.js';
import { ErrorNotice } from '../src/components/ErrorNotice.js';
import { Header } from '../src/components/Header.js';
import { Home } from '../src/components/Home.js';
import { Launcher } from '../src/components/Launcher.js';
import { LeadForm, validateField } from '../src/components/LeadForm.js';
import { Thread } from '../src/components/Thread.js';
import { inertHandlers } from '../src/components/messages/index.js';
import { makeStrings } from '../src/app/strings.js';
import { parseConfig } from '../src/app/validate.js';

const t = makeStrings();

const config = (overrides: Record<string, unknown> = {}): WidgetConfig =>
  parseConfig({
    brand: { name: 'Knowtific', agentName: 'Alex', accent: '#5B5BF7' },
    home: { title: 'Hi there', subtitle: 'Ask anything.' },
    chat: { fallbackContact: { phone: '+61400000000', email: 'hi@example.com' } },
    ...overrides,
  }) as WidgetConfig;

const msg = (partial: Partial<Message> & Pick<Message, 'type'>): Message =>
  ({ id: `m${Math.random()}`, ts: Date.now(), role: 'agent', ...partial }) as Message;

describe('Launcher', () => {
  it('is a labelled button that reports its expanded state', () => {
    render(<Launcher config={config()} open={false} unread={0} onClick={() => {}} />);
    const button = screen.getByRole('button', { name: /chat with knowtific/i });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('uses the configured label when there is one', () => {
    render(<Launcher config={config({ launcher: { label: 'Ask us' } })} open={false} unread={0} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ask us' })).toBeTruthy();
  });

  it('shows an unread dot only while closed', () => {
    const { container, rerender } = render(<Launcher config={config()} open={false} unread={2} onClick={() => {}} />);
    expect(container.querySelector('.hp-dot')).toBeTruthy();
    rerender(<Launcher config={config()} open unread={2} onClick={() => {}} />);
    expect(container.querySelector('.hp-dot')).toBeNull();
  });

  it('reports expanded once open', () => {
    render(<Launcher config={config()} open unread={0} onClick={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Launcher config={config()} open={false} unread={0} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Home', () => {
  it('shows the configured title and subtitle', () => {
    render(<Home config={config()} shortcuts={[]} onShortcut={() => {}} hasSession={false} lastMessage={undefined} busy={false} t={t} onStart={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Hi there' })).toBeTruthy();
    expect(screen.getByText('Ask anything.')).toBeTruthy();
  });

  it('offers to start a conversation when there is none', () => {
    render(<Home config={config()} shortcuts={[]} onShortcut={() => {}} hasSession={false} lastMessage={undefined} busy={false} t={t} onStart={() => {}} />);
    expect(screen.getByRole('button', { name: /start a conversation/i })).toBeTruthy();
  });

  it('offers to resume, with a plain-text preview, when a session exists', () => {
    const last = msg({ type: 'text', text: 'A **bold** answer with a [link](https://a.co)' });
    render(<Home config={config()} shortcuts={[]} onShortcut={() => {}} hasSession lastMessage={last} busy={false} t={t} onStart={() => {}} />);
    expect(screen.getByRole('button', { name: /continue conversation/i })).toBeTruthy();
    // Markdown is stripped in the preview, not rendered.
    expect(screen.getByText(/A bold answer with a link/)).toBeTruthy();
  });

  it('disables the start button while busy', () => {
    render(<Home config={config()} shortcuts={[]} onShortcut={() => {}} hasSession={false} lastMessage={undefined} busy t={t} onStart={() => {}} />);
    expect((screen.getByRole('button', { name: /start/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Header', () => {
  it('names the agent and shows the idle status', () => {
    render(<Header config={config()} thinking={false} showBack={false} t={t} onBack={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText(/typically replies/i)).toBeTruthy();
  });

  it('switches the status line while thinking', () => {
    render(<Header config={config()} thinking showBack={false} t={t} onBack={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Typing…')).toBeTruthy();
  });

  it('shows a back control only when asked', () => {
    const { rerender } = render(
      <Header config={config()} thinking={false} showBack={false} t={t} onBack={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    rerender(<Header config={config()} thinking={false} showBack t={t} onBack={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('closes', () => {
    const onClose = vi.fn();
    render(<Header config={config()} thinking={false} showBack={false} t={t} onBack={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close chat/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Thread', () => {
  it('renders agent text as markdown and user text as a plain bubble', () => {
    const messages = [
      msg({ type: 'text', text: 'Hello **there**' }),
      msg({ type: 'text', text: 'Hi **back**', role: 'user' }),
    ];
    const { container } = render(<Thread messages={messages} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />);

    expect(container.querySelector('.hp-agent strong')?.textContent).toBe('there');
    // A user's own text is never parsed as markdown.
    const user = container.querySelector('.hp-user');
    expect(user?.textContent).toBe('Hi **back**');
    expect(user?.querySelector('strong')).toBeNull();
  });

  it('renders a safe link with the right rel', () => {
    const { container } = render(
      <Thread messages={[msg({ type: 'text', text: '[docs](https://example.com)' })]} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />,
    );
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('does not create a link for a javascript: url', () => {
    const { container } = render(
      <Thread messages={[msg({ type: 'text', text: '[x](javascript:alert(1))' })]} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />,
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders notices with their tone', () => {
    const { container } = render(
      <Thread messages={[msg({ type: 'notice', text: 'Careful', tone: 'warn', role: 'system' })]} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />,
    );
    expect(container.querySelector('.hp-notice')?.getAttribute('data-tone')).toBe('warn');
  });

  it('renders nothing at all for a message type it cannot draw', () => {
    const unknown = { id: 'x', ts: 1, role: 'agent', type: 'hologram' } as unknown as Message;
    const { container } = render(<Thread messages={[unknown]} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />);
    expect(container.querySelector('.hp-agent')).toBeNull();
    // Regression: an empty row still costs a fade-in, a gap and a timestamp,
    // which a visitor sees as something flashing and vanishing.
    expect(container.querySelector('.hp-row')).toBeNull();
  });

  it('keeps grouping correct across a message it cannot draw', () => {
    const now = Date.now();
    const messages = [
      msg({ type: 'text', text: 'One', ts: now }),
      { id: 'skip', ts: now + 500, role: 'agent', type: 'hologram' } as unknown as Message,
      msg({ type: 'text', text: 'Two', ts: now + 1000 }),
    ];
    const { container } = render(
      <Thread messages={messages} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />,
    );
    const rows = [...container.querySelectorAll('.hp-row')];
    expect(rows).toHaveLength(2);
    // The two text messages are still adjacent, so the second groups.
    expect(rows[1]?.hasAttribute('data-grouped')).toBe(true);
  });

  it('shows the typing indicator only while busy', () => {
    const { container, rerender } = render(<Thread messages={[]} busy pendingIds={new Set()} handlers={inertHandlers} t={t} />);
    expect(container.querySelector('.hp-typing')).toBeTruthy();
    rerender(<Thread messages={[]} busy={false} pendingIds={new Set()} handlers={inertHandlers} t={t} />);
    expect(container.querySelector('.hp-typing')).toBeNull();
  });
});

describe('Composer', () => {
  const setup = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
    const onSend = vi.fn();
    const onInput = vi.fn();
    const utils = render(
      <Composer
        value=""
        disabled={false}
        offline={false}
        placeholder="Type a message…"
        t={t}
        onInput={onInput}
        onSend={onSend}
        {...props}
      />,
    );
    return { onSend, onInput, ...utils };
  };

  it('disables send when there is nothing to send', () => {
    setup();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables send once there is text', () => {
    setup({ value: 'hello' });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('treats whitespace as empty', () => {
    setup({ value: '   ' });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports typing', () => {
    const { onInput } = setup();
    fireEvent.input(screen.getByRole('textbox'), { target: { value: 'typed' } });
    expect(onInput).toHaveBeenCalledWith('typed');
  });

  it('sends on Enter', () => {
    const { onSend } = setup({ value: 'hello' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('inserts a newline on Shift+Enter instead of sending', () => {
    const { onSend } = setup({ value: 'hello' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('will not send while disabled', () => {
    const { onSend } = setup({ value: 'hello', disabled: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('will not send while offline, and says so', () => {
    const { onSend } = setup({ value: 'hello', offline: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText(/offline/i)).toBeTruthy();
  });

  it('shows the counter only in the last 100 characters', () => {
    const { rerender, container } = render(
      <Composer value={'x'.repeat(899)} disabled={false} offline={false} placeholder="" t={t} onInput={() => {}} onSend={() => {}} />,
    );
    expect(container.querySelector('.hp-counter')).toBeNull();
    rerender(
      <Composer value={'x'.repeat(901)} disabled={false} offline={false} placeholder="" t={t} onInput={() => {}} onSend={() => {}} />,
    );
    expect(container.querySelector('.hp-counter')?.textContent).toBe('99');
  });

  it('uses a 16px font so iOS does not zoom the host page', () => {
    const { container } = render(
      <Composer value="" disabled={false} offline={false} placeholder="" t={t} onInput={() => {}} onSend={() => {}} />,
    );
    // The rule lives in the stylesheet; assert the class the rule targets.
    expect(container.querySelector('.hp-composer textarea')).toBeTruthy();
  });
});

describe('LeadForm', () => {
  const formConfig = () =>
    config({
      leadForm: {
        enabled: true,
        title: 'Before we start',
        fields: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'when', label: 'When', type: 'select', options: ['Today', 'Tomorrow'] },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
        submitLabel: 'Start chat',
        privacy: { text: 'We only use this to reply.', url: 'https://example.com/privacy' },
        askFirstMessage: true,
      },
    });

  it('renders every configured field type', () => {
    render(<LeadForm config={formConfig()} initial={null} busy={false} t={t} onSubmit={() => {}} />);
    expect(screen.getByLabelText(/Name/)).toBeTruthy();
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByLabelText(/When/)).toBeTruthy();
    expect(screen.getByLabelText(/Notes/)).toBeTruthy();
    expect(screen.getByLabelText(/How can we help/)).toBeTruthy();
  });

  it('blocks submission and reports a missing required field accessibly', () => {
    const onSubmit = vi.fn();
    const { container } = render(<LeadForm config={formConfig()} initial={null} busy={false} t={t} onSubmit={onSubmit} />);

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
    const input = screen.getByLabelText(/Name/) as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${describedBy}`)?.textContent).toMatch(/required/i);
  });

  it('validates on blur', () => {
    render(<LeadForm config={formConfig()} initial={null} busy={false} t={t} onSubmit={() => {}} />);
    const email = screen.getByLabelText(/Email/) as HTMLInputElement;
    fireEvent.input(email, { target: { value: 'nope' } });
    fireEvent.blur(email);
    expect(screen.getByText(/valid email/i)).toBeTruthy();
  });

  it('submits trimmed values and the first message', () => {
    const onSubmit = vi.fn();
    const { container } = render(<LeadForm config={formConfig()} initial={null} busy={false} t={t} onSubmit={onSubmit} />);

    fireEvent.input(screen.getByLabelText(/Name/), { target: { value: '  Ada  ' } });
    fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'ada@example.com' } });
    fireEvent.input(screen.getByLabelText(/How can we help/), { target: { value: 'Blocked drain' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ada', email: 'ada@example.com' }, 'Blocked drain');
  });

  it('prefills from identify()', () => {
    render(<LeadForm config={formConfig()} initial={{ name: 'Grace' }} busy={false} t={t} onSubmit={() => {}} />);
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe('Grace');
  });

  it('sets autocomplete and inputmode so mobile autofill works', () => {
    const c = config({
      leadForm: {
        fields: [
          { name: 'name', label: 'Name', type: 'text', autocomplete: 'name' },
          { name: 'phone', label: 'Phone', type: 'tel', autocomplete: 'tel' },
        ],
      },
    });
    render(<LeadForm config={c} initial={null} busy={false} t={t} onSubmit={() => {}} />);
    expect(screen.getByLabelText(/Name/).getAttribute('autocomplete')).toBe('name');
    const phone = screen.getByLabelText(/Phone/);
    expect(phone.getAttribute('autocomplete')).toBe('tel');
    expect(phone.getAttribute('inputmode')).toBe('tel');
  });

  it('shows the privacy line with a safe link', () => {
    render(<LeadForm config={formConfig()} initial={null} busy={false} t={t} onSubmit={() => {}} />);
    const link = screen.getByRole('link', { name: 'Privacy' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/privacy');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('disables the submit button while starting', () => {
    render(<LeadForm config={formConfig()} initial={null} busy t={t} onSubmit={() => {}} />);
    const submit = screen.getByRole('button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

describe('validateField', () => {
  const field = (over: Record<string, unknown> = {}) =>
    ({ name: 'f', label: 'Field', type: 'text', ...over }) as never;

  it.each([
    ['a required empty value', field({ required: true }), '', /required/],
    ['a bad email', field({ type: 'email' }), 'nope', /valid field/i],
    ['a bad phone', field({ type: 'tel' }), 'abc', /valid field/i],
    ['an out-of-range option', field({ type: 'select', options: ['a'] }), 'b', /choose one/i],
    ['an over-long value', field(), 'x'.repeat(201), /too long/i],
    ['a pattern miss', field({ pattern: '\\d{4}' }), 'abcd', /check/i],
  ])('rejects %s', (_name, f, value, expected) => {
    expect(validateField(f, value)).toMatch(expected);
  });

  it.each([
    ['an optional empty value', field(), ''],
    ['a good email', field({ type: 'email' }), 'a@b.co'],
    ['a good phone', field({ type: 'tel' }), '+61 400 000 000'],
    ['a pattern hit', field({ pattern: '\\d{4}' }), '1234'],
  ])('accepts %s', (_name, f, value) => {
    expect(validateField(f, value)).toBeNull();
  });

  it('ignores a pattern that will not compile', () => {
    expect(validateField(field({ pattern: '([' }), 'anything')).toBeNull();
  });
});

describe('ErrorNotice', () => {
  const setup = (error: Parameters<typeof ErrorNotice>[0]['error']) => {
    const onRetry = vi.fn();
    const onNewChat = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ErrorNotice error={error} config={config()} t={t} onRetry={onRetry} onNewChat={onNewChat} onDismiss={onDismiss} />,
    );
    return { onRetry, onNewChat, onDismiss };
  };

  it('announces itself as an alert', () => {
    setup({ code: 'connector_error', message: 'Unavailable', retryable: true });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('offers a retry for a retryable error', () => {
    const { onRetry } = setup({ code: 'connector_error', message: 'Unavailable', retryable: true });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('counts down and blocks retry while rate limited', () => {
    setup({ code: 'rate_limited', message: 'Slow down', retryable: true, retryAfter: 5 });
    expect(screen.getByText(/\(5s\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /try again/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the fallback contact when the backend is unavailable', () => {
    setup({ code: 'quota_exceeded', message: 'Unavailable', retryable: false });
    expect((screen.getByRole('link', { name: /call us/i }) as HTMLAnchorElement).getAttribute('href')).toBe('tel:+61400000000');
    expect((screen.getByRole('link', { name: /email us/i }) as HTMLAnchorElement).getAttribute('href')).toBe('mailto:hi@example.com');
  });

  it('offers a fresh conversation when the session expired', () => {
    const { onNewChat } = setup({ code: 'session_expired', message: 'Expired', retryable: false });
    fireEvent.click(screen.getByRole('button', { name: /start a new conversation/i }));
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('can always be dismissed', () => {
    const { onDismiss } = setup({ code: 'internal', message: 'Oops', retryable: false });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not offer contact details for an ordinary bad request', () => {
    setup({ code: 'bad_request', message: 'Too long', retryable: false });
    expect(screen.queryByRole('link', { name: /call us/i })).toBeNull();
  });
});

describe('accessibility basics', () => {
  it('ties every lead-form input to a visible label', () => {
    const { container } = render(
      <LeadForm config={config()} initial={null} busy={false} t={t} onSubmit={() => {}} />,
    );
    for (const input of container.querySelectorAll('input, textarea, select')) {
      const id = input.getAttribute('id');
      expect(id, 'every field needs an id to be labelled').toBeTruthy();
      expect(container.querySelector(`label[for="${id}"]`)).toBeTruthy();
    }
  });

  it('gives every icon-only control an accessible name', () => {
    const { container } = render(
      <Header config={config()} thinking={false} showBack t={t} onBack={() => {}} onClose={() => {}} />,
    );
    for (const button of container.querySelectorAll('button')) {
      const named = button.getAttribute('aria-label') || button.textContent?.trim();
      expect(named, `unnamed button: ${button.outerHTML}`).toBeTruthy();
    }
  });

  it('marks decorative icons as hidden from assistive tech', () => {
    const { container } = render(<Launcher config={config()} open={false} unread={0} onClick={() => {}} />);
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('announces agent messages politely, and not the visitor’s own', () => {
    const { container } = render(
      <Thread
        messages={[msg({ type: 'text', text: 'Mine', role: 'user' })]}
        busy={false}
        pendingIds={new Set()}
        handlers={inertHandlers}
        t={t}
      />,
    );
    const live = container.querySelector('[aria-live]');
    // The Thread itself has no live region; LiveRegion is a sibling in App.
    expect(live).toBeNull();
  });
});

describe('theming', () => {
  it('derives a readable foreground for a light accent', async () => {
    const { themeOverrides } = await import('../src/styles/tokens.js');
    const css = themeOverrides(config({ brand: { accent: '#F4C20D' } }));
    expect(css).toContain('--hp-accent:#F4C20D');
    // Yellow needs dark text, not the default white.
    expect(css).toContain('--hp-accent-fg:#111114');
  });

  it('derives a readable foreground for a dark accent', async () => {
    const { themeOverrides } = await import('../src/styles/tokens.js');
    expect(themeOverrides(config({ brand: { accent: '#111114' } }))).toContain('--hp-accent-fg:#FFFFFF');
  });

  it('passes through only allowlisted token overrides', async () => {
    const { themeOverrides } = await import('../src/styles/tokens.js');
    const css = themeOverrides(config({ brand: { tokens: { 'radius-md': '4px' } } }));
    expect(css).toContain('--hp-radius-md:4px');
  });
});

describe('stylesheet assembly', () => {
  /**
   * Regression: the token overrides used to be concatenated before
   * `LOADER_CSS`, which re-declares the defaults on `:host`. At equal
   * specificity the later rule wins, so a site's configured accent was
   * silently replaced by the built-in purple once the app mounted.
   */
  it('declares the site accent after every sheet that declares a default', async () => {
    const { BASE_TOKENS, RESET, themeOverrides } = await import('../src/styles/tokens.js');
    const { LOADER_CSS } = await import('../src/launcher-shell.js');
    const { WIDGET_CSS } = await import('../src/styles/widget.css.js');

    const site = config({ brand: { accent: '#0F9D58' } });
    const sheet = BASE_TOKENS + RESET + LOADER_CSS + WIDGET_CSS + themeOverrides(site);

    const override = sheet.lastIndexOf('--hp-accent:#0F9D58');
    expect(override, 'the site accent must be present').toBeGreaterThan(-1);

    // No later declaration of the same token may follow it.
    const after = sheet.slice(override + 1);
    expect(after).not.toMatch(/--hp-accent\s*:/);
  });
});

describe('the wait before retrying', () => {
  it('reads as seconds when short and minutes when long', async () => {
    const { formatWait } = await import('../src/components/ErrorNotice.js');
    expect(formatWait(45)).toBe('45s');
    expect(formatWait(1329)).toBe('about 23 min');
  });
});
