import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { agentMessages, composer, openWidget, panel, send, startConversation, thread } from './helpers';

/**
 * Live chat end to end: a visitor's widget (on the fixture page) and the
 * team's dashboard (served by the live-chat Worker on :8796, e2e/live), two
 * real browsers, one real Worker with D1 and the live hub.
 */

const WORKER = 'http://localhost:8796';
const ADMIN_KEY = 'e2e-only-admin-key-not-for-any-deployment-012345';
const OWNER = { email: 'owner@e2e.test', password: 'owner-password-123' };
const MEMBER = { email: 'mo@e2e.test', password: 'member-password-123' };

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'one browser is enough for two-party flows');

const admin = (request: APIRequestContext, method: 'PUT' | 'POST', path: string, data: unknown) =>
  request.fetch(`${WORKER}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}` }, data });

test.beforeAll(async ({ request }) => {
  // The first account is the owner (no ADMIN_EMAIL here); a second, a member. Re-runs find them made.
  for (const [who, role] of [
    [OWNER, 'admin'],
    [MEMBER, 'member'],
  ] as const) {
    const made = await admin(request, 'POST', '/admins', { ...who, name: who === OWNER ? 'Olivia' : 'Mo', role });
    expect([201, 409]).toContain(made.status());
  }
  const saved = await admin(request, 'PUT', '/settings', { settings: { live: { enabled: true, waitSeconds: 15, showAgentName: true } } });
  expect(saved.status()).toBe(200);
});

async function signIn(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const context = await browser.newContext({ baseURL: WORKER });
  await context.grantPermissions(['notifications'], { origin: WORKER });
  const page = await context.newPage();
  await page.goto('/admin/');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  return page;
}

