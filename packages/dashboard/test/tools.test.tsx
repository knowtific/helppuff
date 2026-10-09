import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolData } from '../src/components/inbox';
import { Prompt } from '../src/pages/Prompt';
import type { PromptView, ToolsList, ToolView } from '../src/lib/api';
import { button, byText, click, fakeApi, flush, me, mount, select, type, unmount } from './helpers';

/**
 * The Prompt page's tools: the three sections and the library, a tool made
 * from a pasted curl, a tool added to "Before the chat", `{{` completing to a
 * tool in the prompt, and a typo flagged. And a conversation's tool data.
 */

const PROMPT: PromptView = {
  site: 'acme',
  connector: 'assistant',
  editable: true,
  reason: null,
  text: 'You help Acme. Tier: {{crm_lookup.tier}}.',
  hash: 'h',
  version: 2,
  meta: { version: 2, at: Date.now(), by: 'owner@acme.test', source: 'dashboard' },
  limit: 16000,
  versions: [],
  builtIn: null,
  overlaps: [],
};

const tool = (extra: Partial<ToolView>): ToolView => ({
  id: 'tool_1',
  name: 'crm_lookup',
  kind: 'http',
  description: 'The customer in our CRM.',
  method: 'POST',
  url: 'https://crm.acme.test/lookup',
  headers: [{ name: 'X-Api-Key', value: '', secret: true, set: true }],
  body: '{"email":"{{prechat.email}}"}',
  parameters: [],
  pick: [],
  timeoutMs: 5000,
  keys: ['tier', 'id'],
  before: false,
  after: false,
  enabled: true,
  lastStatus: 200,
  lastError: null,
  lastAt: Date.now(),
  ...extra,
});

const list = (tools: ToolView[]): ToolsList => ({ tools, assistant: true, prechat: [{ name: 'email', label: 'Email' }], limits: { tools: 30, timeoutMs: { default: 5000, min: 1000, max: 10000 } } });

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
});

const key = async (element: Element, name: string) =>
  act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });

