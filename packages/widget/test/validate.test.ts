import { describe, expect, it } from 'vitest';
import { actionSchema, messageSchema, widgetConfigSchema } from '@helppuff/protocol';
import { invalidMessages, validMessages } from '../../protocol/test/fixtures.js';
import {
  DEFAULT_LEAD_FIELDS,
  DEFAULT_TEASER_DELAY_MS,
  parseAction,
  parseConfig,
  parseMessage,
  parseMessages,
} from '../src/app/validate.js';

/**
 * The widget cannot ship Zod, so `validate.ts` reimplements the schemas by
 * hand. These tests are what stop the two drifting apart.
 *
 * The relationship between them is deliberately asymmetric, not identical.
 * The server is strict: a message that breaks any rule is dropped whole, so a
 * connector cannot smuggle anything past it. The widget is salvaging: the fail-safe
 * says to prefer a missing feature over a blank space, so a card with an
 * unsafe image renders without the image rather than not at all.
 *
 * Two invariants hold that asymmetry safe:
 *   1. Anything Zod accepts, the widget must also accept — no false rejections.
 *   2. Anything the widget produces must satisfy Zod — salvaging can drop
 *      parts of a message, never loosen what survives.
 */
describe('agreement with the protocol Zod schemas', () => {
  it.each(validMessages.map((m) => [m.type, m] as const))('both accept a valid %s message', (_type, message) => {
    expect(messageSchema.safeParse(message).success).toBe(true);
    expect(parseMessage(message)).not.toBeNull();
  });

  it.each(invalidMessages)('never emits something Zod would reject, given %s', (_name, value) => {
    expect(messageSchema.safeParse(value).success).toBe(false);
    const salvaged = parseMessage(value);
    if (salvaged === null) return;
    const recheck = messageSchema.safeParse(salvaged);
    expect(
      recheck.success,
      `salvaged an invalid message: ${JSON.stringify(salvaged)}`,
    ).toBe(true);
  });

  it.each([
    ['missing id', { ts: 1, role: 'agent', type: 'text', text: 'hi' }],
    ['unknown role', { id: 'm', ts: 1, role: 'robot', type: 'text', text: 'hi' }],
    ['unknown type', { id: 'm', ts: 1, role: 'agent', type: 'video' }],
    ['empty text', { id: 'm', ts: 1, role: 'agent', type: 'text', text: '' }],
    ['a form with no usable fields', { id: 'm', ts: 1, role: 'agent', type: 'form', fields: [] }],
    ['options with nothing usable', { id: 'm', ts: 1, role: 'agent', type: 'options', options: [{ id: 'a' }] }],
  ])('drops %s outright, since there is nothing to salvage', (_name, value) => {
    expect(parseMessage(value)).toBeNull();
  });

  it('a valid message survives the round trip unchanged in substance', () => {
    for (const message of validMessages) {
      const parsed = parseMessage(message);
      expect(messageSchema.safeParse(parsed).success, `re-parse failed for ${message.type}`).toBe(true);
    }
  });

  it.each([
    ['reply', { id: 'a', kind: 'reply', label: 'Yes', value: 'yes' }],
    ['url', { id: 'a', kind: 'url', label: 'Site', url: 'https://example.com' }],
    ['tel', { id: 'a', kind: 'tel', label: 'Call', phone: '+61400000000' }],
    ['email', { id: 'a', kind: 'email', label: 'Mail', email: 'a@b.co' }],
    ['flow', { id: 'a', kind: 'flow', label: 'Quote', flowId: 'quote' }],
    ['form', { id: 'a', kind: 'form', label: 'Book', formId: 'booking' }],
  ])('both accept a %s action', (_kind, action) => {
    expect(actionSchema.safeParse(action).success).toBe(true);
    expect(parseAction(action)).not.toBeNull();
  });

  it.each([
    ['a javascript: url', { id: 'a', kind: 'url', label: 'x', url: 'javascript:alert(1)' }],
    ['a data: url', { id: 'a', kind: 'url', label: 'x', url: 'data:text/html,x' }],
    ['a relative url', { id: 'a', kind: 'url', label: 'x', url: '/relative' }],
    ['an unknown kind', { id: 'a', kind: 'ussd', label: 'x', value: 'v' }],
    ['a missing label', { id: 'a', kind: 'reply', value: 'v' }],
  ])('both reject %s', (_name, action) => {
    expect(actionSchema.safeParse(action).success).toBe(false);
    expect(parseAction(action)).toBeNull();
  });

  it('the widget config parser produces something the Zod schema accepts', () => {
    const rich = {
      brand: { name: 'Knowtific', agentName: 'Alex', accent: '#112233', theme: 'dark', tokens: { 'radius-md': '8px' } },
      launcher: { position: 'bottom-left', label: 'Ask us', offset: { x: 20, y: 24 }, hideOnPaths: ['/checkout*'] },
      home: {
        title: 'Hello',
        subtitle: 'Pick one',
        shortcuts: [{ id: 's', label: 'Quote', icon: 'quote', action: { id: 'a', kind: 'reply', label: 'Quote', value: 'q' } }],
        links: { title: 'Help', items: [{ label: 'Docs', url: 'https://a.co', description: 'd' }] },
      },
      leadForm: {
        enabled: true,
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
        privacy: { text: 'Privacy', url: 'https://a.co/p' },
        askFirstMessage: true,
      },
      chat: { placeholder: 'Type…', fallbackContact: { phone: '+61400000000', email: 'a@b.co' } },
      teaser: { text: 'Hi', delayMs: 8000, oncePerSession: true },
      sound: { enabled: true },
      captcha: { provider: 'turnstile', siteKey: '0xAAA' },
      poweredBy: false,
    };
    const parsed = parseConfig(rich);
    expect(parsed).not.toBeNull();
    const zod = widgetConfigSchema.safeParse(parsed);
    expect(zod.success, JSON.stringify(zod.success ? {} : zod.error.issues)).toBe(true);
  });

  it('both produce the same defaults from an empty config', () => {
    const mine = parseConfig({});
    const theirs = widgetConfigSchema.parse({});
    expect(mine?.brand).toEqual(theirs.brand);
    expect(mine?.launcher.position).toBe(theirs.launcher.position);
    expect(mine?.home.title).toBe(theirs.home.title);
    expect(mine?.home.subtitle).toBe(theirs.home.subtitle);
    expect(mine?.leadForm.enabled).toBe(theirs.leadForm.enabled);
    expect(mine?.leadForm.fields).toEqual(theirs.leadForm.fields);
    expect(mine?.poweredBy).toBe(theirs.poweredBy);
  });
});

