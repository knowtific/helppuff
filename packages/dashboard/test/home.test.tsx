import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScreenSettings } from '../src/components/HomeScreenSettings';
import { SettingsForm } from '../src/components/SettingsForm';
import type { HomeSettings, Settings, SettingsView } from '../src/lib/api';
import { button, click, fakeApi, flush, mount, select, type, unmount } from './helpers';

/**
 * Settings → Home screen: it starts from what the widget shows (the
 * website's suggestions), saves the whole home screen, suggests more without
 * repeating itself, and the Chat page never saves over it.
 */

const HOME: HomeSettings = {
  title: 'Hi there',
  subtitle: 'Ask anything.',
  shortcuts: [{ id: 'call', label: 'Call us', icon: 'phone', action: { id: 'call', kind: 'tel', label: 'Call us', phone: '02 9000 0000' } }],
  links: null,
};
const SETTINGS = {
  botName: 'Sam',
  businessName: 'Acme',
  welcomeMessage: 'Hi!',
  starterQuestions: [],
  accent: '#5B5BF7',
  position: 'bottom-right',
  launcherIcon: 'chat',
  leads: { enabled: false, fields: [{ name: 'name', label: 'Name', type: 'text', required: true }] },
  assistant: null,
  behaviour: { goal: 'callbacks', tone: 'friendly', length: 'short', prices: 'share' },
  crawl: { schedule: 'weekly', include: [], exclude: [], renderJs: 'auto' },
  home: HOME,
} as unknown as Settings;
const LINKS = { title: 'Useful pages', items: [{ label: 'Prices', url: 'https://acme.example/prices' }] };
const view = (extra: Partial<SettingsView> = {}): SettingsView => ({ site: 'acme', connector: 'workers-ai', settings: SETTINGS, hash: 'h', meta: null, forms: [{ id: 'booking', title: 'Book a visit' }], flows: [], ...extra });

class NoSocket {
  readyState = 0;
  send() {}
  close() {}
}
beforeEach(() => vi.stubGlobal('WebSocket', NoSocket));
afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
});

const sent = (calls: { method: string; body: unknown }[]) => (calls.filter((c) => c.method === 'PUT').at(-1)!.body as { settings: { home: HomeSettings } }).settings;

