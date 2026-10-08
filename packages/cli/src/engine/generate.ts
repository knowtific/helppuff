import { DEFAULT_BACKEND, PROJECT_FORMAT, PROMPT_FILE, resourceName, splitBackend, type Backend, type ProjectInput } from './project.js';
import { DEFAULT_LEAD_FORM, PROVIDER_KEYS, defaultModel, guessName, type Answers, type Facts } from './questions.js';
import { originsFor, normalizeUrl, siteIdFor, type SiteInfo } from './site.js';

/** Answers + what was learned → helppuff.json, prompt.md and the secrets to store. */

export type Generated = {
  project: ProjectInput;
  prompt: string;
  /** Secrets to write to .env. */
  secrets: Record<string, string>;
  /** Defaults taken without asking — reported back so nothing is a surprise. */
  assumed: Record<string, string>;
};

export function generateProject(answers: Answers, facts: Facts): Generated {
  const site = facts.site ?? null;
  const website = answers.website && answers.website !== 'none' ? (site?.url ?? normalizeUrl(answers.website)) : undefined;
  const name = (answers.name || site?.name || (website ? guessName(new URL(website).origin) : 'My site')).slice(0, 60);
  const siteId = website ? siteIdFor(website) : slug(name);
  const backendType = answers.backend ?? DEFAULT_BACKEND;
  const assumed: Record<string, string> = {};
  const secrets: Record<string, string> = {};

  const model = answers.model ?? defaultModel(backendType);
  if (!answers.model && model) assumed['model'] = model;

  let backend: Backend | Record<string, unknown>;
  switch (backendType) {
    case 'assistant':
    case 'workers-ai':
      backend = { type: 'workers-ai', ...(answers.model && answers.model !== defaultModel('workers-ai') ? { model: answers.model } : {}) };
      break;
    case 'cloudflare':
    case 'anthropic': {
      const source =
        answers.aiSearch === 'endpoint' && answers.endpoint
          ? { endpoint: answers.endpoint }
          : answers.aiSearch && answers.aiSearch !== 'new'
            ? { instance: answers.aiSearch }
            : {};
      if (backendType === 'cloudflare') {
        backend = { type: 'cloudflare', ...source, ...(model ? { model } : {}) };
      } else {
        backend = { type: 'anthropic', model: model ?? 'claude-opus-5', ...source };
      }
      if (!answers.aiSearch) assumed['aiSearch'] = source && 'instance' in source ? String(source.instance) : `new instance ${resourceName(siteId)}`;
      break;
    }
    case 'openai':
      backend = { type: 'openai', model: model ?? 'gpt-5-mini' };
      break;
    case 'gemini':
      backend = { type: 'gemini', ...(model ? { model } : {}) };
      break;
    case 'http':
      backend = {
        type: 'http',
        url: answers.httpUrl!,
        mode: answers.httpMode ?? 'helppuff',
        ...(answers.httpToken || facts.env['HELPPUFF_BACKEND_TOKEN'] ? { token: { env: 'HELPPUFF_BACKEND_TOKEN' } } : {}),
      };
      if (answers.httpToken) secrets['HELPPUFF_BACKEND_TOKEN'] = answers.httpToken;
      if (!answers.httpMode) assumed['httpMode'] = 'helppuff';
      break;
    case 'retell':
      backend = { type: 'retell', agentId: answers.retellAgent! };
      break;
    case 'echo':
      backend = { type: 'echo' };
      break;
  }

  const keyName = PROVIDER_KEYS[backendType];
  if (keyName && answers.apiKey) secrets[keyName] = answers.apiKey;
  if (answers.cfToken) secrets['CLOUDFLARE_API_TOKEN'] = answers.cfToken;
  if (answers.cfAccount) secrets['CLOUDFLARE_ACCOUNT_ID'] = answers.cfAccount;

  const docs = answers.docs ?? (facts.knowledgeDir ? [facts.knowledgeDir] : []);
  const origins = website ? originsFor(website) : ['http://localhost:3000'];
  if (!website) assumed['origins'] = 'http://localhost:3000 (add your real site to `origins` before going live)';

  const project: ProjectInput = {
    $schema: './.helppuff/helppuff.schema.json',
    format: PROJECT_FORMAT,
    site: siteId,
    name,
    ...(website ? { website } : {}),
    origins: [...new Set([...(site?.origins ?? []), ...origins])],
    backend: backend as Backend,
    prompt: PROMPT_FILE,
    knowledge: { website: Boolean(website), files: docs },
    widget: widgetFor(name, site),
    // How it behaves is a setting, written around prompt.md on every answer (never into it).
    assistant: {
      goal: answers.goal === 'answer' || answers.goal === 'sell' ? 'answers' : answers.goal === 'book' ? 'bookings' : 'callbacks',
      ...(answers.goal === 'book' && site?.pages.booking ? { bookingUrl: site.pages.booking.url } : {}),
    },
    dashboard: answers.dashboard === false ? { enabled: false } : { enabled: true, ...(answers.adminEmail ? { adminEmail: answers.adminEmail } : {}) },
  };
  // The model and the knowledge, chosen separately (Workers AI with no options needs no `model` at all).
  splitBackend(project as Record<string, unknown>);
  const written = project as Record<string, unknown>;
  if (JSON.stringify(written['model']) === JSON.stringify({ provider: 'workers-ai' })) delete written['model'];

  const agentName = (answers.agentName || 'Assistant').slice(0, 60);
  const widget = project.widget as { brand: { agentName: string }; chat: Record<string, unknown>; leadForm: Record<string, unknown> };
  widget.brand.agentName = agentName;
  widget.leadForm = leadFormFor(answers.leadForm);
  // The first thing a visitor sees in the thread; `{{name}}` is filled from the form, or dropped.
  widget.chat = {
    ...widget.chat,
    initialMessages: [
      agentName === 'Assistant'
        ? `Hi {{name}}! How can we help you today?`
        : `Hi {{name}}! I'm ${agentName} from ${name}. How can I help you today?`,
    ],
  };
  return {
    project,
    prompt: promptFor(name, site, backendType, answers.notes ?? ''),
    secrets,
    assumed,
  };
}