async function visitor(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:5173/fixtures/live.html?api=${WORKER}`);
  await openWidget(page);
  await startConversation(page);
  return page;
}

const personButton = (page: Page) => page.locator('helppuff-widget button[aria-label="Talk to a person"]');

test('nobody available: the visitor gets the callback form', async ({ browser }) => {
  const page = await visitor(browser);
  await personButton(page).click();
  await expect(thread(page)).toContainText('Nobody from the team is free right now');
  await expect(page.locator('helppuff-widget button', { hasText: 'Request callback' })).toBeVisible();
  await page.context().close();
});

test('a visitor is handed to the team, answered, and handed back to the assistant', async ({ browser }) => {
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  // Connected and available (the switch at the bottom of the menu).
  await expect(team.getByRole('switch', { name: 'Available for live chats' })).toHaveAttribute('aria-checked', 'true');
  await expect(team.getByText('You get new live chats')).toBeVisible();

  const page = await visitor(browser);
  await personButton(page).click();
  await expect(thread(page)).toContainText('Connecting you with someone from the team');
  await expect(personButton(page)).toHaveCount(0);

  // The team sees it waiting, on the menu and in the list, without reloading.
  await expect(team.getByLabel(/live chats waiting/)).toBeVisible();
  const waiting = team.locator('a', { hasText: /Waiting/ }).first();
  await expect(waiting).toBeVisible();
  await waiting.click();
  await team.getByRole('button', { name: 'Take chat' }).click();
  await expect(thread(page)).toContainText('Olivia joined the chat');
  await expect(page.locator('helppuff-widget .hp-header-status')).toContainText('Olivia');

  const reply = team.getByLabel('Reply to the visitor');
  await reply.fill('Hi, Olivia here. How can I help?');
  await reply.press('Enter');
  await expect(thread(page)).toContainText('Hi, Olivia here. How can I help?');
  await expect(page.locator('helppuff-widget .hp-agent-name').last()).toHaveText('Olivia');

  // The visitor answers: no reply from the assistant; the team sees it live.
  const before = await agentMessages(page).count();
  await send(page, 'My tap is leaking');
  await expect(team.getByText('My tap is leaking')).toBeVisible();
  expect(await agentMessages(page).count()).toBe(before);

  // Back to the assistant: it answers the next message.
  await team.getByRole('button', { name: 'Back to assistant' }).click();
  await expect(thread(page)).toContainText('back with the assistant');
  await send(page, 'thanks');
  await expect(thread(page)).toContainText('You said');
  await expect(personButton(page)).toBeVisible();

  await page.context().close();
  await team.context().close();
});

test('the team takes over a chat the assistant has, hands it back by mistake, and takes it again', async ({ browser }) => {
  const page = await visitor(browser);
  await send(page, 'Do you do weekends?');
  await expect(agentMessages(page).last()).toContainText('You said');

  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  await team.getByRole('radio', { name: 'AI bot' }).click();
  await team.locator('a[href^="#/conversations/"]', { hasText: 'Do you do weekends?' }).first().click();
  await team.getByRole('button', { name: 'Take over' }).click();
  // The visitor never asked: the person joins anyway, at once.
  await expect(thread(page)).toContainText('Olivia joined the chat');
  const reply = team.getByLabel('Reply to the visitor');
  await reply.fill('Yes, Saturdays 8 to 12. Want a booking?');
  await reply.press('Enter');
  await expect(thread(page)).toContainText('Yes, Saturdays 8 to 12.');

  // A mistake: back to the assistant… and taken again.
  await team.getByRole('button', { name: 'Back to assistant' }).click();
  await expect(thread(page)).toContainText('back with the assistant');
  await team.getByRole('button', { name: 'Take over' }).click();
  await expect(thread(page).getByText('Olivia joined the chat')).toHaveCount(2);
  await send(page, 'Yes please');
  await expect(team.getByText('Yes please')).toBeVisible();
  await page.context().close();
  await team.context().close();
});

test('a closed chat is reopened from the dashboard, with a person or with the assistant', async ({ browser }) => {
  const page = await visitor(browser);
  await send(page, 'Is it too late to book today?');
  await expect(agentMessages(page).last()).toContainText('You said');
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  await team.locator('a[href^="#/conversations/"]', { hasText: 'Is it too late to book today?' }).first().click();
  await team.getByRole('button', { name: 'Close' }).click();
  await expect(team.getByRole('button', { name: 'Reopen with me' })).toBeVisible();

  // Reopened for the assistant, then closed again and reopened with a person by writing.
  await team.getByRole('button', { name: 'Reopen for assistant' }).click();
  await expect(team.getByRole('button', { name: 'Take over' })).toBeVisible();
  await team.getByRole('button', { name: 'Close' }).click();
  await expect(team.getByText('This chat is closed. Sending reopens it with you.')).toBeVisible();
  const reply = team.getByLabel('Reply to the visitor');
  await reply.fill('We can still fit you in at 5pm.');
  await reply.press('Enter');
  await expect(thread(page)).toContainText('Olivia joined the chat');
  await expect(thread(page)).toContainText('We can still fit you in at 5pm.');
  await expect(team.getByRole('button', { name: 'Back to assistant' })).toBeVisible();
  await page.context().close();
  await team.context().close();
});

test('nobody takes it in time: the visitor is offered the callback form and can leave details', async ({ browser }) => {
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  await expect(team.getByText('You get new live chats')).toBeVisible();
  const page = await visitor(browser);
  await personButton(page).click();
  await expect(thread(page)).toContainText('Connecting you');
  // waitSeconds is 15 here.
  await expect(thread(page)).toContainText('nobody is free just now', { timeout: 30_000 });
  const form = page.locator('helppuff-widget form', { has: page.locator('button', { hasText: 'Request callback' }) }).last();
  await form.locator('input').first().fill('Ada');
  await form.locator('input[type="tel"]').fill('0400 111 222');
  await form.getByRole('button', { name: 'Request callback' }).click();
  await expect(thread(page)).toContainText('the team will get back to you');
  await team.goto('/admin/#/callbacks');
  await expect(team.getByText('0400 111 222').first()).toBeVisible();
  await page.context().close();
  await team.context().close();
});

test('a member sees the inbox, not the settings', async ({ browser }) => {
  const page = await signIn(browser, MEMBER);
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav.getByRole('link', { name: 'Conversations' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Contacts' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Knowledge' })).toHaveCount(0);
  // An admin page sends them to the inbox.
  await page.goto('/admin/#/analytics');
  await expect(page).toHaveURL(/#\/conversations/);
  await page.goto('/admin/#/settings');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  // And the API refuses them the settings themselves.
  const settings = await page.request.get(`${WORKER}/admin/api/settings`);
  expect(settings.status()).toBe(403);
  await page.context().close();
});

test("the team labels a conversation, notes it, and keeps a contact's details", async ({ browser }) => {
  const created = await admin((await browser.newContext()).request, 'POST', '/labels', { name: 'Urgent', color: '#ef4444' });
  expect([201, 409]).toContain(created.status());
  const page = await visitor(browser);
  await send(page, 'Hello there');
  await expect(agentMessages(page).last()).toContainText('You said');
  await page.context().close();

  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  await team.locator('a[href^="#/conversations/"]').first().click();
  await team.getByRole('button', { name: 'Add label' }).click();
  await team.getByRole('menuitemcheckbox', { name: 'Urgent' }).click();
  await team.getByRole('button', { name: 'Add attribute' }).click();
  await team.getByLabel('Attribute key').fill('order_id');
  await team.getByLabel('Attribute value').fill('A-1042');
  await team.getByRole('button', { name: 'Add', exact: true }).click();
  await team.getByLabel('New note').fill('Called back, booked Tuesday');
  await team.getByRole('button', { name: 'Add note' }).click();
  await team.reload();
  await expect(team.getByText('A-1042')).toBeVisible();
  await expect(team.getByText('Called back, booked Tuesday')).toBeVisible();

  // The label filter finds it, and is remembered across a reload.
  await team.getByLabel('Label', { exact: true }).selectOption('Urgent');
  await expect(team.locator('a[href^="#/conversations/"]').first()).toContainText('Urgent');
  await team.reload();
  await expect(team.getByLabel('Label', { exact: true })).toHaveValue('Urgent');

  // The contact's page: details and attributes saved.
  await team.goto('/admin/#/leads');
  await team.locator('tbody a[href^="#/contact/"]').first().click();
  await team.getByRole('button', { name: 'Edit details' }).click();
  await team.getByLabel('Company').fill('Analytical Engines');
  await team.getByRole('button', { name: 'Save' }).click();
  await team.reload();
  await expect(team.getByText('Analytical Engines').first()).toBeVisible();
  await team.context().close();
});

test('every chat has the reply box, saying what sending will do', async ({ browser }) => {
  const page = await visitor(browser);
  await send(page, 'Just browsing');
  await expect(agentMessages(page).last()).toContainText('You said');
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  await team.getByRole('radio', { name: 'AI bot' }).click();
  await team.locator('a[href^="#/conversations/"]', { hasText: 'Just browsing' }).first().click();
  await expect(team.getByText('The assistant is answering. Sending takes the chat over.')).toBeVisible();
  await expect(team.getByLabel('Reply to the visitor')).toBeVisible();
  await page.context().close();
  await team.context().close();
});

test('with live chat off (the default), nothing of it shows: no button, no switch, callbacks only', async ({ browser }) => {
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/settings/live');
  await team.getByRole('radio', { name: /Take their details for a callback/ }).check();
  await team.getByRole('button', { name: 'Save' }).click();
  await expect(team.getByText('Saved.')).toBeVisible();
  // The dashboard follows at once: no Available switch. Notifications stays: it holds the emails each person gets.
  await expect(team.getByRole('switch', { name: 'Available for live chats' })).toHaveCount(0);
  await expect(team.locator('#settings-menu').getByRole('link', { name: 'Notifications' })).toHaveCount(1);

  const page = await visitor(browser);
  await expect(composer(page)).toBeVisible();
  await expect(personButton(page)).toHaveCount(0);

  // Back on, for anything after this.
  await team.getByRole('radio', { name: /Connect them to someone on the team/ }).check();
  await team.getByRole('button', { name: 'Save' }).click();
  await expect(team.getByRole('switch', { name: 'Available for live chats' })).toBeVisible();
  await page.context().close();
  await team.context().close();
});

test('photos during live chat: the paperclip shows once a person has the chat; the photo is made smaller and the team sees it', async ({ browser, request }) => {
  expect((await admin(request, 'PUT', '/settings', { settings: { live: { enabled: true }, files: { chat: 'live' } } })).status()).toBe(200);
  const attach = (page: Page) => page.locator('helppuff-widget .hp-attach');
  const team = await signIn(browser, OWNER);
  await team.goto('/admin/#/conversations');
  // A visitor with a name of their own, so the team opens this chat and not one an earlier test left waiting.
  const name = `Pat ${Date.now()}`;
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:5173/fixtures/live.html?api=${WORKER}`);
  await openWidget(page);
  await startConversation(page, { name });
  // The assistant has the chat: no paperclip.
  await expect(composer(page)).toBeVisible();
  await expect(attach(page)).toHaveCount(0);

  await personButton(page).click();
  await expect(thread(page)).toContainText('Connecting you with someone from the team');
  await team.getByPlaceholder(/Search messages/).fill(name);
  await expect(team.locator('a[href^="#/conversations/"]', { hasText: /Waiting/ })).toHaveCount(1);
  await team.locator('a[href^="#/conversations/"]').click();
  await team.getByRole('button', { name: 'Take chat' }).click();
  await expect(thread(page)).toContainText('Olivia joined the chat');
  await expect(attach(page)).toBeVisible();

  // A 2400×1800 phone photo, made in the page.
  const photo = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 2400, height: 1800 });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#7aa';
    ctx.fillRect(0, 0, 2400, 1800);
    ctx.fillStyle = '#123';
    ctx.fillRect(600, 400, 900, 700);
    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1]!;
  });
  await attach(page).locator('input[type="file"]').setInputFiles({ name: 'leak.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo, 'base64') });

  // The visitor sees it at once, sent at 1600 pixels across.
  const sent = page.locator('helppuff-widget img[alt="leak.jpg"]');
  await expect(sent).toBeVisible();
  await expect.poll(() => sent.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600);
  // No reply from the assistant; the team sees the photo in the conversation, live.
  await expect(team.locator('img[alt="leak.jpg"]')).toBeVisible();

  // Back to the assistant: the paperclip goes.
  await team.getByRole('button', { name: 'Back to assistant' }).click();
  await expect(thread(page)).toContainText('back with the assistant');
  await expect(attach(page)).toHaveCount(0);

  expect((await admin(request, 'PUT', '/settings', { settings: { files: { chat: 'off' } } })).status()).toBe(200);
  await page.context().close();
  await team.context().close();
});