describe('Settings → Home screen', () => {
  it('starts from the suggestions the widget shows, and Save makes them the owner’s', async () => {
    const calls = fakeApi({
      'GET /settings': view({ suggestedHome: { questions: ['Do you do gas?'], links: LINKS, at: 1 } }),
      'GET /jobs/pipeline': { pipeline: { quote: { enabled: true, label: 'Get a quote', askContact: true } } },
      'PUT /settings': (call: { body: unknown }) => view({ settings: { ...SETTINGS, home: (call.body as { settings: { home: HomeSettings } }).settings.home } }),
    });
    const page = await mount(<HomeScreenSettings knowledge />);
    expect(page.textContent).toContain('The widget shows these now');
    // The quote button is Jobs': shown, locked, never sent.
    expect(page.textContent).toContain('Set in Settings → Jobs');
    expect(page.querySelector('[role="figure"]')!.textContent).toContain('Get a quote');
    await click(button(page, 'Save'));
    const saved = sent(calls).home;
    expect(saved.shortcuts.map((s) => s.label)).toEqual(['Do you do gas?', 'Call us']);
    expect(saved.links).toEqual(LINKS);
    expect(page.textContent).toContain('Saved.');
  });

  it('turns a button into a link to a page, adds a link, and removes the list', async () => {
    const calls = fakeApi({ 'GET /settings': view(), 'GET /jobs/pipeline': null, 'PUT /settings': view() });
    const page = await mount(<HomeScreenSettings knowledge={false} />);
    await select(page.querySelector('select[aria-label="What Call us does"]'), 'url');
    await type(page.querySelector('input[aria-label="Page Call us opens"]'), 'https://acme.example/book');
    await type(page.querySelector('input[aria-label="Button label"]'), 'Book online');
    await click(page.querySelector('[aria-label="Useful pages"] input[type="checkbox"]'));
    await click(button(page, 'Add a link'));
    await type(page.querySelector('input[aria-label="Link text"]'), 'Prices');
    await type(page.querySelector('input[aria-label="Address of Prices"]'), 'https://acme.example/prices');
    await click(button(page, 'Save'));
    const home = sent(calls).home;
    expect(home.shortcuts[0]).toMatchObject({ label: 'Book online', action: { kind: 'url', url: 'https://acme.example/book', newTab: true } });
    expect(home.links).toEqual({ title: 'Useful pages', items: [{ label: 'Prices', url: 'https://acme.example/prices' }] });

    await click(page.querySelector('[aria-label="Useful pages"] input[type="checkbox"]'));
    await click(button(page, 'Save'));
    expect(sent(calls).home.links).toBeNull();
  });

  it('suggests from the site without repeating what is there, contact buttons first, within the 8', async () => {
    fakeApi({
      'GET /settings': view({ settings: { ...SETTINGS, home: { ...HOME, shortcuts: [HOME.shortcuts[0]!, ...['A?', 'B?', 'C?', 'D?', 'E?'].map((q, i) => ({ id: `q${i}`, label: q, action: { id: `q${i}`, kind: 'reply' as const, label: q, value: q } }))] } } }),
      'GET /jobs/pipeline': { pipeline: { quote: { enabled: true, label: 'Get a quote', askContact: true } } },
      'POST /home/suggest': {
        questions: ['A?', 'New question?', 'Another?'],
        links: LINKS,
        contact: [
          { id: 'call', label: 'Call us', icon: 'phone', action: { id: 'call', kind: 'tel', label: 'Call us', phone: '1' } },
          { id: 'email', label: 'Email us', icon: 'mail', action: { id: 'email', kind: 'email', label: 'Email us', email: 'hi@acme.example' } },
        ],
        source: 'model',
      },
    });
    const page = await mount(<HomeScreenSettings knowledge />);
    await click(button(page, 'Suggest from my site'));
    await flush();
    const labels = [...page.querySelectorAll<HTMLInputElement>('input[aria-label="Button label"]')].map((i) => i.value);
    // 6 there + the quote button: room for one more, and a way to reach them wins over a question.
    expect(labels).toEqual(['Call us', 'A?', 'B?', 'C?', 'D?', 'E?', 'Email us']);
    expect([...page.querySelectorAll<HTMLInputElement>('input[aria-label="Link text"]')].map((i) => i.value)).toEqual(['Prices']);
    expect(page.textContent).toContain('Added suggestions from your website');
  });
});

describe('Settings → Chat', () => {
  it('never saves the home screen or its questions (they belong to Home screen)', async () => {
    const calls = fakeApi({ 'GET /settings': view(), 'PUT /settings': view() });
    const page = await mount(<SettingsForm section="chat" knowledge />);
    await type(page.querySelector('textarea'), 'Welcome!');
    await click(button(page, /Save/));
    const settings = sent(calls) as unknown as Record<string, unknown>;
    expect(settings['welcomeMessage']).toBe('Welcome!');
    expect(settings).not.toHaveProperty('home');
    expect(settings).not.toHaveProperty('starterQuestions');
  });
});

describe('Settings → Advanced', () => {
  it('shows the model and knowledge read-only, with how to change them, and saves the rest', async () => {
    const assistant = { model: 'deepseek-ai/DeepSeek-V3.1', locale: null, timezone: null, rerank: true, reasoning: 'medium' };
    const calls = fakeApi({
      'GET /settings': view({ settings: { ...SETTINGS, assistant } as unknown as Settings, ai: { provider: 'openai-compatible', model: 'deepseek-ai/DeepSeek-V3.1', knowledge: 'http' } }),
      'PUT /settings': view(),
    });
    const page = await mount(<SettingsForm section="advanced" knowledge />);
    const panel = page.querySelector('[aria-label="Model and knowledge"]')!;
    expect(panel.textContent).toContain('An OpenAI-compatible API · deepseek-ai/DeepSeek-V3.1');
    expect(panel.textContent).toContain('Your own search (HTTP)');
    expect(panel.textContent).toContain('helppuff model set');
    expect([...page.querySelectorAll('select')].some((s) => s.querySelector('option[value="@cf/zai-org/glm-4.7-flash"]'))).toBe(false);
    await type(page.querySelector('input[placeholder="Australia/Melbourne"]'), 'Australia/Perth');
    await click(button(page, /Save/));
    expect((sent(calls) as unknown as { assistant: Record<string, unknown> }).assistant).toMatchObject({ timezone: 'Australia/Perth', model: 'deepseek-ai/DeepSeek-V3.1', rerank: true });
  });
});

