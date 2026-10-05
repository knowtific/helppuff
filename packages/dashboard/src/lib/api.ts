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
};
export type Me = { admin: { email: string; owner: boolean }; sites: Site[]; summaries: boolean };

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
};

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
  fields: string | null;
  source: 'form' | 'chat' | 'ai';
  status: LeadStatus;
  notes: string | null;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  /** One person can have several chats (the email is the key); the latest is linked. */
  conversations?: number;
  lastConversationId?: string | null;
};

export type ConversationDetail = {
  conversation: Record<string, unknown> & { id: string; summary: string | null; started_at: number; last_at: number };
  lead: Lead | null;
  messages: StoredMessage[];
};

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
  assistant: { model: string; locale: string | null; timezone: string | null; rerank: boolean } | null;
  crawl: { schedule: 'off' | 'daily' | 'weekly' | 'monthly'; include: string[]; exclude: string[]; renderJs: 'auto' | 'always' | 'never' };
};
export type SettingsView = { site: string; connector: string; settings: Settings; hash: string; meta: { at: number; by: string | null } | null };