/**
 * Customer emails (the `emails` site): a visitor leaves, the team replies,
 * the reply is emailed with the conversation's signed Reply-To and a
 * Continue the chat link; the customer answers by email (handed to the
 * Worker's email() by wrangler's local endpoint, as Email Routing hands it in
 * production) and it lands in the conversation as a live chat waiting for the
 * team; the link opens the chat again in the widget. Last in this file: the
 * answer makes a waiting live chat, which the tests above would pick.
 */
const RUN = Date.now().toString(36);
const EMAIL = `sarah.${RUN}@example.com`;
type Sent = { host: string; body: Record<string, unknown> };
type Detail = { conversation: { status: string; waiting_since: number | null }; messages: { role: string; text: string | null; payload: { via?: string } | null }[] };
const api = (request: APIRequestContext, method: string, path: string, data?: unknown) =>
  request.fetch(`${WORKER}/admin/api${path}`, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}` }, ...(data === undefined ? {} : { data }) });
const mail = async (request: APIRequestContext): Promise<Sent[]> => ((await (await request.get(`${WORKER}/fake-llm/outbox`)).json()) as Sent[]).filter((s) => s.host === 'mail.e2e.test');

test('a reply reaches a customer who left, they answer by email, and the link opens the chat again', async ({ browser, request }) => {
  // The site's email service: a request that sends where replies go.
  const service = await api(request, 'PUT', '/notifications/email', {
    site: 'emails',
    url: 'https://mail.e2e.test/send',
    headers: [
      { name: 'Content-Type', value: 'application/json', secret: false },
      { name: 'X-Api-Key', value: 'e2e-mail-key', secret: true },
    ],
    body: '{"to": "{{email.to}}", "subject": "{{email.subject}}", "text": "{{email.text}}", "reply_to": "{{email.replyTo}}", "headers": "{{email.headers}}"}',
  });
  expect(service.status()).toBe(200);

  // A visitor asks, and leaves.
  const started = await request.post(`${WORKER}/v1/sites/emails/sessions`, {
    headers: { Origin: WORKER },
    data: { lead: { name: 'Sarah', email: EMAIL }, context: { pageUrl: `${WORKER}/emails.html` }, firstMessage: 'My hot water tank is leaking, can someone come tomorrow?' },
  });
  expect(started.status()).toBe(200);
  const { sessionId: id } = (await started.json()) as { sessionId: string };

  // Mike replies from the dashboard: she is not on the site, so it is emailed (no wait on this site).
  // The outbox is shared with notifications.spec.ts (which empties it): each email is found by its own address and text.
  expect((await api(request, 'POST', `/conversations/${id}/reply`, { text: 'Yes, I can be there at 10am. Does that work?' })).status()).toBe(201);
  let found: Record<string, unknown> | undefined;
  const replied = async (text: string) => (await mail(request)).find((s) => s.body['to'] === EMAIL && String(s.body['text']).includes(text))?.body;
  await expect.poll(async () => Boolean((found = await replied('Does that work?'))), { timeout: 20_000 }).toBe(true);
  const email = found!;
  expect(String(email['subject'])).toMatch(/replied \[#[a-z2-7]{7}\]$/);
  expect(String(email['text'])).toContain('You asked: My hot water tank is leaking');
  const replyTo = String(email['reply_to']);
  expect(replyTo).toMatch(new RegExp(`^reply\\+${id}\\.[a-z2-7]{10}@chat\\.e2e\\.test$`));
  expect((email['headers'] as Record<string, string>)['List-Unsubscribe']).toContain('/v1/email/unsubscribe?t=');

  // She answers from her mail app.
  const raw = [
    `From: Sarah <${EMAIL}>`,
    `To: ${replyTo}`,
    `Subject: Re: ${String(email['subject'])}`,
    `Message-ID: <answer.${RUN}@example.com>`,
    `Date: ${new Date().toUTCString()}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    '10am is perfect, thank you!',
    '',
    `On ${new Date().toDateString()}, Acme Plumbing <${replyTo}> wrote:`,
    '> Yes, I can be there at 10am. Does that work?',
    '',
  ].join('\r\n');
  const delivered = await request.post(`${WORKER}/cdn-cgi/local/email?from=${encodeURIComponent(EMAIL)}&to=${encodeURIComponent(replyTo)}`, { headers: { 'Content-Type': 'message/rfc822' }, data: raw });
  expect(delivered.status(), await delivered.text()).toBe(200);
  await expect
    .poll(async () => {
      const detail = (await (await api(request, 'GET', `/conversations/${id}`)).json()) as Detail;
      return detail.messages.filter((m) => m.payload?.via === 'email').map((m) => m.text);
    })
    .toEqual(['10am is perfect, thank you!']);
  const detail = (await (await api(request, 'GET', `/conversations/${id}`)).json()) as Detail;
  expect(detail.conversation.status).toBe('live');
  expect(detail.conversation.waiting_since).toBeGreaterThan(0);

  // A guessed address (a forged signature, and no email of ours to answer) is refused.
  const forged = replyTo.replace(/\.[a-z2-7]{10}@/, '.aaaaaaaaaa@');
  const refused = await request.post(`${WORKER}/cdn-cgi/local/email?from=mallory%40example.com&to=${encodeURIComponent(forged)}`, {
    headers: { 'Content-Type': 'message/rfc822' },
    data: raw
      .replace(`To: ${replyTo}`, `To: ${forged}`)
      .replace(/^Subject: .*$/m, 'Subject: Let me in')
      .replace(`<answer.${RUN}@`, `<forged.${RUN}@`)
      .replace(`From: Sarah <${EMAIL}>`, 'From: mallory@example.com'),
  });
  expect(await refused.text()).toContain('Unknown conversation');

  // The team answers in the dashboard; she gets that by email too, and the chat is closed (no waiting chat is left for the tests before).
  expect((await api(request, 'POST', `/conversations/${id}/reply`, { text: 'Great, see you at 10.' })).status()).toBe(201);
  await expect.poll(async () => Boolean(await replied('Great, see you at 10.'))).toBe(true);
  expect((await api(request, 'POST', `/conversations/${id}/close`, {})).status()).toBe(200);

  // Continue the chat: the link opens the widget on the conversation, the address cleaned up.
  const link = /(http:\/\/localhost:8796\/emails\.html#hp-resume=[\w.-]+)/.exec(String(email['text']))![1]!;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(panel(page)).toBeVisible();
  await expect(thread(page)).toContainText('My hot water tank is leaking');
  await expect(thread(page)).toContainText('Yes, I can be there at 10am.');
  expect(new URL(page.url()).hash).toBe('');
  await context.close();
});
