import type { Account, AiSearchInstance } from './cloudflare.js';
import { DEFAULT_BACKEND, type BackendType } from './project.js';
import { siteIdFor, type SiteInfo } from './site.js';
import { RESOURCE_PREFIX } from './project.js';
import { TOKEN_HELP } from './cloudflare.js';

/**
 * Every question setup can ask, defined once.
 *
 * The terminal wizard renders them as prompts; an agent (or any
 * non-interactive caller) gets them back as JSON with the flag that answers
 * each, and asks its user in its own words. Because both read this list, a
 * question added here appears in both, and they cannot drift apart.
 *
 * Only what cannot be worked out is *required*. Everything else has a
 * default, is listed back as an assumption, and can be changed later in
 * murmur.json.
 */

export type Answers = {
  website?: string;
  name?: string;
  /** Take the free default stack (workers-ai) without asking about backends. */
  defaults?: boolean;
  backend?: BackendType;
  model?: string;
  /** Provider API key (OpenAI / Gemini / Anthropic / Retell) — goes to .env, never murmur.json. */
  apiKey?: string;
  /** `new`, an existing instance id, or `endpoint`. */
  aiSearch?: string;
  endpoint?: string;
  httpUrl?: string;
  httpMode?: 'murmur' | 'openai';
  httpToken?: string;
  retellAgent?: string;
  docs?: string[];
  cfToken?: string;
  cfAccount?: string;
  /** false turns the CRM dashboard off. */
  dashboard?: boolean;
  adminEmail?: string;
  /** Empty means generate one. Hashed before it is stored anywhere. */
  adminPassword?: string;
  /** What visitors see the assistant called. */
  agentName?: string;
  /** What the assistant should steer visitors towards. */
  goal?: Goal;
  /** Anything the assistant must know or never say, in the owner's words. */
  notes?: string;
  /** Pre-chat form fields, comma separated (`name,email,phone`), or `none`. */
  leadForm?: string;
  deploy?: boolean;
};

export type Goal = 'answer' | 'leads' | 'book' | 'sell';
export const GOALS: Option[] = [
  { value: 'leads', label: 'Turn visitors into enquiries', hint: 'answer, then offer to take their details' },
  { value: 'answer', label: 'Answer questions', hint: 'a helpful guide to the business' },
  { value: 'book', label: 'Book calls or appointments', hint: 'point people to booking' },
  { value: 'sell', label: 'Recommend the right product or plan', hint: 'guide choices, link to buy' },
];

/**
 * Questions asked last, once Cloudflare access is known — so the slow work
 * (creating the index, crawling, uploading) can already be running in the
 * background while the owner answers them.
 */
export const LATE_QUESTIONS: readonly QuestionId[] = ['adminEmail', 'adminPassword', 'agentName', 'goal', 'notes', 'leadForm'];

export const LEAD_FORM_FIELDS = ['name', 'email', 'phone', 'message'] as const;
export const DEFAULT_LEAD_FORM = 'name,email,phone,message';

export type QuestionId = keyof Answers;

export type Option = { value: string; label: string; hint?: string };

export type Question = {
  id: QuestionId;
  /** The CLI flag that answers it, e.g. `--backend cloudflare`. */
  flag: string;
  kind: 'text' | 'select' | 'secret' | 'confirm' | 'list';
  ask: string;
  help?: string;
  options?: Option[];
  default?: string | boolean;
  /** Required questions block setup; the rest fall back to `default`. */
  required: boolean;
  /** Also asked in the wizard, even though it has a default. */
  wizard?: boolean;
  /** For secrets: the environment variable the value is stored as. */
  envVar?: string;
};

/** What setup already knows — from the environment, the website and Cloudflare. */
export type Facts = {
  env: Record<string, string>;
  site?: SiteInfo | null;
  accounts?: Account[] | null;
  instances?: AiSearchInstance[] | null;
  knowledgeDir?: string | null;
  /** `wrangler login` is present and usable. */
  cloudflareLogin?: boolean;
  /** `git config user.email`, the likely dashboard owner. */
  gitEmail?: string | null;
};

export const PROVIDER_KEYS: Partial<Record<BackendType, string>> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  retell: 'RETELL_API_KEY',
};