const FIELD: Record<string, { label: string; type: 'text' | 'email' | 'tel' | 'textarea'; autocomplete?: string }> = {
  name: { label: 'Name', type: 'text', autocomplete: 'name' },
  email: { label: 'Email', type: 'email', autocomplete: 'email' },
  phone: { label: 'Phone (optional)', type: 'tel', autocomplete: 'tel' },
  message: { label: 'How can we help?', type: 'textarea' },
};

/**
 * `name,email,phone,message` (the default) → a form asking for those; `none`
 * → off. Phone is optional — plenty of people won't give one to a website.
 * The message becomes the first chat message.
 */
export function leadFormFor(choice: string | undefined): Record<string, unknown> {
  const fields = (choice ?? DEFAULT_LEAD_FORM) === 'none' ? [] : (choice ?? DEFAULT_LEAD_FORM).split(',').map((f) => f.trim()).filter((f) => FIELD[f]);
  if (!fields.length) return { enabled: false };
  return {
    enabled: true,
    title: 'Before we start',
    fields: fields.map((name) => ({ name, ...FIELD[name], required: name !== 'phone' })),
    submitLabel: 'Start chat',
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';
}

function widgetFor(name: string, site: SiteInfo | null): Record<string, unknown> {
  const links = (['pricing', 'booking', 'contact', 'faq'] as const)
    .map((kind) => site?.pages[kind])
    .filter((page): page is { url: string; label: string } => Boolean(page))
    .slice(0, 4)
    .map((page) => ({ label: page.label, url: page.url }));

  return {
    brand: {
      name,
      agentName: 'Assistant',
      ...(site?.accent ? { accent: site.accent } : {}),
      ...(site?.logo ? { avatar: site.logo } : {}),
    },
    launcher: { label: 'Ask us' },
    home: {
      title: 'Hi there',
      subtitle: `Ask anything about ${name}.`,
      ...(links.length ? { links: { title: 'Popular pages', items: links } } : {}),
    },
    chat: {
      placeholder: 'Type your question…',
      ...(site?.phone || site?.email
        ? { fallbackContact: { ...(site.phone ? { phone: site.phone } : {}), ...(site.email ? { email: site.email } : {}) } }
        : {}),
    },
  };
}

/**
 * A starting prompt.md: only what is specific to the business. Who the
 * assistant is, its goal, tone and length are settings (`assistant` in
 * helppuff.json), and HelpPuff adds its rules itself (`server/src/core/guidance.ts`),
 * so none of that is written here to go stale or be contradicted. Backends
 * that are not given the business details get the contact details here.
 */
export function promptFor(name: string, site: SiteInfo | null, backend: string, notes = ''): string {
  const contact = backend === 'workers-ai' ? '' : [site?.phone && `phone ${site.phone}`, site?.email && `email ${site.email}`].filter(Boolean).join(', ');
  const parts = [
    site?.description ? `About ${name}: ${site.description}` : `About ${name}: (what you do, for whom, and where).`,
    contact ? `Contact: ${contact}.` : '',
    notes.trim(),
  ].filter(Boolean);
  return `${parts.join('\n\n')}\n`;
}
