/** The dashboard's only way to reach the Worker. Same origin, cookie session. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorized = new Set<Listener>();
export function onUnauthorized(listener: Listener): () => void {
  unauthorized.add(listener);
  return () => unauthorized.delete(listener);
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(`/admin/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
  if (response.status === 401 && path !== '/login') unauthorized.forEach((listener) => listener());
  throw new ApiError(response.status, body.error?.message ?? `Request failed (${response.status})`, body.error?.code);
}

// ------------------------------------------------------------------ types

export type Site = {
  id: string;
  name: string;
  accent: string;
  avatar: string | null;
  embed: string;
  connector: string;
  /** The workers-ai knowledge base is on: Knowledge page and onboarding apply. */
  knowledge: boolean;
  website: string | null;
  /** The "Before you go live" checklist. Absent from older Workers. */
  production?: { turnstile: boolean; hostnames: string[]; dailyCap: number };
  /** Live chat is on and can run (the live socket, notifications). Absent from older Workers. */
  live?: boolean;
};
/** `member`: the inbox only (conversations, jobs, contacts, callbacks, live chat); `admin` and `owner`: everything. */
export type Role = 'owner' | 'admin' | 'member';
export type Me = { admin: { email: string; owner: boolean; role?: Role; name?: string | null }; sites: Site[]; summaries: boolean };

/** Older Workers have no roles: everyone is an admin there. */
export const roleOf = (me: Me): Role => me.admin.role ?? (me.admin.owner ? 'owner' : 'admin');
export const isMember = (me: Me) => roleOf(me) === 'member';

export type Overview = {
  range: { days: number; since: number };
  totals: Totals;
  previous: Totals;
  series: { date: string; conversations: number; leads: number }[];
  topPages: { url: string; count: number }[];
  countries: { country: string; count: number }[];
  recentQuestions: { id: string; text: string; at: number }[];
  recentLeads: { id: string; name: string | null; email: string | null; phone: string | null; status: string; at: number; conversationId: string | null }[];
};
export type Totals = { conversations: number; messages: number; leads: number; conversion: number; avgMessages: number };

export type ConversationRow = {
  id: string;
  site: string;
  startedAt: number;
  lastAt: number;
  pageUrl: string | null;
  country: string | null;
  firstMessage: string | null;
  messageCount: number;
  summary: string | null;
  intent: string | null;
  leadName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  leadStatus: LeadStatus | null;
  /** This conversation's callback request: the open one if any, else the latest. */
  callback: 'open' | 'done' | 'dismissed' | null;
  /** Absent from older Workers. */
  status?: ConversationStatus;
  assignedTo?: string | null;
  assignedName?: string | null;
  /** A live chat whose visitor is waiting for the team's reply, since then. */
  waitingSince?: number | null;
  attributes?: Record<string, string>;
  labels?: LabelRef[];
};

/** `bot`: the assistant answers; `live`: a person does; `closed`: by the team, or quiet for a while. */
export type ConversationStatus = 'bot' | 'live' | 'closed';
export type LabelRef = { id: string; name: string; color: string };
export type Label = LabelRef & { description: string | null; ai: boolean };
export type Note = { id: string; conversationId?: string | null; leadId?: string | null; author: string; authorName: string | null; text: string; createdAt: number; updatedAt: number };

/** A conversation's AI summary and labels: written when it goes quiet (or by the Summarise button). */
export type Summary = {
  summary: string;
  intent: string | null;
  sentiment: string | null;
  followUp: string | null;
  leadQuality?: 'hot' | 'warm' | 'cold' | 'none' | null;
  outcome?: 'answered' | 'callback_requested' | 'lead_captured' | 'unanswered' | 'abandoned' | null;
  topics?: string[];
  unanswered?: string[];
};

export type StoredMessage = {
  id: string;
  role: 'user' | 'agent' | 'system';
  type: string;
  text: string | null;
  payload: Record<string, unknown> | null;
  ts: number;
  /** A visitor's rating of an assistant reply: 1, -1, or null. */
  feedback?: number | null;
  /** Who on the team wrote it (live chat); null for the assistant and the visitor. */
  author?: string | null;
};