export const MODELS: Partial<Record<BackendType, Option[]>> = {
  // Checked against developers.cloudflare.com/workers-ai/platform/pricing on 2026-10-04.
  'workers-ai': [
    { value: '@cf/zai-org/glm-4.7-flash', label: 'GLM-4.7 Flash', hint: 'default · free plan · ~300 answers a day free' },
    { value: '@cf/openai/gpt-oss-120b', label: 'gpt-oss 120B', hint: 'free plan · steadier tool use · ~4× the cost per answer' },
    { value: '@cf/zai-org/glm-5.3-flash', label: 'GLM-5.3 Flash', hint: 'needs Workers Paid or AI Gateway credits' },
  ],
  cloudflare: [
    { value: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B', hint: 'Workers AI · fast, free tier' },
    { value: '@cf/openai/gpt-oss-120b', label: 'gpt-oss 120B', hint: 'Workers AI · stronger reasoning' },
    { value: '@cf/qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', hint: 'Workers AI · long context' },
  ],
  openai: [
    { value: 'gpt-5-mini', label: 'GPT-5 mini', hint: 'fast and inexpensive' },
    { value: 'gpt-5', label: 'GPT-5', hint: 'most capable' },
    { value: 'gpt-5-nano', label: 'GPT-5 nano', hint: 'cheapest' },
  ],
  anthropic: [
    { value: 'claude-opus-5', label: 'Claude Opus 5', hint: 'most capable' },
    { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'balanced' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'fastest, cheapest' },
  ],
};

export function defaultModel(backend: BackendType): string | undefined {
  return MODELS[backend]?.[0]?.value;
}

function hasKey(facts: Facts, name: string | undefined): boolean {
  return Boolean(name && facts.env[name]);
}

function backendOptions(facts: Facts): Option[] {
  const found = (backend: BackendType) => (hasKey(facts, PROVIDER_KEYS[backend]) ? ' · key found' : '');
  return [
    {
      value: 'workers-ai',
      label: 'Workers AI + your own knowledge base',
      hint: 'recommended · free plan · Murmur crawls your site into Vectorize and D1 on your account',
    },
    {
      value: 'cloudflare',
      label: 'Cloudflare AI Search',
      hint: 'Cloudflare manages crawling and retrieval; needs AI Search on your account',
    },
    { value: 'openai', label: 'OpenAI + File Search', hint: `GPT models${found('openai')}` },
    { value: 'gemini', label: 'Gemini + File Search', hint: `Google models${found('gemini')}` },
    { value: 'anthropic', label: 'Anthropic Claude', hint: `knowledge via Cloudflare AI Search${found('anthropic')}` },
    { value: 'http', label: 'Your own API', hint: 'any URL: Murmur protocol or OpenAI-compatible, JSON or streaming' },
    { value: 'retell', label: 'Retell agent', hint: `an agent you built in Retell${found('retell')}` },
  ];
}

/** The unanswered questions, in the order the wizard asks them. */
export function pendingQuestions(answers: Answers, facts: Facts): Question[] {
  const out: Question[] = [];
  const backend = answers.backend;

  if (answers.website === undefined) {
    out.push({
      id: 'website',
      flag: '--url',
      kind: 'text',
      ask: 'What is your website address?',
      help: 'Used for the name, brand colour, allowed origins and the knowledge base. Answer "none" if there is no site yet.',
      required: true,
    });
  }

  const noSite = answers.website === '' || answers.website === 'none';
  if (answers.name === undefined && (noSite || (facts.site !== undefined && !facts.site?.name))) {
    out.push({
      id: 'name',
      flag: '--name',
      kind: 'text',
      ask: 'What is the business called?',
      required: noSite,
      wizard: noSite,
      ...(facts.site?.origin ? { default: guessName(facts.site.origin) } : {}),
    });
  }

  if (!backend && answers.defaults === false) {
    out.push({
      id: 'backend',
      flag: '--backend',
      kind: 'select',
      ask: 'Which backend should answer your visitors?',
      options: backendOptions(facts),
      default: DEFAULT_BACKEND,
      required: false,
      wizard: true,
    });
  }

  // With the defaults taken, the model is the default too; it is only asked in the advanced path.
  if (backend && MODELS[backend] && answers.model === undefined) {
    out.push({
      id: 'model',
      flag: '--model',
      kind: 'select',
      ask: 'Which model?',
      options: MODELS[backend],
      default: defaultModel(backend)!,
      required: false,
      // The wizard asks for the website and nothing else; models, files and the rest are flags or Settings.
      wizard: false,
    });
  }

  const keyName = backend ? PROVIDER_KEYS[backend] : undefined;
  if (keyName && answers.apiKey === undefined && !hasKey(facts, keyName)) {
    out.push({
      id: 'apiKey',
      flag: '--api-key',
      kind: 'secret',
      ask: `Your ${providerName(backend!)} API key`,
      help: `Stored in .env as ${keyName} and uploaded as a Worker secret. Or set ${keyName} in the environment instead.`,
      required: true,
      envVar: keyName,
    });
  }

  if (backend === 'retell' && !answers.retellAgent) {
    out.push({ id: 'retellAgent', flag: '--retell-agent', kind: 'text', ask: 'Your Retell agent id (agent_…)', required: true });
  }

  if (backend === 'http') {
    if (!answers.httpUrl) {
      out.push({
        id: 'httpUrl',
        flag: '--http-url',
        kind: 'text',
        ask: 'Your API base URL',
        help: 'Murmur protocol: we POST {url}/start and {url}/message. OpenAI-compatible: we POST {url}/chat/completions.',
        required: true,
      });
    }
    if (answers.httpMode === undefined) {
      out.push({
        id: 'httpMode',
        flag: '--http-mode',
        kind: 'select',
        ask: 'What does your API speak?',
        options: [
          { value: 'murmur', label: 'Murmur protocol', hint: 'your API owns prompt, retrieval and model; JSON or SSE' },
          { value: 'openai', label: 'OpenAI Chat Completions', hint: 'vLLM, Ollama, LiteLLM, OpenRouter, DeepSeek…' },
        ],
        default: answers.httpUrl && /\/v\d+\/?$|chat\/completions|openai|ollama|:11434/.test(answers.httpUrl) ? 'openai' : 'murmur',
        required: false,
        wizard: true,
      });
    }
    if (answers.httpToken === undefined && !hasKey(facts, 'MURMUR_BACKEND_TOKEN')) {
      out.push({
        id: 'httpToken',
        flag: '--http-token',
        kind: 'secret',
        ask: 'Bearer token for your API (Enter to skip)',
        required: false,
        wizard: true,
        envVar: 'MURMUR_BACKEND_TOKEN',
      });
    }
  }

  const aiSearchBackend = backend === 'cloudflare' || backend === 'anthropic';
  const reusable = reusableInstances(facts);
  if (aiSearchBackend && answers.aiSearch === undefined && reusable.length > 0) {
    const crawlsThisSite = matchingInstance(facts);
    const siteHost = facts.site ? hostOf(facts.site.url) : null;
    out.push({
      id: 'aiSearch',
      flag: '--ai-search',
      kind: 'select',
      ask: 'Which AI Search instance should hold the knowledge?',
      options: [
        ...(crawlsThisSite ? [{ value: crawlsThisSite, label: `Use "${crawlsThisSite}"`, hint: `already crawls ${siteHost ?? 'this site'} — ready now` }] : []),
        { value: 'new', label: 'Create a new one', hint: 'murmur sets it up and indexes your site and files' },
        ...reusable
          .filter((instance) => instance.id !== crawlsThisSite)
          .map((instance) => ({
            value: instance.id,
            label: `Use "${instance.id}"`,
            hint:
              instance.type === 'web-crawler'
                ? `crawls ${instance.source ?? 'another site'}${siteHost ? ' — a different site' : ''}`
                : 'existing instance',
          })),
        { value: 'endpoint', label: 'Use a public endpoint URL', hint: 'an instance on another account' },
      ],
      default: crawlsThisSite ?? 'new',
      required: false,
      wizard: true,
    });
  }
  if (aiSearchBackend && answers.aiSearch === 'endpoint' && !answers.endpoint) {
    out.push({
      id: 'endpoint',
      flag: '--ai-search-endpoint',
      kind: 'text',
      ask: 'The public endpoint URL (e.g. https://<id>.search.ai.cloudflare.com)',
      required: true,
    });
  }

  if (backend && ['workers-ai', 'cloudflare', 'openai', 'gemini', 'anthropic'].includes(backend) && answers.docs === undefined) {
    out.push({
      wizard: false,
      id: 'docs',
      flag: '--docs',
      kind: 'list',
      ask: 'Any files or folders to learn from? (PDF, Markdown, text — comma separated, Enter to skip)',
      ...(facts.knowledgeDir ? { default: facts.knowledgeDir } : {}),
      required: false,
    });
  }

  if (!answers.cfToken && !hasKey(facts, 'CLOUDFLARE_API_TOKEN') && !facts.cloudflareLogin) {
    out.push({
      id: 'cfToken',
      flag: '--cf-token',
      kind: 'secret',
      ask: 'Your Cloudflare API token',
      help: `Easiest: run \`npx wrangler login\` (opens a browser), then run this again — no token needed.\nOr: ${TOKEN_HELP}`,
      required: true,
      envVar: 'CLOUDFLARE_API_TOKEN',
    });
  }

  if (!answers.cfAccount && !facts.env['CLOUDFLARE_ACCOUNT_ID'] && (facts.accounts?.length ?? 0) > 1) {
    out.push({
      id: 'cfAccount',
      flag: '--cf-account',
      kind: 'select',
      ask: 'Which Cloudflare account?',
      options: facts.accounts!.map((a) => ({ value: a.id, label: a.name, hint: a.id })),
      required: true,
    });
  }

  // workers-ai: the first dashboard account is created from the setup link, in the browser.
  const setupLink = (backend ?? (answers.defaults === false ? undefined : DEFAULT_BACKEND)) === 'workers-ai';
  if (answers.dashboard !== false && answers.adminEmail === undefined && !setupLink) {
    out.push({
      id: 'adminEmail',
      flag: '--admin-email',
      kind: 'text',
      ask: 'Email to sign in to your leads dashboard',
      help: 'The dashboard at <your-worker>/admin shows every conversation, lead and summary. Turn it off with --no-dashboard.',
      ...(facts.gitEmail ? { default: facts.gitEmail } : {}),
      required: !facts.gitEmail,
      wizard: true,
    });
  }
  if (answers.dashboard !== false && answers.adminPassword === undefined && (!setupLink || answers.adminEmail)) {
    out.push({
      id: 'adminPassword',
      flag: '--admin-password',
      kind: 'secret',
      ask: 'Dashboard password (Enter to generate a strong one)',
      required: false,
      wizard: true,
    });
  }


  const promptable = answers.backend !== 'retell' && !(answers.backend === 'http' && answers.httpMode !== 'openai');
  if (answers.agentName === undefined) {
    out.push({
      id: 'agentName',
      flag: '--agent-name',
      kind: 'text',
      ask: 'What should visitors see the assistant called?',
      default: 'Assistant',
      required: false,
      wizard: false,
    });
  }
  if (answers.goal === undefined && promptable) {
    out.push({
      id: 'goal',
      flag: '--goal',
      kind: 'select',
      ask: 'What should it help visitors do most?',
      options: GOALS,
      default: 'leads',
      required: false,
      wizard: false,
    });
  }
  if (answers.leadForm === undefined) {
    out.push({
      id: 'leadForm',
      flag: '--lead-form',
      kind: 'select',
      ask: 'Ask visitors for their details before they start chatting?',
      options: [
        { value: DEFAULT_LEAD_FORM, label: 'Name, email, phone (optional) and their question', hint: 'every conversation becomes a lead' },
        { value: 'none', label: 'No — let them chat straight away', hint: 'the assistant asks for details only for a callback' },
        { value: 'name,email', label: 'Name and email', hint: 'every conversation becomes a lead' },
        { value: 'name,email,phone', label: 'Name, email and phone', hint: 'phone optional — best for businesses that call back' },
      ],
      default: DEFAULT_LEAD_FORM,
      required: false,
      wizard: false,
    });
  }
  if (answers.notes === undefined && promptable) {
    out.push({
      id: 'notes',
      flag: '--notes',
      kind: 'text',
      ask: 'Anything it must know or never say? (Enter to skip)',
      help: 'For example: "We only serve Melbourne", "Never quote prices — offer a free quote", "Closed on public holidays".',
      default: '',
      required: false,
      wizard: false,
    });
  }

  return out;
}

const hostOf = (value: string) => value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();

/** An existing instance that already crawls this website — reusing it is free and already indexed. */
export function matchingInstance(facts: Facts): string | null {
  if (!facts.site || !facts.instances) return null;
  const site = hostOf(facts.site.url);
  return facts.instances.find((i) => i.type === 'web-crawler' && typeof i.source === 'string' && hostOf(i.source) === site)?.id ?? null;
}

/**
 * Instances worth offering. One murmur created for another site is that
 * site's knowledge, never a sensible choice here, so it is not listed.
 */
export function reusableInstances(facts: Facts): AiSearchInstance[] {
  const own = facts.site ? `${RESOURCE_PREFIX}-${siteIdFor(facts.site.url)}` : null;
  return (facts.instances ?? []).filter((i) => !i.id.startsWith(`${RESOURCE_PREFIX}-`) || i.id === own);
}

function providerName(backend: BackendType): string {
  return { openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Anthropic', retell: 'Retell' }[backend as string] ?? backend;
}

/** `https://www.acme-plumbing.com.au` → `Acme Plumbing`. */
export function guessName(origin: string): string {
  const label = new URL(origin).hostname.replace(/^www\./, '').split('.')[0] ?? 'My site';
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

/** Apply a question's default. */
export function defaultAnswer(question: Question): unknown {
  if (question.kind === 'list') return question.default ? String(question.default).split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (question.kind === 'secret') return '';
  return question.default;
}

/** A question as an agent should see it: what to ask, how to pass the answer. */
export function describeForAgent(question: Question) {
  return {
    id: question.id,
    ask: question.ask,
    flag: question.flag,
    kind: question.kind,
    required: question.required,
    ...(question.help ? { help: question.help } : {}),
    ...(question.options ? { options: question.options } : {}),
    ...(question.default !== undefined ? { default: question.default } : {}),
    ...(question.envVar ? { envVar: question.envVar, secret: true } : {}),
  };
}