describe('parseConfig — poweredBy', () => {
  it('passes a whitelabelled credit through in a shape Zod accepts', () => {
    const value = { text: 'Powered by Knowtific', url: 'https://www.knowtific.com.au/' };
    const parsed = parseConfig({ poweredBy: value });
    expect(parsed?.poweredBy).toEqual(value);
    expect(widgetConfigSchema.safeParse(parsed).success).toBe(true);
  });

  it('drops an unsafe link but keeps the text', () => {
    expect(parseConfig({ poweredBy: { text: 'Knowtific', url: 'javascript:alert(1)' } })?.poweredBy).toEqual({
      text: 'Knowtific',
    });
  });

  it('falls back to the default credit when the object has no usable text', () => {
    expect(parseConfig({ poweredBy: { url: 'https://a.co' } })?.poweredBy).toBe(true);
    expect(parseConfig({ poweredBy: 'yes' })?.poweredBy).toBe(true);
  });
});

describe('parseConfig — conservative defaults', () => {
  it('makes a fully functional widget from {}', () => {
    const config = parseConfig({});
    expect(config).not.toBeNull();
    expect(config?.brand.accent).toBe('#5B5BF7');
    expect(config?.leadForm.fields).toEqual(DEFAULT_LEAD_FIELDS);
  });

  it('is null only for something that is not an object', () => {
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig('nope')).toBeNull();
    expect(parseConfig([])).toBeNull();
    expect(parseConfig(42)).toBeNull();
  });

  it('falls back to the built-in accent when the configured one is not a colour', () => {
    expect(parseConfig({ brand: { accent: 'red' } })?.brand.accent).toBe('#5B5BF7');
    expect(parseConfig({ brand: { accent: 'red; }' } })?.brand.accent).toBe('#5B5BF7');
    expect(parseConfig({ brand: { accent: 42 } })?.brand.accent).toBe('#5B5BF7');
  });

  it('falls back to the default fields when the configured ones are malformed', () => {
    expect(parseConfig({ leadForm: { fields: 'nope' } })?.leadForm.fields).toEqual(DEFAULT_LEAD_FIELDS);
    expect(parseConfig({ leadForm: { fields: [] } })?.leadForm.fields).toEqual(DEFAULT_LEAD_FIELDS);
    expect(parseConfig({ leadForm: { fields: [{ name: 'a' }] } })?.leadForm.fields).toEqual(DEFAULT_LEAD_FIELDS);
  });

  it('keeps the good fields from a partly malformed list', () => {
    const config = parseConfig({
      leadForm: { fields: [{ name: 'a', label: 'A', type: 'text' }, { nope: true }] },
    });
    expect(config?.leadForm.fields).toHaveLength(1);
  });

  it('treats a wrong-typed section as absent rather than failing', () => {
    const config = parseConfig({ brand: 'nope', home: 42, leadForm: [], chat: null });
    expect(config?.brand.name).toBe('Chat');
    expect(config?.home.title).toBe('Hi there');
    expect(config?.leadForm.fields).toEqual(DEFAULT_LEAD_FIELDS);
  });

  it('drops an unsafe privacy link but keeps the rest of the form', () => {
    const config = parseConfig({
      leadForm: { privacy: { text: 'Privacy', url: 'javascript:alert(1)' } },
    });
    expect(config?.leadForm.privacy).toBeUndefined();
    expect(config?.leadForm.enabled).toBe(true);
  });

  it('drops a non-https avatar', () => {
    expect(parseConfig({ brand: { avatar: 'javascript:alert(1)' } })?.brand.avatar).toBeUndefined();
    expect(parseConfig({ brand: { avatar: 'https://a.co/x.png' } })?.brand.avatar).toBe('https://a.co/x.png');
  });

  it('drops theme tokens that are unknown or could break out of a declaration', () => {
    const config = parseConfig({
      brand: {
        tokens: {
          'radius-md': '8px',
          'accent-glow': '#fff',
          accent: 'red; background: url(https://evil.example/x)',
          font: '@import "https://evil.example/f.css"',
        },
      },
    });
    expect(config?.brand.tokens).toEqual({ 'radius-md': '8px' });
  });

  it('keeps a valid teaser delay', () => {
    expect(parseConfig({ teaser: { text: 'Hi', delayMs: 3000 } })?.teaser).toMatchObject({ delayMs: 3000 });
  });

  it('falls back to the default delay when the configured one is unusable', () => {
    // Fail-safe: a field of the wrong type is treated as absent and its default
    // applied — dropping the whole teaser would hide a configured feature.
    expect(parseConfig({ teaser: { text: 'Hi', delayMs: 500 } })?.teaser).toMatchObject({
      delayMs: DEFAULT_TEASER_DELAY_MS,
    });
    expect(parseConfig({ teaser: { text: 'Hi', delayMs: 'soon' } })?.teaser).toMatchObject({
      delayMs: DEFAULT_TEASER_DELAY_MS,
    });
  });

  it('drops a teaser with no text, since there is nothing to show', () => {
    expect(parseConfig({ teaser: { delayMs: 3000 } })?.teaser).toBeUndefined();
  });

  it('accepts a scroll trigger on its own, with no delay', () => {
    const teaser = parseConfig({ teaser: { text: 'Hi', afterScroll: 40 } })?.teaser;
    expect(teaser).toMatchObject({ afterScroll: 40 });
    expect(teaser?.delayMs).toBeUndefined();
  });

  it('accepts both triggers together', () => {
    expect(parseConfig({ teaser: { text: 'Hi', delayMs: 5000, afterScroll: 25 } })?.teaser).toMatchObject({
      delayMs: 5000,
      afterScroll: 25,
    });
  });

  it('ignores a scroll trigger outside 1-100', () => {
    expect(parseConfig({ teaser: { text: 'Hi', afterScroll: 0 } })?.teaser?.afterScroll).toBeUndefined();
    expect(parseConfig({ teaser: { text: 'Hi', afterScroll: 150 } })?.teaser?.afterScroll).toBeUndefined();
  });

  it('accepts any built-in icon on the launcher', () => {
    // Regression: the list was once trimmed to eight to save bytes in the
    // loader, which excluded obvious choices like a wrench for a trade.
    for (const icon of ['wrench', 'pin', 'clock', 'heart', 'phone', 'book']) {
      expect(parseConfig({ launcher: { icon } })?.launcher.icon, icon).toBe(icon);
    }
  });

  it('defaults the launcher icon and shape, and rejects unknown ones', () => {
    const base = parseConfig({})?.launcher;
    expect(base).toMatchObject({ icon: 'chat', shape: 'orb' });
    expect(parseConfig({ launcher: { icon: 'heart', shape: 'pill' } })?.launcher).toMatchObject({
      icon: 'heart',
      shape: 'pill',
    });
    expect(parseConfig({ launcher: { icon: 'skull', shape: 'hexagon' } })?.launcher).toMatchObject({
      icon: 'chat',
      shape: 'orb',
    });
  });

  it('drops a shortcut whose action is unusable', () => {
    const config = parseConfig({
      home: {
        shortcuts: [
          { id: 'a', label: 'Good', action: { id: 'x', kind: 'reply', label: 'Go', value: 'v' } },
          { id: 'b', label: 'Bad', action: { id: 'y', kind: 'url', label: 'Go', url: 'javascript:alert(1)' } },
          { id: 'c', label: 'No action' },
        ],
      },
    });
    expect(config?.home.shortcuts).toHaveLength(1);
    expect(config?.home.shortcuts?.[0]?.id).toBe('a');
  });

  it('drops an unknown icon name rather than rendering nothing', () => {
    const shortcut = {
      id: 'a', label: 'L', icon: 'skull', action: { id: 'x', kind: 'reply', label: 'Go', value: 'v' },
    };
    expect(parseConfig({ home: { shortcuts: [shortcut] } })?.home.shortcuts?.[0]?.icon).toBeUndefined();
  });
});