export type Lead = {
  id: string;
  site?: string;
  site_id?: string;
  conversationId?: string | null;
  conversation_id?: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company?: string | null;
  address?: string | null;
  attributes?: Record<string, string>;
  fields: string | null;
  source: 'form' | 'chat' | 'ai' | 'api';
  status: LeadStatus;
  notes: string | null;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  /** One person can have several chats (the email is the key); the latest is linked. */
  conversations?: number;
  lastConversationId?: string | null;
  /** Callback requests from this person still waiting. */
  openCallbacks?: number;
};

export type ConversationDetail = {
  conversation: Record<string, unknown> & {
    id: string;
    summary: string | null;
    started_at: number;
    last_at: number;
    status?: ConversationStatus;
    assigned_to?: string | null;
    assigned_name?: string | null;
    waiting_since?: number | null;
    attributes?: Record<string, string>;
  };
  lead: Lead | null;
  callbacks: Callback[];
  labels?: (LabelRef & { addedBy: string; addedAt: number })[];
  notes?: Note[];
  messages: StoredMessage[];
};

/** A contact's page: their details, every conversation, the team's notes and callback requests. */
export type ContactDetail = Lead & {
  conversations: {
    id: string;
    startedAt: number;
    lastAt: number;
    pageUrl: string | null;
    firstMessage: string | null;
    messageCount: number;
    summary: string | null;
    intent?: string | null;
    channel: string | null;
    status?: ConversationStatus;
    assignedName?: string | null;
    labels?: LabelRef[];
  }[];
  teamNotes?: Note[];
  callbacks?: Callback[];
};

export type TeamMember = { email: string; name: string | null; role: Role; createdAt: number; lastLoginAt: number | null };
export type Team = { me: string; owner: string; admins: TeamMember[] };

/** Each person's own live-chat notification settings. */
export type Prefs = {
  available: boolean;
  notifyNewChat: boolean;
  notifyNewMessage: boolean;
  soundNewChat: boolean;
  soundNewMessage: boolean;
  sound: 'chime' | 'bell' | 'pop';
  volume: number;
  repeatUntilTaken: boolean;
};

export type LiveStatus = {
  enabled: boolean;
  hub: boolean;
  available: number;
  agents: { email: string; name: string | null; available: boolean }[];
  telegram: { connected: boolean; linked: boolean };
  live: number;
  unassigned: number;
  waiting: number;
  mine: number;
};

export type TelegramView = {
  connected: boolean;
  linked: boolean;
  bot: { name: string; username: string } | null;
  chat: { title: string | null; topics: boolean } | null;
  linkCode: string | null;
  shareContact: boolean;
  status: string | null;
  lastError: string | null;
  updatedAt: number | null;
};

export type LiveSettings = { enabled: boolean; waitSeconds: number; closeAfterMinutes: number; showAgentName: boolean; aiWhileWaiting: boolean };

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function parseSummary(value: string | null | undefined): Summary | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Summary;
  } catch {
    return { summary: value, intent: null, sentiment: null, followUp: null };
  }
}

export type PromptSource = 'cli' | 'dashboard' | 'restore';
export type PromptVersion = {
  version: number;
  hash: string;
  source: PromptSource;
  author: string | null;
  note: string | null;
  restoredFrom: number | null;
  createdAt: number;
  chars: number;
};
export type PromptView = {
  site: string;
  connector: string;
  editable: boolean;
  reason: string | null;
  text: string;
  hash: string;
  /** 0 until the first version is recorded. */
  version: number;
  meta: { version: number; at: number; by: string | null; source: PromptSource } | null;
  limit: number;
  versions: PromptVersion[];
  /** What HelpPuff adds to this prompt on every answer (read-only); null when it adds nothing. */
  builtIn: string | null;
  /** Lines of the live prompt that settings or built-in rules already cover. */
  overlaps: { line: number; text: string; why: string }[];
};
export type PublishResult = { status: 'published' | 'unchanged'; version: number };

// ------------------------------------------------------------------ knowledge

export type PageStatus = 'discovered' | 'queued' | 'fetched' | 'indexed' | 'unchanged' | 'skipped' | 'blocked' | 'error';

export type DiscoveredUrl = {
  url: string;
  source: 'home' | 'sitemap' | 'link';
  category: string;
  suggested: boolean;
  selected: boolean;
  status: PageStatus;
  title: string | null;
  error: string | null;
};
export type Discovery = { site: string; origin: string; reachable: boolean; sitemaps: string[]; warnings: string[]; urls: DiscoveredUrl[] };

