import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * The dashboard end to end, for what the team uses every day: email
 * notifications (the owner connects a service, each person chooses), a
 * webhook in its own format, analytics, the account menu, the contacts'
 * export and the new job dialog. Served by the live-chat Worker (:8796,
 * e2e/live), whose outgoing calls to `mail.e2e.test` and `hooks.e2e.test`
 * are answered and recorded by the Worker itself (e2e/live/index.ts).
 */

const WORKER = 'http://localhost:8796';
const ADMIN_KEY = 'e2e-only-admin-key-not-for-any-deployment-012345';
const OWNER = { email: 'owner@e2e.test', password: 'owner-password-123' };
const MEMBER = { email: 'mo@e2e.test', password: 'member-password-123' };

type Sent = { host: string; path: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'the dashboard flows run once');

const admin = (request: APIRequestContext, method: string, path: string, data?: unknown) =>
  request.fetch(`${WORKER}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}` }, ...(data === undefined ? {} : { data }) });
const outbox = async (request: APIRequestContext): Promise<Sent[]> => (await request.get(`${WORKER}/fake-llm/outbox`)).json() as Promise<Sent[]>;

test.beforeAll(async ({ request }) => {
  // The same accounts as live.spec.ts; re-runs (or the other file first) find them made.
  for (const [who, role] of [
    [OWNER, 'admin'],
    [MEMBER, 'member'],
  ] as const) {
    const made = await admin(request, 'POST', '/admins', { ...who, name: who === OWNER ? 'Olivia' : 'Mo', role });
    expect([201, 409]).toContain(made.status());
  }
});

async function signIn(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const context = await browser.newContext({ baseURL: WORKER });
  // These tabs never join live chat: an open dashboard counts as someone available, and live.spec.ts,
  // running beside this file, needs nobody to be.
  await context.routeWebSocket(/\/admin\/api\/live\/socket/, () => {});
  const page = await context.newPage();
  await page.goto('/admin/');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  return page;
}

test('the owner connects an email service, chooses an email, and a new contact emails only them', async ({ browser, request }) => {
  await request.delete(`${WORKER}/fake-llm/outbox`);
  const page = await signIn(browser, OWNER);
  await page.goto('/admin/#/settings/notifications');

  // Any service: the request written by hand, the key in a secret header.
  const service = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save' }) });
  await service.getByLabel('Service').selectOption('custom');
  await service.getByLabel('Address').fill('https://mail.e2e.test/send');
  await service.getByRole('button', { name: 'Add a header' }).click();
  await service.getByLabel('Header 2 name').fill('X-Api-Key');
  await service.getByLabel('Header 2 value').fill('e2e-mail-key');
  await expect(service.getByRole('checkbox', { name: 'Secret' }).nth(1)).toBeChecked();
  await service.getByLabel('Body').fill('{"to": "{{email.to}}", "subject": "{{email.subject}}", "text": "{{email.text}}"}');

  await service.getByRole('button', { name: 'Send me a test' }).click();
  await expect(page.getByText(`Sent to ${OWNER.email}`)).toBeVisible();
  const test = (await outbox(request)).find((s) => s.host === 'mail.e2e.test');
  expect(test).toMatchObject({ method: 'POST', path: '/send', body: { to: OWNER.email, subject: 'A test from HelpPuff' } });
  expect(test!.headers['x-api-key']).toBe('e2e-mail-key');

  await service.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('https://mail.e2e.test/send')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send me a test' })).toBeVisible();

  // Only for the owner: they tick New contact; the member has chosen nothing.
  await page.getByRole('checkbox', { name: /New contact/ }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await request.delete(`${WORKER}/fake-llm/outbox`);
  expect((await admin(request, 'POST', '/leads', { site: 'demo', name: 'Ada Email', email: 'ada.email@example.com', phone: '0400 000 111' })).status()).toBe(201);
  await expect.poll(async () => (await outbox(request)).filter((s) => s.host === 'mail.e2e.test').map((s) => [s.body['to'], s.body['subject']])).toEqual([[OWNER.email, 'New contact: Ada Email']]);
  const email = (await outbox(request)).find((s) => s.host === 'mail.e2e.test')!;
  expect(String(email.body['text'])).toContain('Phone: 0400 000 111');
  // Added over the API, so no conversation: the email links to the contacts.
  expect(String(email.body['text'])).toContain(`${WORKER}/admin/#/leads`);
  await page.context().close();
});

test('a member chooses their own emails, without the email service or the admins’ ones', async ({ browser }) => {
  const page = await signIn(browser, MEMBER);
  await page.getByRole('button', { name: /Your account/ }).click();
  await page.getByRole('menuitem', { name: 'Notifications' }).click();
  await expect(page.getByText('Email me when')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /A chat given to me/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /AI budget used up/ })).toHaveCount(0);
  await expect(page.getByText('Email service')).toHaveCount(0);
  await page.context().close();
});

