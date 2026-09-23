import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { Message } from '@murmur/protocol';
import { MessageView, inertHandlers, type MessageHandlers } from '../src/components/messages/index.js';

/** The rich message types from §4.4, added in M4. */

function setup(message: Message, overrides: Partial<MessageHandlers> = {}) {
  const handlers: MessageHandlers = {
    onPick: vi.fn(),
    onAction: vi.fn(),
    onFormSubmit: vi.fn(),
    isConsumed: () => false,
    ...overrides,
  };
  const utils = render(<MessageView message={message} handlers={handlers} />);
  return { ...utils, handlers };
}

const base = { id: 'm1', ts: Date.now(), role: 'agent' } as const;

describe('options', () => {
  const options: Message = {
    ...base,
    type: 'options',
    text: 'What would you like?',
    options: [
      { id: 'a', label: 'Get a quote', value: 'quote' },
      { id: 'b', label: 'Opening hours', value: 'hours' },
    ],
  };

  it('renders its prompt as markdown and its options as chips', () => {
    setup({ ...options, text: 'Pick **one**' });
    expect(screen.getByText('one').tagName).toBe('STRONG');
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('sends the tapped option', () => {
    const { handlers } = setup(options);
    fireEvent.click(screen.getByRole('button', { name: 'Get a quote' }));
    expect(handlers.onPick).toHaveBeenCalledWith(options, [options.options[0]]);
  });

  it('disables every chip once answered', () => {
    setup(options, { isConsumed: () => true });
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('collects a set before confirming when multi', () => {
    const multi: Message = { ...options, multi: true };
    const { handlers } = setup(multi);

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Get a quote' }));
    expect(handlers.onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Get a quote/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Opening hours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(handlers.onPick).toHaveBeenCalledWith(multi, multi.options);
  });

  it('toggles a multi option back off', () => {
    const multi: Message = { ...options, multi: true };
    setup(multi);
    const chip = screen.getByRole('button', { name: /Get a quote/ });
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(screen.getByRole('button', { name: 'Get a quote' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('card', () => {
  const card: Message = {
    ...base,
    type: 'card',
    title: 'Emergency callout',
    body: 'Within 60 minutes.',
    image: { src: 'https://example.com/van.png', alt: 'A service van', aspect: '16:9' },
    actions: [
      { id: 'book', kind: 'reply', label: 'Book it', value: 'book' },
      { id: 'call', kind: 'tel', label: 'Call now', phone: '+61400000000' },
      { id: 'more', kind: 'url', label: 'Details', url: 'https://example.com/x', newTab: true },
    ],
  };

  it('renders title, body and image with its alt text', () => {
    setup(card);
    expect(screen.getByRole('heading', { name: 'Emergency callout' })).toBeTruthy();
    expect(screen.getByText('Within 60 minutes.')).toBeTruthy();
    expect((screen.getByAltText('A service van') as HTMLImageElement).src).toBe('https://example.com/van.png');
  });

  it('sends a reply action', () => {
    const { handlers } = setup(card);
    fireEvent.click(screen.getByRole('button', { name: 'Book it' }));
    expect(handlers.onAction).toHaveBeenCalledWith(card, card.actions?.[0]);
  });

  it('renders tel and url actions as real anchors', () => {
    setup(card);
    expect((screen.getByRole('link', { name: /Call now/ }) as HTMLAnchorElement).getAttribute('href')).toBe(
      'tel:+61400000000',
    );
    const url = screen.getByRole('link', { name: /Details/ }) as HTMLAnchorElement;
    expect(url.getAttribute('href')).toBe('https://example.com/x');
    expect(url.getAttribute('rel')).toContain('noopener');
    expect(url.getAttribute('target')).toBe('_blank');
  });

  it('drops a broken image rather than leaving a placeholder glyph', () => {
    const { container } = setup(card);
    const image = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Emergency callout' })).toBeTruthy();
  });

  it('renders without an image or actions', () => {
    setup({ ...base, type: 'card', title: 'Bare' });
    expect(screen.getByRole('heading', { name: 'Bare' })).toBeTruthy();
  });
});

describe('carousel', () => {
  const carousel: Message = {
    ...base,
    type: 'carousel',
    cards: [{ title: 'Standard' }, { title: 'Priority' }, { title: 'Emergency' }],
  };

  it('renders every card in a labelled group', () => {
    const { container } = setup(carousel);
    expect(container.querySelectorAll('.mm-carousel-item')).toHaveLength(3);
    expect(screen.getByRole('group', { name: '3 options' })).toBeTruthy();
  });
});

describe('links', () => {
  const links: Message = {
    ...base,
    type: 'links',
    title: 'Might help',
    links: [
      { label: 'Pricing', url: 'https://example.com/pricing', description: 'What it costs.' },
      { label: 'Email us', url: 'mailto:hi@example.com' },
    ],
  };

  it('renders each link as a row with its description', () => {
    setup(links);
    expect(screen.getByText('Might help')).toBeTruthy();
    expect(screen.getByText('What it costs.')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('opens http links in a new tab but not mailto', () => {
    setup(links);
    expect(screen.getByRole('link', { name: /Pricing/ }).getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: /Email us/ }).getAttribute('target')).toBeNull();
  });
});

describe('inline form', () => {
  const form: Message = {
    ...base,
    type: 'form',
    title: 'Book a visit',
    submitLabel: 'Request booking',
    fields: [
      { name: 'suburb', label: 'Suburb', type: 'text', required: true },
      { name: 'when', label: 'When', type: 'select', options: ['Today', 'Tomorrow'] },
    ],
  };

  it('renders its fields with the shared field component', () => {
    setup(form);
    expect(screen.getByLabelText(/Suburb/)).toBeTruthy();
    expect(screen.getByLabelText(/When/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request booking' })).toBeTruthy();
  });

  it('blocks submission until the required field is filled', () => {
    const { container, handlers } = setup(form);
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(handlers.onFormSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Suburb is required/)).toBeTruthy();
  });

  it('submits a JSON value and a readable label', () => {
    const { container, handlers } = setup(form);
    fireEvent.input(screen.getByLabelText(/Suburb/), { target: { value: 'Richmond' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(handlers.onFormSubmit).toHaveBeenCalledWith(
      form,
      JSON.stringify({ suburb: 'Richmond' }),
      'Suburb: Richmond',
    );
  });

  it('gives every field an id its label points at', () => {
    const { container } = setup(form);
    for (const input of container.querySelectorAll('input, select, textarea')) {
      const id = input.getAttribute('id');
      expect(id).toBeTruthy();
      expect(container.querySelector(`label[for="${id}"]`)).toBeTruthy();
    }
  });

  it('is disabled once submitted', () => {
    setup(form, { isConsumed: () => true });
    expect((screen.getByRole('button', { name: 'Request booking' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('inertHandlers', () => {
  it('lets a message render without any wiring', () => {
    render(
      <MessageView
        message={{ ...base, type: 'options', options: [{ id: 'a', label: 'A', value: 'a' }] }}
        handlers={inertHandlers}
      />,
    );
    expect(screen.getByRole('button', { name: 'A' })).toBeTruthy();
  });
});
