import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { send, startConversation, thread } from './helpers';

/**
 * Tools, end to end on the live-chat Worker (:8796, e2e/live): the owner
 * pastes a curl on the Prompt page, tests it, names it in the prompt with the
 * `{{` autocomplete and publishes; a visitor asks about an order, the model
 * (a fake OpenAI-compatible API) calls the tool, the Worker calls the
 * owner's API with the stored key, and the answer and the conversation's data
 * show what came back.
 */

type Json = Record<string, any>;

const WORKER = 'http://localhost:8796';
const ADMIN_KEY = 'e2e-only-admin-key-not-for-any-deployment-012345';
const OWNER = { email: 'tools-owner@e2e.test', password: 'tools-owner-password-123' };

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'the Prompt page is a desktop page; one browser is enough');

const admin = async (request: APIRequestContext, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown) => {
  const response = await request.fetch(`${WORKER}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}` }, ...(data ? { data } : {}) });
  return { status: response.status(), body: (await response.json()) as Json };
};

/** A known start for each test: no tools on the tools site, and this prompt. */
async function reset(request: APIRequestContext, text = 'You help Acme Plumbing.') {
  for (const tool of (await admin(request, 'GET', '/tools?site=tools')).body['tools'] as Json[]) await admin(request, 'DELETE', `/tools/${tool['id']}?site=tools`);
  const prompt = (await admin(request, 'GET', '/prompt?site=tools')).body;
  if (prompt['text'] !== text) await admin(request, 'POST', '/prompt', { site: 'tools', text, baseVersion: prompt['version'] });
}

test.beforeAll(async ({ request }) => {
  const made = await admin(request, 'POST', '/admins', { ...OWNER, name: 'Tia', role: 'admin' });
  expect([201, 409]).toContain(made.status);
});

async function signIn(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: WORKER })).newPage();
  // Never an available agent: live.spec (same Worker, in parallel) needs nobody free.
  await page.addInitScript(() => {
    (window as unknown as { WebSocket: unknown }).WebSocket = class {
      readyState = 0;
      send() {}
      close() {}
    };
  });
  await page.goto('/admin/');
  await page.getByLabel(/email/i).fill(OWNER.email);
  await page.getByLabel(/password/i).fill(OWNER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  return page;
}