test('a webhook in its own format: made in the form, sent as written, signed', async ({ browser, request }) => {
  const page = await signIn(browser, OWNER);
  await page.goto('/admin/#/settings/webhooks');
  await page.getByRole('button', { name: 'Add webhook' }).first().click();
  const form = page.locator('form').filter({ has: page.getByRole('radiogroup', { name: 'What to send' }) });
  await form.getByRole('radio', { name: 'Your own request' }).click();
  // Choosing the format never submits the form.
  await expect(form).toBeVisible();
  await form.getByLabel('Method').selectOption('PUT');
  await form.getByLabel('Address').fill('https://hooks.e2e.test/leads/{{data.email}}');
  await form.getByLabel('Body').fill('{"name": "{{data.name}}", "event": "{{event.type}}"}');
  await form.getByLabel('Description (optional)').fill('E2E custom webhook');
  await form.getByRole('button', { name: 'Add webhook' }).click();
  await expect(page.getByText('Your own request · PUT')).toBeVisible();

  await request.delete(`${WORKER}/fake-llm/outbox`);
  expect((await admin(request, 'POST', '/leads', { site: 'demo', name: 'Ben Hook', email: 'ben.hook@example.com' })).status()).toBe(201);
  await expect
    .poll(async () => (await outbox(request)).filter((s) => s.host === 'hooks.e2e.test' && s.body['name'] === 'Ben Hook').map((s) => [s.method, s.path, s.body['event']]))
    .toEqual([['PUT', `/leads/${encodeURIComponent('ben.hook@example.com')}`, 'lead.captured']]);
  const delivery = (await outbox(request)).find((s) => s.host === 'hooks.e2e.test' && s.body['name'] === 'Ben Hook')!;
  expect(delivery.headers['x-helppuff-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  expect(delivery.headers['x-helppuff-event']).toBe('lead.captured');

  // Leave nothing behind for the next run.
  const { webhooks } = (await (await admin(request, 'GET', '/webhooks?site=demo')).json()) as { webhooks: { id: string; url: string }[] };
  for (const hook of webhooks.filter((w) => w.url.startsWith('https://hooks.e2e.test/'))) await admin(request, 'DELETE', `/webhooks/${hook.id}?site=demo`);
  await page.context().close();
});

test('analytics says how the assistant is doing, with nothing failing to report', async ({ browser }) => {
  const page = await signIn(browser, OWNER);
  await page.goto('/admin/#/analytics');
  for (const tile of ['Conversations', 'Solved by the assistant', 'Became a contact', 'Needed a person', 'Could not answer', 'Rated helpful']) {
    await expect(page.getByRole('main').getByText(tile, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('How conversations ended')).toBeVisible();
  await expect(page.getByText('Questions it could not answer')).toBeVisible();
  await expect(page.getByText('When visitors chat')).toBeVisible();
  await page.getByRole('radio', { name: '7 days' }).click();
  await expect(page.getByText('last 7 days')).toBeVisible();
  await page.context().close();
});

test('contacts export as CSV without leaving the page', async ({ browser }) => {
  const page = await signIn(browser, OWNER);
  await page.goto('/admin/#/leads');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(page.url()).toContain('#/leads');
  await page.context().close();
});

test('the new job dialog closes on Escape and gives focus back', async ({ browser }) => {
  const page = await signIn(browser, OWNER);
  await page.goto('/admin/#/jobs');
  const open = page.getByRole('main').getByRole('button', { name: /^New / }).first();
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await page.context().close();
});

test('the account menu shows who is signed in, and signs out', async ({ browser }) => {
  const page = await signIn(browser, OWNER);
  // HelpPuff's mark beside the site's name.
  await expect(page.locator('aside svg path[fill="var(--hp-mark)"]').first()).toBeVisible();
  await page.getByRole('button', { name: /Your account/ }).click();
  const menu = page.getByRole('menu', { name: 'Your account' });
  await expect(menu).toContainText(OWNER.email);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: /Your account/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your dashboard' })).toBeVisible();
  await page.context().close();
});
