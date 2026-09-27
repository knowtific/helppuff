import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AGENTS_MARKER, AGENTS_SECTION, SKILL_MD, SKILL_NAME } from '../skill.js';
import { PROMPT_FILE, resourceName, type Backend, type ProjectInput } from './project.js';
import { PROVIDER_KEYS, defaultModel, guessName, type Answers, type Facts, type Goal } from './questions.js';
import { originsFor, normalizeUrl, siteIdFor, type SiteInfo } from './site.js';

/** Answers + what was learned → murmur.json, prompt.md and the secrets to store. */

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
  const backendType = answers.backend ?? 'cloudflare';
  const assumed: Record<string, string> = {};
  const secrets: Record<string, string> = {};

  const model = answers.model ?? defaultModel(backendType);
  if (!answers.model && model) assumed['model'] = model;

  let backend: Backend | Record<string, unknown>;
  switch (backendType) {
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
        mode: answers.httpMode ?? 'murmur',
        ...(answers.httpToken || facts.env['MURMUR_BACKEND_TOKEN'] ? { token: { env: 'MURMUR_BACKEND_TOKEN' } } : {}),
      };
      if (answers.httpToken) secrets['MURMUR_BACKEND_TOKEN'] = answers.httpToken;
      if (!answers.httpMode) assumed['httpMode'] = 'murmur';
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
    $schema: './.murmur/murmur.schema.json',
    site: siteId,
    name,
    ...(website ? { website } : {}),
    origins: [...new Set([...(site?.origins ?? []), ...origins])],
    backend: backend as Backend,
    prompt: PROMPT_FILE,
    knowledge: { website: Boolean(website), files: docs },
    widget: widgetFor(name, site),
    dashboard: answers.dashboard === false ? { enabled: false } : { enabled: true, ...(answers.adminEmail ? { adminEmail: answers.adminEmail } : {}) },
  };

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
    prompt: promptFor(name, website, site, backendType, {
      agentName,
      goal: answers.goal ?? 'leads',
      notes: answers.notes ?? '',
      formFields: ((widget.leadForm['fields'] as { name: string }[] | undefined) ?? []).map((f) => f.name),
    }),
    secrets,
    assumed,
  };
}

const FIELD: Record<string, { label: string; type: 'text' | 'email' | 'tel'; autocomplete: string }> = {
  name: { label: 'Name', type: 'text', autocomplete: 'name' },
  email: { label: 'Email', type: 'email', autocomplete: 'email' },
  phone: { label: 'Phone', type: 'tel', autocomplete: 'tel' },
};

/** `name,email,phone` → an enabled form asking for those; `none` → off. Phone is optional — plenty of people won't give one to a website. */
export function leadFormFor(choice: string | undefined): Record<string, unknown> {
  const fields = (choice ?? 'none') === 'none' ? [] : choice!.split(',').map((f) => f.trim()).filter((f) => FIELD[f]);
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
 * A starting prompt. Short on purpose: the knowledge base carries the facts,
 * and the prompt carries only behaviour. Edited freely afterwards.
 */
const GOAL_LINES: Record<Goal, (contact: string, site: SiteInfo | null) => string> = {
  leads: (contact) =>
    `Your main job: turn interested visitors into enquiries. Once you have helped, invite them to leave their name and the best way to reach them${contact ? `, or to contact us directly (${contact})` : ''}. Ask once, naturally — never before you have been useful.`,
  answer: () => 'Your main job: answer questions about the business clearly and accurately, so visitors find what they need without digging.',
  book: (contact, site) =>
    `Your main job: help visitors book a call or appointment${site?.pages.booking ? ` — the booking page is ${site.pages.booking.url}` : contact ? ` — they can reach us on ${contact}` : ''}. Once you understand what they need, suggest booking.`,
  sell: (_contact, site) =>
    `Your main job: help visitors choose the right product, service or plan for them, explain the difference in plain words, and point them to the next step${site?.pages.pricing ? ` (pricing: ${site.pages.pricing.url})` : ''}.`,
};

export function promptFor(
  name: string,
  website: string | undefined,
  site: SiteInfo | null,
  backend: string,
  custom: { agentName: string; goal: Goal; notes: string; formFields?: string[] } = { agentName: 'Assistant', goal: 'leads', notes: '' },
): string {
  const contact = [site?.phone && `phone ${site.phone}`, site?.email && `email ${site.email}`].filter(Boolean).join(' or ');
  const grounded = ['cloudflare', 'openai', 'gemini', 'anthropic'].includes(backend);
  const who = custom.agentName && custom.agentName !== 'Assistant' ? `${custom.agentName}, ` : '';
  return `You are ${who}the website assistant for ${name}${website ? ` (${website})` : ''}.
${site?.description ? `\nAbout the business: ${site.description}\n` : ''}
${GOAL_LINES[custom.goal](contact, site)}
${custom.formFields?.length ? `\nThe visitor filled in a form before chatting: ${custom.formFields.map((f) => `${f} {{lead.${f}}}`).join(', ')}. The chat has already greeted them by name, so do not greet again — use their first name only where it feels natural, and never ask for these details again: we already have them.\n` : ''}${custom.notes.trim() ? `\nThe owner's instructions — always follow these:\n${custom.notes.trim()}\n` : ''}
How to answer:
- Speak as part of the ${name} team: "we" and "our", never "they" or "contact ${name}".
- Be warm, clear and brief: one to three short paragraphs, or a short list.
${grounded ? "- Answer from the provided knowledge about the business. If it doesn't cover the question, say you're not sure rather than guessing.\n" : ''}- Never invent prices, availability, policies or promises.
- When a page on the site answers the question, link to it.
- If someone wants a person, a quote or a booking, ${contact ? `offer the contact details (${contact}) and ` : ''}ask for their name and the best way to reach them.
- Use plain Markdown only: paragraphs, **bold**, lists and links. No headings or tables.

The visitor is on {{context.pageUrl}}.
`;
}

// ------------------------------------------------------------ agent files

/**
 * Drop the agent guides into the project: AGENTS.md (read by Codex and
 * others) and a Claude Code skill. An existing AGENTS.md gets a section
 * appended once, never rewritten.
 */
export function writeAgentFiles(dir: string): string[] {
  const written: string[] = [];
  const agents = join(dir, 'AGENTS.md');
  if (!existsSync(agents)) {
    writeFileSync(agents, `# Agent notes\n\n${AGENTS_SECTION}`);
    written.push('AGENTS.md');
  } else if (!readFileSync(agents, 'utf8').includes(AGENTS_MARKER)) {
    writeFileSync(agents, `${readFileSync(agents, 'utf8').trimEnd()}\n\n${AGENTS_SECTION}`);
    written.push('AGENTS.md (section added)');
  }
  const skill = join(dir, '.claude', 'skills', SKILL_NAME, 'SKILL.md');
  if (!existsSync(skill)) {
    mkdirSync(dirname(skill), { recursive: true });
    writeFileSync(skill, SKILL_MD);
    written.push(`.claude/skills/${SKILL_NAME}/SKILL.md`);
  }
  return written;
}