describe('the Prompt page with tools', () => {
  it('shows before, prompt and after, with the library on the right', async () => {
    fakeApi({ 'GET /prompt': PROMPT, 'GET /tools': list([tool({ before: true })]) });
    const page = await mount(<Prompt me={me('owner')} />);
    const headings = [...page.querySelectorAll('h2, h3')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(expect.arrayContaining([expect.stringContaining('Before the chat'), expect.stringContaining('Prompt'), expect.stringContaining('After the chat'), expect.stringContaining('Tools')]));
    expect(byText(page, /sends email/)).toBeTruthy();
    expect(byText(page, 'In prompt')).toBeTruthy();
  });

  it('makes a tool from a pasted curl, with its key kept secret', async () => {
    const calls = fakeApi({ 'GET /prompt': PROMPT, 'GET /tools': list([]), 'POST /tools': (c: { body: unknown }) => tool({ ...(c.body as object), id: 'tool_2' }) });
    const page = await mount(<Prompt me={me('owner')} />);
    await click(button(page, 'New tool'));
    const dialog = page.querySelector('[role="dialog"]')!;
    await type(dialog.querySelector('#tool-curl'), `curl https://api.acme.test/v1/orders/{{args.order_number}} -H 'Authorization: Bearer sk_9'`);
    await click(button(dialog, /Read the curl/));
    expect((dialog.querySelector('#tool-url') as HTMLInputElement).value).toBe('https://api.acme.test/v1/orders/{{args.order_number}}');
    expect((dialog.querySelector('#tool-name') as HTMLInputElement).value).toBe('orders');
    expect(byText(dialog, 'order_number', 'code')).toBeTruthy();
    await type(dialog.querySelector('#tool-name'), 'order_status');
    await type(dialog.querySelector('#tool-description'), 'Look up an order by its number.');
    await type(dialog.querySelector('[aria-label="What order_number is"]'), 'Like A-1042');
    await click(button(dialog, 'Add tool'));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/tools')!;
    expect(post.body).toMatchObject({
      site: 'acme',
      name: 'order_status',
      kind: 'http',
      method: 'GET',
      url: 'https://api.acme.test/v1/orders/{{args.order_number}}',
      headers: [{ name: 'Authorization', value: 'Bearer sk_9', secret: true }],
      parameters: [{ name: 'order_number', description: 'Like A-1042', required: true }],
    });
    expect(page.querySelector('[role="dialog"]')).toBeNull();
  });

  it('adds a tool to Before the chat from the library', async () => {
    const calls = fakeApi({ 'GET /prompt': PROMPT, 'GET /tools': list([tool({})]), 'PATCH /tools/tool_1': tool({ before: true }) });
    const page = await mount(<Prompt me={me('owner')} />);
    await select(page.querySelector('[aria-label="Add a tool to before the chat"]'), 'tool_1');
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/tools/tool_1', body: { site: 'acme', before: true } });
  });

  it('completes {{ to a tool and what it returns, and flags a name that is not one', async () => {
    fakeApi({ 'GET /prompt': PROMPT, 'GET /tools': list([tool({}), tool({ id: 'tool_2', name: 'order_status', method: 'GET', keys: ['status'] })]) });
    const page = await mount(<Prompt me={me('owner')} />);
    const editor = page.querySelector<HTMLTextAreaElement>('textarea[aria-label="System prompt"]')!;
    await type(editor, `${PROMPT.text} Orders: {{ord`);
    await flush();
    const options = [...page.querySelectorAll('[role="option"]')].map((o) => o.querySelector('span')?.textContent);
    expect(options).toEqual(['order_status', 'order_status.status']);
    await key(editor, 'Enter');
    await flush();
    expect(editor.value).toBe(`${PROMPT.text} Orders: {{order_status}}`);
    expect(byText(page, /^Tools:/)).toBeTruthy();
    expect(button(page, 'order_status')).toBeTruthy();

    await type(editor, `${editor.value} {{order_stauts}}`);
    expect(byText(page, /Not a tool or a known value: \{\{order_stauts\}\}/)).toBeTruthy();
  });
});

describe('the tool dialog', () => {
  it('makes an extract tool that saves what the visitor says', async () => {
    const calls = fakeApi({ 'GET /prompt': PROMPT, 'GET /tools': list([]), 'POST /tools': (c: { body: unknown }) => tool({ ...(c.body as object), id: 'tool_3' }) });
    const page = await mount(<Prompt me={me('owner')} />);
    await click(button(page, 'New tool'));
    const dialog = page.querySelector('[role="dialog"]')!;
    await click(button(dialog, 'Save what the visitor says'));
    expect(dialog.querySelector('#tool-url')).toBeNull();
    await type(dialog.querySelector('#tool-name'), 'order_number');
    await type(dialog.querySelector('#tool-description'), 'Save the order number once they give it.');
    await type(dialog.querySelector('[aria-label="Field 1 name"]'), 'order_number');
    await type(dialog.querySelector('[aria-label="What order_number is"]'), 'Like A-1042');
    await click(button(dialog, 'Add tool'));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/tools')!.body).toEqual({
      site: 'acme',
      name: 'order_number',
      kind: 'extract',
      description: 'Save the order number once they give it.',
      before: false,
      after: false,
      enabled: true,
      fields: [{ name: 'order_number', description: 'Like A-1042', required: true }],
    });
  });

  it('edits a tool without sending its stored key, and deletes one after asking', async () => {
    const calls = fakeApi({ 'GET /prompt': PROMPT, 'GET /tools': list([tool({})]), 'PATCH /tools/tool_1': tool({}), 'DELETE /tools/tool_1': { deleted: true } });
    const page = await mount(<Prompt me={me('owner')} />);
    await click(button(page, /^crm_lookup/));
    let dialog = page.querySelector('[role="dialog"]')!;
    const key = dialog.querySelector<HTMLInputElement>('[aria-label="Header 1 value"]')!;
    expect(key.type).toBe('password');
    expect(key.placeholder).toMatch(/leave empty to keep it/);
    await type(dialog.querySelector('#tool-description'), 'The customer in our CRM, by email.');
    await click(button(dialog, 'Save'));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({
      description: 'The customer in our CRM, by email.',
      headers: [{ name: 'X-Api-Key', value: '', secret: true }],
    });

    await click(button(page, /^crm_lookup/));
    dialog = page.querySelector('[role="dialog"]')!;
    await click(button(dialog, 'Delete'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await click([...dialog.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Delete').at(-1));
    expect(calls.find((c) => c.method === 'DELETE')!.path).toBe('/tools/tool_1?site=acme');
    expect(page.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('a conversation’s tool data', () => {
  it('lists what each tool returned, and marks a failure', async () => {
    const page = await mount(<ToolData value={{ order_status: { status: 'shipped', eta: '2026-10-12' }, crm_lookup: { error: 'timeout' } }} />);
    expect(byText(page, 'shipped')).toBeTruthy();
    expect(byText(page, 'failed')).toBeTruthy();
  });
});