export type CrawlRun = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  trigger: string | null;
  total: number;
  done: number;
  failed: number;
  chunks: number;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type Usage = {
  day: string;
  neurons: number;
  messages: number;
  budget: number;
  freeAllocation: number;
  messagesLeft: number;
  state: 'ok' | 'tight' | 'exhausted' | 'unlimited';
};

export type KnowledgeStatus = {
  site: string;
  connector: string;
  browserRendering: boolean;
  workflow: boolean;
  schedule: string;
  run: CrawlRun | null;
  pages: Partial<Record<PageStatus, number>>;
  chunks: number;
  lastIndexedAt: number | null;
  usage: Usage;
};

export type KnowledgePage = {
  id: string;
  url: string;
  finalUrl: string | null;
  title: string | null;
  category: string | null;
  status: PageStatus;
  httpStatus: number | null;
  error: string | null;
  selected: number;
  source: string | null;
  crawledAt: number | null;
  chunks: number;
};

export type Passage = { id: string; url: string; title: string; headingPath: string; category: string; content: string; score: number };
export type SearchResult = { query: string; chunks: Passage[]; trace: { vector: number; keyword: number; reranked: boolean; threshold: number; errors: string[] } };

export type Fact = { key: string; value: string; source: 'owner' | 'crawl' | null; sourceUrl: string | null };
export type ManualEntry = { id: string; title: string; content: string; updatedAt: number };

export type FileStatus = 'queued' | 'reading' | 'learning' | 'indexed' | 'error';
export type KnowledgeFile = {
  id: string;
  name: string;
  kind: 'pdf' | 'docx' | 'md' | 'txt';
  size: number;
  status: FileStatus;
  error: string | null;
  chunks: number;
  /** Longer than the limit: only the start was learned. */
  truncated: number;
  createdAt: number;
  updatedAt: number;
};