test('a tool made from a curl answers a visitor’s question about their order', async ({ browser, request }) => {
  await reset(request);
  const page = await signIn(browser);
  await page.goto('/admin/#/prompt');
  await page.getByLabel('Site').selectOption('tools');
  await expect(page.getByRole('heading', { name: /Before the chat/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /After the chat/ })).toBeVisible();

  // The prompt opens from its step; "+ Add" there makes a tool for the chat. Paste a curl: method, URL and the key (kept secret) are read from it.
  await page.getByRole('button', { name: /^Prompt/ }).click();
  await page.getByRole('button', { name: 'Add a tool to the prompt' }).click();
  await page.getByRole('menuitem', { name: 'New tool' }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('curl command').fill(`curl https://tools.e2e.test/orders/{{args.order_number}} -H 'Authorization: Bearer e2e-tool-key'`);
  await dialog.getByRole('button', { name: /Read the curl/ }).click();
  await expect(dialog.getByLabel('URL')).toHaveValue('https://tools.e2e.test/orders/{{args.order_number}}');
  await expect(dialog.getByLabel('Header 1 value')).toHaveAttribute('type', 'password');
  await dialog.getByLabel('Name', { exact: true }).fill('order_status');
  await dialog.getByLabel('What it does, for the assistant').fill('Look up an order by its number: status and delivery day.');
  await dialog.getByLabel('What order_number is').fill('Like A-1042');

  // Test it with a sample, and keep two keys.
  await dialog.getByPlaceholder('Sample value').fill('A-7');
  await dialog.getByRole('button', { name: 'Test' }).click();
  await expect(dialog.getByRole('status')).toContainText('"warehouse": "Botany"');
  await dialog.getByLabel('status', { exact: true }).check();
  await dialog.getByLabel('eta', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Add tool' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /order_status/ }).first()).toBeVisible();

  // The key is stored, never shown again.
  const listed = (await admin(request, 'GET', '/tools?site=tools')).body['tools'] as Json[];
  expect(listed[0]).toMatchObject({ name: 'order_status', pick: ['status', 'eta'], headers: [{ name: 'Authorization', value: '', secret: true, set: true }] });

  // It went into the prompt as a sentence; reword it with the autocomplete, and publish.
  const editor = page.getByRole('combobox', { name: 'System prompt' });
  await expect(editor).toHaveValue('You help Acme Plumbing.\nUse {{order_status}} when needed.');
  await editor.fill('You help Acme Plumbing.');
  await editor.press('End');
  await editor.pressSequentially(' When someone asks about an order, look it up with {{ord');
  await expect(page.getByRole('listbox', { name: 'Values you can use' }).getByRole('option').first()).toContainText('order_status');
  await editor.press('Enter');
  await expect(editor).toHaveValue('You help Acme Plumbing. When someone asks about an order, look it up with {{order_status}}');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Published as version');

  // A visitor asks; the model calls the tool; the Worker calls the API with the stored key.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${WORKER}/tools.html`);
  await expect(visitor.locator('helppuff-widget .hp-panel')).toBeVisible();
  await startConversation(visitor);
  await send(visitor, 'Where is my order A-1042?');
  await expect(thread(visitor)).toContainText('That order is shipped, arriving Friday.');
  const called = (await (await request.get(`${WORKER}/fake-llm/tool`)).json()) as Json;
  expect(called).toEqual({ url: 'https://tools.e2e.test/orders/A-1042', authorization: 'Bearer e2e-tool-key' });
  const last = (await (await request.get(`${WORKER}/fake-llm/last?model=fake-tools-model`)).json()) as Json;
  expect(last['system']).toContain('look it up with `order_status`');

  // The conversation keeps what the tool returned (only the picked keys).
  await page.goto('/admin/#/conversations');
  await page.locator('a[href^="#/conversations/"]', { hasText: 'Where is my order A-1042?' }).first().click();
  const data = page.getByRole('heading', { name: 'Data from tools' }).locator('..');
  await expect(data).toContainText('order_status');
  await expect(data).toContainText('shipped');
  await expect(data).not.toContainText('Botany');
});

test('a before-chat tool looks the visitor up by the form’s email, and an extract tool saves their order number', async ({ browser, request }) => {
  await reset(request, 'You help Acme Plumbing. Customer tier: {{crm_lookup.tier}}. When they give an order number, save it with {{order_number}}.');
  const add = async (tool: Json) => expect((await admin(request, 'POST', '/tools', { site: 'tools', ...tool })).status).toBe(201);
  await add({
    name: 'crm_lookup',
    description: 'The customer in our CRM.',
    method: 'POST',
    url: 'https://tools.e2e.test/crm',
    headers: [{ name: 'Authorization', value: 'Bearer e2e-tool-key', secret: true }],
    body: '{"email": "{{prechat.email}}"}',
    pick: ['tier', 'id'],
    before: true,
  });
  await add({ name: 'order_number', kind: 'extract', description: 'Save the order number.', fields: [{ name: 'order_number', description: 'Like B-77.', required: true }] });

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${WORKER}/tools.html`);
  await expect(visitor.locator('helppuff-widget .hp-panel')).toBeVisible();
  await startConversation(visitor, { name: 'Grace', email: 'gold-grace@example.com' });
  await send(visitor, 'My order is B-77, can you note it?');
  await expect(thread(visitor)).toContainText('Thanks, I have saved your order number.');

  // The CRM was asked with the form's email; the model saw the tier, quoted, and the data.
  const system = String(((await (await request.get(`${WORKER}/fake-llm/last?model=fake-tools-model`)).json()) as Json)['system']);
  expect(system).toContain('Customer tier: "gold"');
  expect(system).toContain('crm_lookup: {"tier":"gold","id":7}');

  // The conversation keeps both, and the number is a custom attribute.
  const found = (await admin(request, 'GET', '/conversations?site=tools&q=B-77')).body;
  const id = ((found['items'] ?? found['conversations']) as Json[])[0]!['id'] as string;
  const detail = (await admin(request, 'GET', `/conversations/${id}?site=tools`)).body['conversation'] as Json;
  expect(detail['data']).toEqual({ crm_lookup: { tier: 'gold', id: 7 }, order_number: { order_number: 'B-77' } });
  expect(detail['attributes']).toEqual({ order_number: 'B-77' });
});
