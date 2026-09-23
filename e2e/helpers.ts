import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The widget lives entirely inside a shadow root. Playwright pierces open
 * shadow roots automatically, so these helpers just name the parts.
 */
export const widget = (page: Page) => page.locator('murmur-widget');
export const launcher = (page: Page) => page.locator('murmur-widget .mm-orb');
export const panel = (page: Page) => page.locator('murmur-widget .mm-panel');
export const thread = (page: Page) => page.locator('murmur-widget .mm-thread');
export const composer = (page: Page) => page.locator('murmur-widget .mm-composer textarea');
export const sendButton = (page: Page) => page.locator('murmur-widget .mm-send');

/** Agent messages, in order. */
export const agentMessages = (page: Page) => page.locator('murmur-widget .mm-agent');
export const userMessages = (page: Page) => page.locator('murmur-widget .mm-user');

export async function openWidget(page: Page): Promise<void> {
  await expect(launcher(page)).toBeVisible();
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
}

/**
 * Home → (lead form) → a live conversation.
 *
 * The form is filled from what it actually renders rather than from a fixed
 * list of fields. Hardcoding name and phone meant that adding a required
 * email to the config broke 87 tests at once, all of them reporting a missing
 * message rather than a blocked submit — the form is configuration, so the
 * helper has to read it.
 */
export async function startConversation(page: Page, lead: Record<string, string> = {}): Promise<void> {
  await page.locator('murmur-widget .mm-btn').first().click();

  const fields = page.locator('murmur-widget .mm-form input');
  if (await fields.first().isVisible().catch(() => false)) {
    const count = await fields.count();
    for (let i = 0; i < count; i += 1) {
      const field = fields.nth(i);
      const name = (await field.getAttribute('id'))?.replace('mm-f-', '') ?? '';
      const type = await field.getAttribute('type');
      const value =
        lead[name] ??
        (type === 'email' ? 'ada@example.com' : type === 'tel' ? '0400 000 000' : 'Ada');
      await field.fill(value);
    }
    await page.locator('murmur-widget button[type="submit"]').click();
  }

  // The composer appears as soon as the form is submitted, while the session
  // is still starting. Wait for the greeting so callers get a live session.
  await expect(composer(page)).toBeVisible();
  await expect(agentMessages(page).first()).toBeVisible();
}

export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await sendButton(page).click();
}

/**
 * Collect console output so a test can assert the widget stayed silent (§8.3).
 * Vite's own dev-server chatter is filtered out.
 */
export function captureConsole(page: Page): { messages: string[]; errors: string[] } {
  const messages: string[] = [];
  const errors: string[] = [];
  const ignore = /\[vite\]|Download the .* DevTools|favicon/i;

  page.on('console', (message) => {
    const text = message.text();
    if (ignore.test(text)) return;
    messages.push(`${message.type()}: ${text}`);
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  return { messages, errors };
}

/** A fingerprint of the host page, to prove the widget changed nothing. */
export async function hostFingerprint(page: Page) {
  return page.evaluate(() => {
    const body = document.body;
    const wrap = document.querySelector('.wrap') as HTMLElement | null;
    return {
      bodyOverflow: body.style.overflow,
      bodyClass: body.className,
      scrollHeight: document.documentElement.scrollHeight,
      headStyles: document.head.querySelectorAll('style,link[rel=stylesheet]').length,
      wrapWidth: wrap?.getBoundingClientRect().width ?? 0,
      // Anything the widget added outside its own host element would show
      // here; the host element itself is expected and excluded.
      bodyChildTags: [...body.children]
        .map((c) => c.tagName.toLowerCase())
        .filter((tag) => tag !== 'murmur-widget')
        .join(','),
    };
  });
}

export async function expectNoWidgetInDom(page: Page): Promise<void> {
  await expect(page.locator('murmur-widget')).toHaveCount(0);
}

/** `window.Murmur` must stay callable and inert after a fatal error. */
export async function expectInertApi(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { Murmur?: Record<string, unknown> }).Murmur;
    if (!api) return { present: false, threw: 'no global' };
    try {
      for (const name of ['open', 'close', 'toggle', 'reset', 'destroy']) {
        (api[name] as () => void)();
      }
      (api['send'] as (t: string) => void)('hello');
      (api['identify'] as (l: object) => void)({ name: 'Ada' });
      return { present: true, threw: null };
    } catch (error) {
      return { present: true, threw: String(error) };
    }
  });

  expect(result.present, 'window.Murmur must remain defined').toBe(true);
  expect(result.threw, 'window.Murmur methods must never throw').toBeNull();
}

export async function pixelBox(locator: Locator) {
  return locator.boundingBox();
}