/** Upload a document as the raw body; it is read and learned in the background. */
export function uploadFile(file: File): Promise<{ id: string; status: FileStatus }> {
  return api(`/knowledge/files?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
}

export type LeadField = { name: string; label: string; type: 'text' | 'email' | 'tel' | 'textarea' | 'select'; required: boolean; options?: string[] };

export type Settings = {
  botName: string;
  businessName: string;
  welcomeMessage: string;
  starterQuestions: string[];
  accent: string;
  position: 'bottom-right' | 'bottom-left';
  launcherIcon: string;
  leads: { enabled: boolean; fields: LeadField[] };
  assistant: { model: string; locale: string | null; timezone: string | null; rerank: boolean; reasoning: 'low' | 'medium' | 'high' } | null;
  /** How the assistant behaves; HelpPuff writes it around the prompt. */
  behaviour: { goal: 'callbacks' | 'answers' | 'bookings'; tone: 'friendly' | 'professional' | 'casual'; length: 'short' | 'detailed'; prices: 'share' | 'quote'; bookingUrl?: string };
  crawl: { schedule: 'off' | 'daily' | 'weekly' | 'monthly'; include: string[]; exclude: string[]; renderJs: 'auto' | 'always' | 'never' };
  /** Limits, sign-in and IP lists (`security` in helppuff.json, Turnstile keys aside). Absent from older Workers. */
  security?: SecuritySettings;
  /** Live chat. Absent from older Workers. */
  live?: LiveSettings;
  /** The widget's first screen. Absent from older Workers. */
  home?: HomeSettings;
};
export type ShortcutAction =
  | { id: string; kind: 'reply'; label: string; value: string }
  | { id: string; kind: 'url'; label: string; url: string; newTab?: boolean }
  | { id: string; kind: 'tel'; label: string; phone: string }
  | { id: string; kind: 'email'; label: string; email: string }
  | { id: string; kind: 'form'; label: string; formId: string }
  | { id: string; kind: 'flow'; label: string; flowId: string };
export type Shortcut = { id: string; label: string; description?: string; icon?: string; action: ShortcutAction; paths?: string[] };
export type HomeLink = { label: string; url: string; description?: string };
export type HomeLinks = { title: string; items: HomeLink[] };
export type HomeSettings = { title: string; subtitle: string; shortcuts: Shortcut[]; links: HomeLinks | null };
export type HomeSuggestion = { questions: string[]; links: HomeLinks | null; contact: Shortcut[]; source: 'model' | 'default' };
export type Limits = {
  messagesPerIpPerMinute: number;
  messagesPerIpPerDay: number;
  sessionsPerIpPerHour: number;
  sessionsPerIpPerDay: number;
  messagesPerSession: number;
  messagesPerSitePerDay: number;
  maxMessageLength: number;
  maxLeadFieldLength: number;
  maxLeadMessageLength: number;
  feedbackPerIpPerMinute: number;
  pollsPerIpPerMinute: number;
  endsPerIpPerMinute: number;
  retellLookupsPerMinute: number;
  apiRequestsPerKeyPerMinute: number;
  apiKeysPerSite: number;
  handoversPerIpPerDay?: number;
  waitingPerSite?: number;
  liveSocketsPerIp?: number;
};
export type SecuritySettings = {
  limits: Limits;
  signIn: { attemptsPerIp: number; attemptsPerAccount: number; windowMinutes: number; captcha: boolean };
  allowIps: string[];
  blockIps: string[];
  sessionTtlHours: number;
};
export type SettingsView = {
  site: string;
  connector: string;
  settings: Settings;
  hash: string;
  meta: { at: number; by: string | null } | null;
  /** Turnstile is set up (`security.captcha`). */
  captcha?: boolean;
  /** What the widget's home screen shows until it is set up: suggested from the website. */
  suggestedHome?: { questions: string[]; links: HomeLinks | null; at: number } | null;
  /** Who writes the answers and what they come from: changed only with the CLI. Null for a backend that runs its own. */
  ai?: { provider: string | null; model: string | null; knowledge: string | null } | null;
  /** What a shortcut can open. */
  forms?: { id: string; title: string }[];
  flows?: { id: string; title: string }[];
};

export type CallbackStatus = 'open' | 'done' | 'dismissed';
export type Callback = {
  id: string;
  conversationId: string;
  leadId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  reason: string | null;
  status: CallbackStatus;
  note: string | null;
  requestedAt: number;
  closedAt: number | null;
  closedBy: string | null;
  pageUrl: string | null;
};
export type CallbackList = { items: Callback[]; counts: Record<CallbackStatus, number> };

// ------------------------------------------------------------------ jobs

export type StageKind = 'open' | 'won' | 'lost';
export type JobStage = { id: string; name: string; color: string; position: number; kind: StageKind; rotDays: number | null };
export type JobFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'email' | 'tel';
export type JobField = {
  id: string;
  name: string;
  label: string;
  type: JobFieldType;
  required: boolean;
  options: string[];
  question: string | null;
  position: number;
  inQuote: boolean;
  quotePosition: number | null;
  archived: boolean;
};
export type Pipeline = {
  siteId: string;
  template: string;
  itemSingular: string;
  itemPlural: string;
  chosenBy: 'ai' | 'owner' | 'default';
  reason: string | null;
  assistantJobs: boolean;
  quote: { enabled: boolean; label: string; askContact: boolean };
  editedAt: number | null;
  stages: JobStage[];
  fields: JobField[];
  quotePreview: { field: string; ask: string; input: string; choices?: string[] }[];
};
export type JobTemplate = { id: string; name: string; description: string; stages: { name: string; kind: StageKind; color: string }[]; fields: { name: string; label: string }[] };
export type PipelineView = { pipeline: Pipeline; templates: JobTemplate[] };

export type Job = {
  id: string;
  number: number;
  title: string;
  details: string | null;
  stage: { id: string; name: string; kind: StageKind } | null;
  status: StageKind;
  fields: Record<string, string>;
  contact: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  conversationId: string | null;
  source: 'chat' | 'quote' | 'api' | 'manual' | 'callback';
  value: number | null;
  valueCents: number | null;
  currency: string | null;
  dueAt: number | null;
  assignedTo: string | null;
  assignedName: string | null;
  position: number;
  stale: boolean;
  stageChangedAt: number;
  closedAt: number | null;
  lostReason: string | null;
  createdAt: number;
  updatedAt: number;
};
export type JobList = { items: Job[]; stages: (JobStage & { count: number; valueCents: number })[] };
export type JobEvent = { id: string; at: number; actor: string; actorName: string | null; kind: string; data: Record<string, unknown> | null };
export type JobDetail = Job & { history: JobEvent[]; notes: Note[]; conversation: { id: string; firstMessage: string | null; startedAt: number } | null };
