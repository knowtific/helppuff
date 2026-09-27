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

export type Site = { id: string; name: string; accent: string; avatar: string | null; embed: string };
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

export type Summary = { summary: string; intent: string | null; sentiment: string | null; followUp: string | null };

export type StoredMessage = {
  id: string;
  role: 'user' | 'agent' | 'system';
  type: string;
  text: string | null;
  payload: Record<string, unknown> | null;
  ts: number;
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
