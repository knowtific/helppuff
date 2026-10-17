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

type ErrorBody = { error?: { message?: string; code?: string; reason?: string; hint?: string } };

/** The Worker's message, plus what actually went wrong and what to do (it says so to signed-in people). */
function errorText(body: ErrorBody, fallback: string): string {
  const e = body.error;
  const text = e?.message ?? fallback;
  if (!e?.reason) return text;
  return `${text} ${e.reason}${e.hint ? ` Fix: ${e.hint}.` : ''}`;
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
  const body = (await response.json().catch(() => ({}))) as ErrorBody;
  if (response.status === 401 && path !== '/login') unauthorized.forEach((listener) => listener());
  throw new ApiError(response.status, errorText(body, `Request failed (${response.status})`), body.error?.code);
}

/**
 * A file from the admin API (an export), saved under the name the server
 * gives it. Fetched, not navigated to, so a failure stays on the page as an
 * error instead of replacing the dashboard (and the demo can answer it).
 */
export async function download(path: string): Promise<void> {
  const response = await fetch(`/admin/api${path}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    if (response.status === 401) unauthorized.forEach((listener) => listener());
    throw new ApiError(response.status, errorText(body, `Download failed (${response.status})`), body.error?.code);
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? path.split('/').pop() ?? 'download';
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
  /** HelpPuff writes the backend's prompt, so Instructions and Prompt & tools apply. Absent from older Workers (treated as yes). */
  prompt?: boolean;
  /** Whether finished conversations are automatically summarised and labelled. Absent from older Workers (treated as on). */
  autoSummary?: boolean;
  /** How visitors book: `picker` turns on the Calendar page and appointments on jobs. Absent from older Workers. */
  bookings?: 'none' | 'link' | 'picker';
};
/** `member`: the inbox only (conversations, jobs, contacts, callbacks, live chat); `admin` and `owner`: everything. */
export type Role = 'owner' | 'admin' | 'member';
export type Me = { admin: { email: string; owner: boolean; role?: Role; name?: string | null }; sites: Site[]; summaries: boolean };

/** Older Workers have no roles: everyone is an admin there. */
export const roleOf = (me: Me): Role => me.admin.role ?? (me.admin.owner ? 'owner' : 'admin');
export const isMember = (me: Me) => roleOf(me) === 'member';

export type Overview = {
  range: { days: number; since: number };
  /** Callbacks waiting now, whatever the range. */
  openCallbacks?: number;
  totals: Totals;
  previous: Totals;
  series: { date: string; conversations: number; leads: number }[];
  topPages: { url: string; count: number }[];
  countries: { country: string; count: number }[];
  recentQuestions: { id: string; text: string; at: number }[];
  recentLeads: { id: string; name: string | null; email: string | null; phone: string | null; status: string; at: number; conversationId: string | null }[];
  /** Older Workers have none of these. */
  headline?: { current: Headline; previous: Headline };
  insights?: Insights;
  health?: HealthIssue[];
};
export type Headline = { summarized: number; resolved: number; escalated: number; needsPerson: number; unanswered: number; ratedUp: number; ratedDown: number; callbacks: number };
export type Insights = {
  outcomes: Record<'answered' | 'booked' | 'lead_captured' | 'callback_requested' | 'unanswered' | 'abandoned' | 'pending', number>;
  sentiment: Record<'positive' | 'neutral' | 'negative', number>;
  leadQuality: Record<'hot' | 'warm' | 'cold' | 'none', number>;
  engagement: { avgMessages: number; medianSeconds: number | null; oneMessage: number; returningVisitors: number };
  unansweredQuestions: { text: string; count: number; conversationId: string }[];
  topics: { topic: string; count: number }[];
  hours: number[];
  live: { requested: number; answered: number; missed: number; medianWaitSeconds: number | null; byPerson: { name: string; count: number }[] };
  callbacks: { requested: number; done: number; dismissed: number; open: number; medianHoursToDone: number | null };
  jobs: { created: number; fromChat: number; won: number; lost: number; wonValue: number; currency: string | null };
  appointments: { booked: number; fromChat: number; completed: number; noShow: number; cancelled: number };
};
/** A question to answer (`GET /knowledge/gaps`): asked by visitors, not in the knowledge base. */
export type Gap = {
  id: string;
  question: string;
  count: number;
  firstAskedAt: number;
  lastAskedAt: number;
  conversationId: string | null;
  status: 'open' | 'answered' | 'dismissed';
  answerId: string | null;
  answeredBy: string | null;
};
export type GapList = { gaps: Gap[]; counts: Record<Gap['status'], number> };
export type HealthIssue = { kind: 'webhook' | 'email' | 'tool' | 'budget' | 'knowledge'; title: string; detail: string | null; page: string };
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
export type ContactTag = LabelRef;
export type Note = { id: string; conversationId?: string | null; leadId?: string | null; author: string; authorName: string | null; text: string; createdAt: number; updatedAt: number };

/** A conversation's AI summary and labels: written when it goes quiet (or by the Summarise button). */
export type Summary = {
  summary: string;
  intent: string | null;
  sentiment: string | null;
  followUp: string | null;
  leadQuality?: 'hot' | 'warm' | 'cold' | 'none' | null;
  outcome?: 'answered' | 'booked' | 'callback_requested' | 'lead_captured' | 'unanswered' | 'abandoned' | null;
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
  tags?: ContactTag[];
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
    /** What the site's tools returned or saved, by tool name. */
    data?: Record<string, unknown>;
    /** The signed-in visitor, verified by a signed identity (or the API's user); null when nobody signed in. */
    user?: (Record<string, string> & { id: string }) | null;
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
  /** The emails this person gets (Settings → Notifications). */
  emails: string[];
};

/** What there is to choose, and whether the site can send email (`GET /notifications`). */
export type NotificationsInfo = {
  email: { configured: boolean; enabled: boolean; lastStatus?: string | null; lastError?: string | null; lastAt?: number | null };
  choices: { type: string; label: string; description: string }[];
};

/** The email service (`GET /notifications/email`, admins). */
export type EmailService = {
  method: string;
  url: string;
  headers: ToolHeaderView[];
  body: string;
  enabled: boolean;
  dashboardUrl: string | null;
  lastStatus: 'ok' | 'failed' | null;
  lastError: string | null;
  lastAt: number | null;
  updatedBy: string | null;
  updatedAt: number;
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

// ---------------------------------------------------------------------- tools

export type ToolParamView = { name: string; description: string; required: boolean };
export type ToolHeaderView = { name: string; value: string; secret: boolean; /** A value is stored (secret values are never sent back). */ set?: boolean };
export type ToolView = {
  id: string;
  name: string;
  kind: 'http' | 'extract';
  description: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  headers?: ToolHeaderView[];
  body?: string;
  parameters?: ToolParamView[];
  fields?: ToolParamView[];
  pick?: string[];
  timeoutMs?: number;
  /** What it returns or saves, for `{{name.key}}`. */
  keys: string[];
  before: boolean;
  after: boolean;
  /** After the chat, run only when this holds (on the conversation.completed data). */
  when?: { path: string; in?: string[] } | null;
  enabled: boolean;
  lastStatus: number | null;
  lastError: string | null;
  lastAt: number | null;
};
/** What importing an agent file changes (or changed): `POST /agent/import`. */
export type AgentPlan = {
  site: string;
  dryRun: boolean;
  ready: boolean;
  name: string;
  settings: string[];
  tools: { name: string; action: 'create' | 'replace' }[];
  prompt: { action: 'replace' | 'unchanged' | 'skipped'; version: number; reason?: string } | null;
  missingSecrets: { name: string; description: string }[];
};

export type ToolsList = {
  tools: ToolView[];
  assistant: boolean;
  prechat: { name: string; label: string }[];
  limits: { tools: number; timeoutMs: { default: number; min: number; max: number } };
};
export type ToolTestResult = { ok: boolean; status: number | null; ms: number; error: string | null; response: unknown; value: unknown; keys: string[]; missing?: string[] };

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

/** A photo or file, with a signed link that works for a while. */
export type StoredFile = { id: string; name: string; type: string; size: number; url?: string; removed?: boolean; uploadedBy?: string; uploadedByName?: string | null; createdAt?: number };
export type JobFiles = { enabled: boolean; storage: boolean; maxMb: number; files: StoredFile[]; fromChat: StoredFile[] };

export const jobFiles = (jobId: string) => api<JobFiles>(`/jobs/${encodeURIComponent(jobId)}/files`);

export function attachJobFile(jobId: string, file: File): Promise<StoredFile> {
  return api(`/jobs/${encodeURIComponent(jobId)}/files?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
}

export const removeJobFile = (jobId: string, fileId: string) => api<{ id: string; deleted: boolean }>(`/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });

export type LeadField = { name: string; label: string; type: 'text' | 'email' | 'tel' | 'textarea' | 'select'; required: boolean; options?: string[] };

export type Settings = {
  /** Automatic summary and AI labels after a chat. Absent from older Workers (treated as on). */
  autoSummary?: boolean;
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
  /** Appointments: how visitors book, the date picker's calendar. Absent from older Workers. */
  bookings?: BookingsSettings;
  /** Photos and files: in the chat, on jobs. Absent from older Workers. */
  files?: FilesSettings;
};

export type FilesSettings = {
  chat: 'off' | 'live' | 'always';
  jobs: boolean;
  maxChatMb: number;
  maxJobMb: number;
  perConversation: number;
  keepChatDays: number;
  aiSeesPhotos: boolean;
  visionModel: string;
};

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type CalendarSync = 'none' | 'calcom' | 'calendly' | 'google' | 'outlook';
export type BookingsSettings = {
  /** Absent: the website decides (a booking link found on it). */
  mode?: 'none' | 'link' | 'picker';
  link?: string;
  label: string;
  sync: CalendarSync;
  account?: string;
  calendar?: string;
  createMeetingLink?: boolean;
  eventType?: string;
  title: string;
  duration: number;
  hours: Record<Weekday, string[]>;
  buffer: number;
  notice: number;
  daysAhead: number;
  timezone?: string;
  phone: 'off' | 'optional' | 'required';
  location?: string;
  syncMinutes: number;
};
/** A patch: null clears a field (`mode: null`: the website decides again). */
export type BookingsPatch = { [K in keyof BookingsSettings]?: BookingsSettings[K] | null };
export type IntegrationView = {
  kind: 'composio' | 'calcom' | 'calendly';
  name: string;
  connected: boolean;
  baseUrl: string | null;
  status: string;
  lastError: string | null;
  lastAt: number | null;
  account: string | null;
  plan: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};
export type BookingsStatus = {
  site: string;
  effective: { mode: 'none' | 'link' | 'picker'; link: string | null; label: string; chosen: boolean };
  found: { url: string; provider: string | null; page: string | null; at: number } | null;
  timezone: string;
  calendar: { sync: CalendarSync; integration: IntegrationView | null; ready: boolean };
  syncedAt: number | null;
  upcoming: number;
};
export type BookingSlots = { timezone: string; days: { date: string; slots: { start: number; end: number }[] }[]; next: string; title: string; duration: number; phone: 'off' | 'optional' | 'required' };
export type EventType = { id: string; name: string; duration: number | null };
export type AppointmentStatus = 'confirmed' | 'pending' | 'cancelled' | 'completed' | 'no_show' | 'busy';
export type Appointment = {
  id: string;
  title: string;
  start: number;
  end: number;
  startIso: string;
  endIso: string;
  timezone: string;
  status: AppointmentStatus;
  source: 'chat' | 'dashboard' | 'api' | 'provider';
  provider: CalendarSync;
  externalId: string | null;
  location: string | null;
  notes: string | null;
  attendee: { name: string | null; email: string | null; phone: string | null } | null;
  job: { id: string; number: number | null; title: string | null } | null;
  contact: { id: string; name: string | null; email: string | null } | null;
  conversationId: string | null;
  rescheduleUrl: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
};
export type SyncResult = { synced: boolean; reason?: string; added: number; updated: number; cancelled: number; busy: number; at: number | null };
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
  slotLookupsPerIpPerMinute: number;
  bookingsPerIpPerHour: number;
  pollsPerIpPerMinute: number;
  endsPerIpPerMinute: number;
  retellLookupsPerMinute: number;
  apiRequestsPerKeyPerMinute: number;
  apiKeysPerSite: number;
  handoversPerIpPerDay?: number;
  waitingPerSite?: number;
  liveSocketsPerIp?: number;
  uploadsPerIpPerHour?: number;
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
  /** The deployment has its R2 bucket: files can work. */
  storage?: boolean;
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
  source: 'chat' | 'quote' | 'api' | 'manual' | 'callback' | 'booking';
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
