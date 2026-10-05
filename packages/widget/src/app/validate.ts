import { isHttpUrl, isSafeUrl } from '@murmur/protocol/url';
import type { Action, Field, Flow, FlowStep, Img, Message, Option, Shortcut, WidgetConfig } from '@murmur/protocol';

/**
 * Boundary validation for the widget: config and every message from the
 * server are parsed before use. A field of the wrong type is treated as absent
 * and its default applied; an unknown message type is dropped.
 *
 * This deliberately mirrors the Zod schemas in `@murmur/protocol` rather than
 * importing them — Zod would cost more than a third of the widget's 35 kb
 * budget. `test/validate.test.ts` cross-checks the two on shared
 * fixtures so they cannot drift apart.
 */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;

const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

function list<T>(v: unknown, max: number, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v.slice(0, max)) {
    const parsed = parse(item);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

// ---------------------------------------------------------------- actions

export function parseAction(input: unknown): Action | null {
  if (!isObject(input)) return null;
  const id = str(input['id'], 64);
  const label = str(input['label'], 120);
  if (!id || !label) return null;

  switch (input['kind']) {
    case 'reply': {
      const value = str(input['value'], 500);
      return value ? { id, kind: 'reply', label, value } : null;
    }
    case 'url': {
      const url = input['url'];
      if (!isSafeUrl(url) || url.length > 2048) return null;
      const newTab = bool(input['newTab']);
      return { id, kind: 'url', label, url, ...(newTab === undefined ? {} : { newTab }) };
    }
    case 'tel': {
      const phone = str(input['phone'], 40);
      return phone ? { id, kind: 'tel', label, phone } : null;
    }
    case 'email': {
      const email = str(input['email'], 200);
      return email && email.length >= 3 ? { id, kind: 'email', label, email } : null;
    }
    case 'flow': {
      const flowId = str(input['flowId'], 64);
      return flowId ? { id, kind: 'flow', label, flowId } : null;
    }
    case 'form': {
      const formId = str(input['formId'], 64);
      return formId ? { id, kind: 'form', label, formId } : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- pieces

function parseOption(input: unknown): Option | null {
  if (!isObject(input)) return null;
  const id = str(input['id'], 64);
  const label = str(input['label'], 120);
  const value = str(input['value'], 500);
  return id && label && value ? { id, label, value } : null;
}

function parseImg(input: unknown): Img | null {
  if (!isObject(input)) return null;
  const src = input['src'];
  if (!isHttpUrl(src) || src.length > 2048) return null;
  const alt = typeof input['alt'] === 'string' && input['alt'].length <= 200 ? input['alt'] : '';
  const aspect = oneOf(input['aspect'], ['1:1', '16:9', '4:3'] as const);
  return { src, alt, ...(aspect ? { aspect } : {}) };
}

export function parseField(input: unknown): Field | null {
  if (!isObject(input)) return null;
  const name = str(input['name'], 64);
  const label = str(input['label'], 160);
  const type = oneOf(input['type'], ['text', 'email', 'tel', 'textarea', 'select'] as const);
  if (!name || !label || !type) return null;

  const required = bool(input['required']);
  const placeholder = str(input['placeholder'], 160);
  const pattern = str(input['pattern'], 200);
  const autocomplete = str(input['autocomplete'], 64);
  const options = list(input['options'], 50, (o) => str(o, 120) ?? null);

  return {
    name,
    label,
    type,
    ...(required === undefined ? {} : { required }),
    ...(placeholder ? { placeholder } : {}),
    ...(pattern ? { pattern } : {}),
    ...(autocomplete ? { autocomplete } : {}),
    ...(options.length > 0 ? { options } : {}),
  };
}

function parseLink(input: unknown): { label: string; url: string; description?: string } | null {
  if (!isObject(input)) return null;
  const label = str(input['label'], 160);
  const url = input['url'];
  if (!label || !isSafeUrl(url) || url.length > 2048) return null;
  const description = str(input['description'], 300);
  return { label, url, ...(description ? { description } : {}) };
}

function parseCardItem(input: unknown) {
  if (!isObject(input)) return null;
  const title = str(input['title'], 160);
  if (!title) return null;
  const body = str(input['body'], 600);
  const image = parseImg(input['image']);
  const actions = list(input['actions'], 3, parseAction);
  return {
    title,
    ...(body ? { body } : {}),
    ...(image ? { image } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  };
}

// ---------------------------------------------------------------- messages

/** An unknown or malformed message is dropped; the renderer never sees it. */
export function parseMessage(input: unknown): Message | null {
  if (!isObject(input)) return null;

  const id = str(input['id'], 64);
  const role = oneOf(input['role'], ['user', 'agent', 'system'] as const);
  const ts = num(input['ts'], 0, Number.MAX_SAFE_INTEGER);
  if (!id || !role || ts === undefined) return null;

  const base = { id, ts, role } as const;

  switch (input['type']) {
    case 'text': {
      const text = str(input['text'], 8000);
      return text ? { ...base, type: 'text', text } : null;
    }
    case 'notice': {
      const text = str(input['text'], 600);
      if (!text) return null;
      const tone = oneOf(input['tone'], ['info', 'warn'] as const);
      return { ...base, type: 'notice', text, ...(tone ? { tone } : {}) };
    }
    case 'options': {
      const options = list(input['options'], 10, parseOption);
      if (options.length === 0) return null;
      const text = str(input['text'], 2000);
      const multi = bool(input['multi']);
      return {
        ...base,
        type: 'options',
        options,
        ...(text ? { text } : {}),
        ...(multi === undefined ? {} : { multi }),
      };
    }
    case 'card': {
      const card = parseCardItem(input);
      return card ? { ...base, type: 'card', ...card } : null;
    }
    case 'carousel': {
      const cards = list(input['cards'], 10, parseCardItem);
      return cards.length > 0 ? { ...base, type: 'carousel', cards } : null;
    }
    case 'links': {
      const links = list(input['links'], 10, parseLink);
      if (links.length === 0) return null;
      const title = str(input['title'], 160);
      return { ...base, type: 'links', links, ...(title ? { title } : {}) };
    }
    case 'form': {
      const fields = list(input['fields'], 12, parseField);
      if (fields.length === 0) return null;
      const title = str(input['title'], 160);
      const submitLabel = str(input['submitLabel'], 60);
      return {
        ...base,
        type: 'form',
        fields,
        ...(title ? { title } : {}),
        ...(submitLabel ? { submitLabel } : {}),
      };
    }
    default:
      return null;
  }
}

export function parseMessages(input: unknown): Message[] {
  return list(input, 20, parseMessage);
}

// ---------------------------------------------------------------- config

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const TOKEN_VALUE_UNSAFE = /[;{}<>]|url\s*\(|expression\s*\(|@import/i;

const THEME_TOKENS = new Set([
  'accent', 'accent-fg', 'accent-soft', 'bg', 'surface', 'surface-2', 'border',
  'text', 'text-2', 'text-3', 'danger', 'font', 'text-xs', 'text-sm', 'text-md',
  'text-lg', 'text-xl', 'leading', 'tracking-tight', 'radius-sm', 'radius-md',
  'radius-lg', 'radius-panel', 'shadow-panel', 'shadow-orb', 'ease-out',
  'ease-spring', 'dur-fast', 'dur', 'dur-slow', 'panel-w', 'panel-h', 'z',
]);

export const ICONS = new Set([
  'chat', 'phone', 'mail', 'calendar', 'quote', 'pin', 'clock', 'wrench', 'heart',
  'info', 'book', 'arrow-right', 'arrow-left', 'close', 'send', 'menu', 'sound',
  'sound-off', 'check', 'external',
]);

/** Defaults applied when a site configures no lead form, or a broken one. */
export const DEFAULT_LEAD_FIELDS: Field[] = [
  { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel' },
];

function parseShortcut(input: unknown): Shortcut | null {
  if (!isObject(input)) return null;
  const id = str(input['id'], 64);
  const label = str(input['label'], 80);
  const action = parseAction(input['action']);
  if (!id || !label || !action) return null;

  const description = str(input['description'], 160);
  const icon = typeof input['icon'] === 'string' && ICONS.has(input['icon']) ? input['icon'] : undefined;
  const paths = list(input['paths'], 20, (p) => str(p, 200) ?? null);

  return {
    id,
    label,
    action,
    ...(description ? { description } : {}),
    ...(icon ? { icon: icon as Shortcut['icon'] } : {}),
    ...(paths.length > 0 ? { paths } : {}),
  };
}

function parseFlowStep(input: unknown): FlowStep | null {
  if (!isObject(input)) return null;
  const field = str(input['field'], 64);
  const ask = str(input['ask'], 400);
  const inputKind = oneOf(input['input'], ['text', 'choice', 'phone', 'email'] as const);
  if (!field || !ask || !inputKind) return null;

  const choices = list(input['choices'], 12, (c) => str(c, 120) ?? null);
  const required = bool(input['required']);
  return {
    field,
    ask,
    input: inputKind,
    ...(choices.length > 0 ? { choices } : {}),
    ...(required === undefined ? {} : { required }),
  };
}

function parseFlow(input: unknown): Flow | null {
  if (!isObject(input)) return null;
  const id = str(input['id'], 64);
  const steps = list(input['steps'], 10, parseFlowStep);
  const submit = isObject(input['submit']) ? input['submit'] : null;
  const template = submit && submit['as'] === 'message' ? str(submit['template'], 1000) : undefined;
  if (!id || steps.length === 0 || !template) return null;
  return { id, steps, submit: { as: 'message', template } };
}

function parseForms(input: unknown): WidgetConfig['forms'] | undefined {
  if (!isObject(input)) return undefined;
  const out: NonNullable<WidgetConfig['forms']> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.length > 64 || !isObject(value)) continue;
    const fields = list(value['fields'], 12, parseField);
    if (fields.length === 0) continue;
    const title = str(value['title'], 120);
    const submitLabel = str(value['submitLabel'], 60);
    out[key] = {
      fields,
      ...(title ? { title } : {}),
      ...(submitLabel ? { submitLabel } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseTokens(input: unknown): Record<string, string> | undefined {
  if (!isObject(input)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!THEME_TOKENS.has(key)) continue;
    if (typeof value !== 'string' || !value || value.length > 200) continue;
    if (TOKEN_VALUE_UNSAFE.test(value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Every optional key has a safe default, so `parseConfig({})` returns a fully
 * functional widget. Only a non-object is unusable.
 */
export function parseConfig(input: unknown): WidgetConfig | null {
  if (!isObject(input)) return null;

  const brandIn = isObject(input['brand']) ? input['brand'] : {};
  const launcherIn = isObject(input['launcher']) ? input['launcher'] : {};
  const homeIn = isObject(input['home']) ? input['home'] : {};
  const leadIn = isObject(input['leadForm']) ? input['leadForm'] : {};
  const chatIn = isObject(input['chat']) ? input['chat'] : {};

  const accentRaw = brandIn['accent'];
  const accent = typeof accentRaw === 'string' && HEX.test(accentRaw) ? accentRaw : '#5B5BF7';
  const avatar = isHttpUrl(brandIn['avatar']) ? brandIn['avatar'] : undefined;
  const tokens = parseTokens(brandIn['tokens']);

  const leadFields = list(leadIn['fields'], 12, parseField);
  const homeLinksIn = isObject(homeIn['links']) ? homeIn['links'] : null;
  const homeLinkItems = homeLinksIn ? list(homeLinksIn['items'], 10, parseLink) : [];

  const privacyIn = isObject(leadIn['privacy']) ? leadIn['privacy'] : null;
  const privacyText = privacyIn ? str(privacyIn['text'], 300) : undefined;
  const privacyUrl = privacyIn && isSafeUrl(privacyIn['url']) ? privacyIn['url'] : undefined;

  const contactIn = isObject(chatIn['fallbackContact']) ? chatIn['fallbackContact'] : null;
  const phone = contactIn ? str(contactIn['phone'], 40) : undefined;
  const email = contactIn ? str(contactIn['email'], 200) : undefined;

  const captchaIn = isObject(input['captcha']) ? input['captcha'] : null;
  const siteKey = captchaIn?.['provider'] === 'turnstile' ? str(captchaIn['siteKey'], 200) : undefined;

  const teaser = parseTeaser(input['teaser']);
  const soundIn = isObject(input['sound']) ? input['sound'] : null;
  const flows = list(input['flows'], 20, parseFlow);
  const forms = parseForms(input['forms']);

  return {
    brand: {
      name: str(brandIn['name'], 60) ?? 'Chat',
      agentName: str(brandIn['agentName'], 60) ?? 'Assistant',
      accent,
      theme: oneOf(brandIn['theme'], ['light', 'dark', 'auto'] as const) ?? 'auto',
      ...(avatar ? { avatar } : {}),
      ...(tokens ? { tokens } : {}),
    },
    launcher: {
      position: oneOf(launcherIn['position'], ['bottom-right', 'bottom-left'] as const) ?? 'bottom-right',
      icon: (typeof launcherIn['icon'] === 'string' && ICONS.has(launcherIn['icon'])
        ? launcherIn['icon']
        : 'chat') as WidgetConfig['launcher']['icon'],
      shape: oneOf(launcherIn['shape'], ['orb', 'pill'] as const) ?? 'orb',
      ...(parseOffset(launcherIn['offset']) ?? {}),
      ...(str(launcherIn['label'], 40) ? { label: str(launcherIn['label'], 40) } : {}),
      ...(() => {
        const paths = list(launcherIn['hideOnPaths'], 50, (p) => str(p, 200) ?? null);
        return paths.length > 0 ? { hideOnPaths: paths } : {};
      })(),
    },
    home: {
      title: str(homeIn['title'], 120) ?? 'Hi there',
      subtitle: str(homeIn['subtitle'], 240) ?? 'Ask anything, or pick a shortcut.',
      ...(() => {
        const shortcuts = list(homeIn['shortcuts'], 8, parseShortcut);
        return shortcuts.length > 0 ? { shortcuts } : {};
      })(),
      ...(homeLinksIn && homeLinkItems.length > 0
        ? { links: { title: str(homeLinksIn['title'], 120) ?? '', items: homeLinkItems } }
        : {}),
    },
    leadForm: {
      enabled: bool(leadIn['enabled']) ?? true,
      fields: leadFields.length > 0 ? leadFields : DEFAULT_LEAD_FIELDS,
      ...(str(leadIn['title'], 120) ? { title: str(leadIn['title'], 120) } : {}),
      ...(str(leadIn['submitLabel'], 60) ? { submitLabel: str(leadIn['submitLabel'], 60) } : {}),
      ...(privacyText && privacyUrl ? { privacy: { text: privacyText, url: privacyUrl } } : {}),
      ...(bool(leadIn['askFirstMessage']) === undefined
        ? {}
        : { askFirstMessage: bool(leadIn['askFirstMessage']) }),
    },
    chat: {
      ...(str(chatIn['placeholder'], 120) ? { placeholder: str(chatIn['placeholder'], 120) } : {}),
      ...(() => {
        const initial = list(chatIn['initialMessages'], 3, (m) => str(m, 2000) ?? null);
        return initial.length > 0 ? { initialMessages: initial } : {};
      })(),
      ...(() => {
        const shortcuts = list(chatIn['shortcuts'], 8, parseShortcut);
        return shortcuts.length > 0 ? { shortcuts } : {};
      })(),
      ...(phone || email
        ? { fallbackContact: { ...(phone ? { phone } : {}), ...(email ? { email } : {}) } }
        : {}),
    },
    ...(teaser ? { teaser } : {}),
    ...(flows.length > 0 ? { flows } : {}),
    ...(forms ? { forms } : {}),
    ...(soundIn ? { sound: { enabled: bool(soundIn['enabled']) ?? false } } : {}),
    ...(siteKey ? { captcha: { provider: 'turnstile' as const, siteKey } } : {}),
    poweredBy: parsePoweredBy(input['poweredBy']),
    ...(parseStrings(input['strings']) ?? {}),
  } as WidgetConfig;
}

function parsePoweredBy(input: unknown): WidgetConfig['poweredBy'] {
  const flag = bool(input);
  if (flag !== undefined) return flag;
  if (!isObject(input)) return true;
  const text = str(input['text'], 60);
  if (!text) return true;
  const url = input['url'];
  return isSafeUrl(url) && url.length <= 2048 ? { text, url } : { text };
}

function parseOffset(input: unknown): { offset: { x: number; y: number } } | null {
  if (!isObject(input)) return null;
  const x = num(input['x'], 0, 200);
  const y = num(input['y'], 0, 200);
  return x === undefined || y === undefined ? null : { offset: { x, y } };
}

/** How long to wait when a teaser configures no trigger of its own. */
export const DEFAULT_TEASER_DELAY_MS = 8000;

function parseTeaser(input: unknown): WidgetConfig['teaser'] | null {
  if (!isObject(input)) return null;
  const text = str(input['text'], 200);
  if (!text) return null;

  const delayMs = num(input['delayMs'], 2000, 120_000);
  const afterScroll = num(input['afterScroll'], 1, 100);
  const paths = list(input['paths'], 50, (p) => str(p, 200) ?? null);

  return {
    text,
    // A teaser with no trigger would never appear, which is never the intent.
    ...(delayMs === undefined && afterScroll === undefined
      ? { delayMs: DEFAULT_TEASER_DELAY_MS }
      : {
          ...(delayMs === undefined ? {} : { delayMs }),
          ...(afterScroll === undefined ? {} : { afterScroll }),
        }),
    oncePerSession: bool(input['oncePerSession']) ?? true,
    ...(paths.length > 0 ? { paths } : {}),
  };
}

function parseStrings(input: unknown): { strings: Record<string, string> } | null {
  if (!isObject(input)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.length <= 64 && typeof value === 'string' && value.length <= 300) out[key] = value;
  }
  return Object.keys(out).length > 0 ? { strings: out } : null;
}
