/**
 * What an API key may do. Each `/api/v1` route needs one scope (api/registry.ts);
 * `<resource>:write` includes `<resource>:read`.
 */
export const SCOPES = {
  chat: 'Talk to the assistant as a visitor: start conversations, send messages, close them.',
  'conversations:read': 'Read conversations, their messages, labels and notes, and live chat\'s status.',
  'conversations:write': 'Summarise, label, annotate, take, close and delete conversations, and reply in live chats.',
  'leads:read': 'Read leads (contacts) and export them.',
  'leads:write': 'Create, update and delete leads, and add notes to them.',
  'jobs:read': 'Read jobs, their history, and the pipeline (stages and fields).',
  'jobs:write': 'Create, change, move and delete jobs, and add updates and notes to them.',
  'callbacks:read': 'Read callback requests.',
  'callbacks:write': 'Mark callback requests done or dismissed.',
  'knowledge:read': 'Read the knowledge base: pages, files, facts, search.',
  'knowledge:write': 'Change the knowledge base: crawl, upload, add and remove knowledge, correct facts.',
  'prompt:read': 'Read the prompt, its versions and its tools.',
  'prompt:write': 'Publish and restore prompt versions; add, change, test and remove tools.',
  'settings:read': 'Read the settings and Telegram\'s status.',
  'settings:write': 'Change the settings, labels and Telegram.',
  'webhooks:read': 'Read webhook endpoints and deliveries.',
  'webhooks:write': 'Add, change, test and remove webhook endpoints.',
  'analytics:read': 'Read the overview, usage and version.',
  'team:read': 'Read who can sign in to the dashboard.',
  'team:write': 'Add and remove dashboard accounts, and make sign-in links.',
  'keys:read': 'Read API keys (never their secrets).',
  'keys:write': 'Create and revoke API keys (never with more access than this key).',
  'audit:read': 'Read the audit log.',
} as const;

export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

/** Ready-made sets for the dashboard and the CLI. */
export const SCOPE_PRESETS: Record<'chat' | 'crm' | 'read' | 'full', { label: string; scopes: Scope[] }> = {
  chat: { label: 'Chat only', scopes: ['chat'] },
  crm: { label: 'CRM', scopes: ['conversations:read', 'conversations:write', 'leads:read', 'leads:write', 'jobs:read', 'jobs:write', 'callbacks:read', 'callbacks:write'] },
  read: { label: 'Read-only', scopes: ALL_SCOPES.filter((s) => s.endsWith(':read')) },
  full: { label: 'Full access', scopes: [...ALL_SCOPES] },
};

export const isScope = (value: unknown): value is Scope => typeof value === 'string' && value in SCOPES;

/** Whether `granted` covers `needed`: exactly, or `x:write` for `x:read`. */
export function hasScope(granted: readonly string[], needed: Scope): boolean {
  if (granted.includes(needed)) return true;
  return needed.endsWith(':read') && granted.includes(needed.replace(/:read$/, ':write'));
}