describe('parseMessages', () => {
  it('drops the bad and keeps the good', () => {
    const good = { id: 'm1', ts: 1, role: 'agent', type: 'text', text: 'ok' };
    expect(parseMessages([good, { type: 'video' }, null, good])).toHaveLength(2);
  });

  it('returns nothing for a non-array', () => {
    expect(parseMessages({ messages: [] })).toEqual([]);
    expect(parseMessages(undefined)).toEqual([]);
  });

  it('caps a batch at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, ts: 1, role: 'agent', type: 'text', text: 'x' }));
    expect(parseMessages(many)).toHaveLength(20);
  });

  it('drops an options message whose options are all unusable', () => {
    const message = { id: 'm', ts: 1, role: 'agent', type: 'options', options: [{ id: 'a' }, null] };
    expect(parseMessage(message)).toBeNull();
  });

  it('keeps a card but drops its unsafe image and over-long action list', () => {
    const message = {
      id: 'm', ts: 1, role: 'agent', type: 'card', title: 'T',
      image: { src: 'javascript:alert(1)', alt: '' },
      actions: Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, kind: 'reply', label: 'L', value: 'v' })),
    };
    const parsed = parseMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({ type: 'card', title: 'T' });
    expect((parsed as { image?: unknown }).image).toBeUndefined();
    expect((parsed as { actions?: unknown[] }).actions).toHaveLength(3);
    // Whatever survives must still satisfy the real schema.
    expect(messageSchema.safeParse(parsed).success).toBe(true);
  });
});
