import type { Scope } from './scopes.js';

/**
 * Every route of the API, in one place. The same handlers answer at
 * `/admin/api` (the dashboard and the CLI) and `/api/v1` (the public API);
 * this registry is what makes a route public:
 *
 *  - `api/auth.ts` refuses an API key on any route not listed here, and checks
 *    the listed `scope` (fail closed);
 *  - `pnpm sync:docs` turns it into `openapi.json` and the wiki's API
 *    reference (curl, request, response, errors for each);
 *  - a test checks that every route the app serves under `/api/v1` is listed,
 *    and every listed route exists.
 *
 * `scope: 'any'` needs any valid key; `null` routes are the dashboard's own
 * (sign-in, setup) and answer 404 on `/api/v1`.
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type Param = { name: string; description: string; required?: boolean; example?: string };

export type Endpoint = {
  method: Method;
  /** Relative to the base URL, Hono style: `/leads/:id`. */
  path: string;
  scope: Scope | 'any' | null;
  tag: string;
  summary: string;
  description?: string;
  query?: Param[];
  /** An example request body (JSON), or `raw` for a binary upload. */
  body?: unknown;
  /** The body's fields, for the reference's table. */
  fields?: Param[];
  raw?: { contentType: string; description: string };
  status?: number;
  /** An example response body; `csv` for a file. */
  response?: unknown;
  /** Response keys that may be null though the example shows a value (for the TypeScript type). */
  nullable?: string[];
  csv?: string;
  /** Errors particular to this route, beyond the common ones. */
  errors?: { status: number; code: string; when: string }[];
};

export const TAGS: { name: string; description: string }[] = [
  { name: 'Account', description: 'Who the key is, and the API description itself.' },
  { name: 'Chat', description: 'Talk to the assistant as a visitor, from your own server: start a conversation, send messages (JSON or streamed), close it.' },
  { name: 'Conversations', description: 'Read, summarise and delete conversations, from the widget and the API alike.' },
  { name: 'Leads', description: 'The people who gave contact details: your CRM. Keyed by email per site.' },
  { name: 'Callbacks', description: 'Visitors who asked to be called back, as tasks.' },
  { name: 'Knowledge', description: 'What the assistant knows: the website it learned, uploaded files, hand-written knowledge and business details.' },
  { name: 'Prompt', description: 'The business-specific instructions, versioned.' },
  { name: 'Settings', description: 'The assistant, widget, lead form, limits and IP lists, as one object.' },
  { name: 'Webhooks', description: 'Endpoints that receive events as signed JSON.' },
  { name: 'Analytics', description: 'Totals, usage and the running version.' },
  { name: 'Team', description: 'Who can sign in to the dashboard.' },
  { name: 'API keys', description: 'Keys for this API.' },
  { name: 'Audit', description: 'What changed, when, and who (or which key) changed it.' },
];

const T = 1760000000000;
const message = (text: string) => ({ id: 'm_mfx2k1', ts: T, role: 'agent', type: 'text', text });
const conversationId = '1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10';
const leadId = 'lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90';
const leadRow = {
  id: leadId,
  site_id: 'acme',
  conversation_id: conversationId,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '0400 111 222',
  fields: '{"company":"Analytical Engines"}',
  source: 'form',
  status: 'new',
  notes: null,
  created_at: T,
  updated_at: T,
};
const callback = {
  id: 'cb_mfx2k1a9b3c',
  conversationId,
  leadId,
  name: 'Ada Lovelace',
  phone: '0400 111 222',
  email: 'ada@example.com',
  reason: 'A quote for two rooms',
  status: 'open',
  note: null,
  requestedAt: T,
  closedAt: null,
  closedBy: null,
  pageUrl: 'https://acme.example/pricing',
};
const webhook = {
  id: 'wh_3c2b1a',
  url: 'https://hooks.example.com/helppuff',
  description: 'CRM sync',
  events: ['lead.captured', 'callback.requested'],
  enabled: true,
  secret: 'whsec_0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4',
  lastStatus: 'ok',
  lastError: null,
  lastAt: T,
  createdAt: T,
};
const keyView = {
  id: 'k7m3p9q2r4s8',
  name: 'Website backend',
  prefix: 'hp_live_k7m3p9q2r4s8',
  site: 'acme',
  scopes: ['chat', 'leads:read'],
  allowIps: [],
  ratePerMinute: 120,
  createdBy: 'owner@acme.example',
  createdAt: T,
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
};
const usage = { day: '2025-10-09', neurons: 1240.5, messages: 64, budget: 9000, freeAllocation: 10000, messagesLeft: 400, state: 'ok' };
const settings = {
  botName: 'Sam',
  businessName: 'Acme Plumbing',
  welcomeMessage: 'Hi, I\'m Sam. How can I help?',
  starterQuestions: ['How much is a blocked drain?'],
  accent: '#5B5BF7',
  position: 'bottom-right',
  launcherIcon: 'chat',
  leads: { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text', required: true }] },
  assistant: { model: '@cf/zai-org/glm-4.7-flash', locale: 'en-AU', timezone: 'Australia/Sydney', rerank: true, reasoning: 'medium' },
  behaviour: { goal: 'callbacks', tone: 'friendly', length: 'short', prices: 'share' },
  crawl: { schedule: 'weekly', include: [], exclude: [], renderJs: 'auto' },
  security: { limits: { messagesPerSitePerDay: 500, messagesPerIpPerMinute: 10 }, signIn: { attemptsPerIp: 10, attemptsPerAccount: 5, windowMinutes: 15, captcha: true }, allowIps: [], blockIps: [], sessionTtlHours: 24 },
};
const siteQuery: Param = { name: 'site', description: 'The site (a key always uses its own).', example: 'acme' };

export const ENDPOINTS: Endpoint[] = [
  // ------------------------------------------------------------------ account
  {
    method: 'GET',
    path: '/me',
    scope: 'any',
    tag: 'Account',
    summary: 'Who is calling',
    description: 'The key (or account) and the site it works on. A cheap way to check a key.',
    response: {
      admin: { email: 'key:k7m3p9q2r4s8', owner: false, via: 'key' },
      key: { id: 'k7m3p9q2r4s8', name: 'Website backend', scopes: ['chat', 'leads:read'], site: 'acme', expiresAt: null },
      sites: [{ id: 'acme', name: 'Acme Plumbing', accent: '#5B5BF7', avatar: null, embed: '<script src="https://helppuff.example.workers.dev/loader.js" data-site="acme" async></script>', connector: 'workers-ai', knowledge: true, website: 'https://acme.example', production: { turnstile: true, hostnames: ['acme.example', 'helppuff.example.workers.dev'], dailyCap: 500 } }],
      summaries: true,
    },
  },
  // --------------------------------------------------------------------- chat
  {
    method: 'POST',
    path: '/conversations',
    scope: 'chat',
    tag: 'Chat',
    summary: 'Start a conversation',
    description:
      'Starts a conversation as a visitor would, with the same assistant, knowledge, limits and recording as the widget. With `message`, the answer has the assistant\'s reply; send `Accept: text/event-stream` to stream it: `delta` events with `{ text }` as it is written, then `done` with this body (or `error` with the error), when the AI backend streams; otherwise the answer is plain JSON. `contact` becomes (or joins, by email) a lead. Counts against the site\'s daily cap.',
    fields: [
      { name: 'message', description: 'The visitor\'s first message (up to 4000 characters). Without one, the answer is the greeting, if any.' },
      { name: 'contact', description: 'What you know about the visitor: `name`, `email`, `phone` and any other fields (up to 20). Becomes, or joins by email, a lead.' },
      { name: 'context', description: '`pageUrl`, `pageTitle`, `referrer`, `locale`, `timezone`, `utm`: where the visitor is. The assistant may use it.' },
      { name: 'externalId', description: 'Your own id for this conversation or visitor (up to 128 characters), to find it again.' },
      { name: 'metadata', description: 'Up to 20 string values you want back later. Never shown to the assistant.' },
      { name: 'site', description: 'Only with the admin key and several sites; a key uses its own.' },
    ],
    body: {
      message: 'How much is a blocked drain?',
      contact: { name: 'Ada Lovelace', email: 'ada@example.com' },
      context: { pageUrl: 'https://app.example.com/help', locale: 'en-AU' },
      externalId: 'user-123',
      metadata: { plan: 'pro' },
    },
    status: 201,
    nullable: ['externalId', 'metadata'],
    response: {
      id: conversationId,
      messages: [message('A blocked drain is usually $180–$250, including the first hour. Would you like a callback to book it in?')],
      externalId: 'user-123',
      metadata: { plan: 'pro' },
    },
    errors: [
      { status: 429, code: 'quota_exceeded', when: 'The site used its daily cap (`security.limits.messagesPerSitePerDay`).' },
      { status: 502, code: 'connector_error', when: 'The AI backend failed; try again.' },
    ],
  },
  {
    method: 'POST',
    path: '/conversations/:id/messages',
    scope: 'chat',
    tag: 'Chat',
    summary: 'Send a message',
    description:
      'The visitor\'s next message: `{ "text" }`, or `{ "action": { id, value, label? } }` to answer options, a card button or a form (a form\'s answers are a JSON object string in `value`; forms are honoured only when this conversation was shown them). Only conversations started over the API can be continued here. `Accept: text/event-stream` streams the reply.',
    fields: [
      { name: 'text', description: 'What the visitor typed (up to `maxMessageLength`). Or, instead:' },
      { name: 'action', description: '`{ id, value, label? }`: an answer to options, a card button or a form. `id` is the message (or action) id; a form\'s answers are a JSON object string in `value`.' },
    ],
    body: { text: 'Can someone come tomorrow morning?' },
    response: { id: conversationId, messages: [message('Tomorrow morning works. What is the best number to reach you on?')] },
    errors: [
      { status: 400, code: 'bad_request', when: 'Empty or too long (`maxMessageLength`), or a form this conversation was not shown.' },
      { status: 404, code: 'not_found', when: 'No conversation started over the API with this id.' },
      { status: 429, code: 'quota_exceeded', when: 'The conversation reached `messagesPerSession`, or the site its daily cap.' },
    ],
  },
  {
    method: 'POST',
    path: '/conversations/:id/end',
    scope: 'chat',
    tag: 'Chat',
    summary: 'Close a conversation',
    description: 'Ends it for the AI backend and sends `conversation.ended` (once). It stays readable.',
    response: { id: conversationId, ended: true },
  },
  // ------------------------------------------------------------ conversations
  {
    method: 'GET',
    path: '/conversations',
    scope: 'conversations:read',
    tag: 'Conversations',
    summary: 'List conversations',
    description: 'Newest activity first, 30 at a time. Pass `next` from the answer as `before` for the next page.',
    query: [
      { name: 'q', description: 'Search messages, summaries and lead details (up to 48 characters).', example: 'drain' },
      { name: 'filter', description: '`all`, `leads` (with a lead), `unsummarized` or `callbacks` (with an open callback request).', example: 'leads' },
      { name: 'externalId', description: 'Conversations started over the API with this `externalId`.', example: 'user-123' },
      { name: 'before', description: 'Cursor: the `next` of the previous page.' },
      { name: 'limit', description: '1–100, default 30.', example: '30' },
      siteQuery,
    ],
    response: {
      items: [
        {
          id: conversationId,
          site: 'acme',
          startedAt: T,
          lastAt: T + 120000,
          pageUrl: 'https://acme.example/pricing',
          country: 'AU',
          firstMessage: 'How much is a blocked drain?',
          messageCount: 6,
          summary: 'Ada asked about a blocked drain and booked a callback.',
          intent: 'Pricing question',
          leadName: 'Ada Lovelace',
          leadEmail: 'ada@example.com',
          leadPhone: '0400 111 222',
          leadStatus: 'new',
          callback: 'open',
        },
      ],
      next: null,
    },
  },
  {
    method: 'GET',
    path: '/conversations/:id',
    scope: 'conversations:read',
    tag: 'Conversations',
    summary: 'Get a conversation',
    description: 'The conversation, its lead, its callback requests and every message both ways.',
    response: {
      conversation: {
        id: conversationId,
        site_id: 'acme',
        started_at: T,
        last_at: T + 120000,
        page_url: 'https://acme.example/pricing',
        page_title: 'Pricing',
        referrer: null,
        utm: null,
        locale: 'en-AU',
        country: 'AU',
        first_message: 'How much is a blocked drain?',
        message_count: 2,
        lead_id: leadId,
        summary: null,
        intent: null,
        summarized_at: null,
        completed_at: null,
        ended_at: null,
        channel: 'widget',
      },
      lead: leadRow,
      callbacks: [callback],
      messages: [
        { id: `${conversationId}:u1`, role: 'user', type: 'text', text: 'How much is a blocked drain?', payload: null, ts: T, feedback: null },
        { id: `${conversationId}:m_mfx2k1`, role: 'agent', type: 'text', text: 'Usually $180–$250.', payload: {}, ts: T + 1, feedback: 1 },
      ],
    },
  },
  {
    method: 'POST',
    path: '/conversations/:id/summary',
    scope: 'conversations:write',
    tag: 'Conversations',
    summary: 'Summarise a conversation',
    description: 'Writes (or rewrites) its AI summary and labels, and sends `conversation.summarized`. Uses Workers AI (a few neurons). Conversations are also summarised automatically 5 minutes after they go quiet.',
    response: {
      summary: 'Ada asked about a blocked drain and booked a callback for tomorrow morning.',
      intent: 'Blocked drain',
      sentiment: 'positive',
      leadQuality: 'hot',
      outcome: 'callback_requested',
      topics: ['drains', 'pricing'],
      unanswered: [],
      followUp: 'Call Ada tomorrow before 10am.',
      lead: { name: 'Ada Lovelace', phone: '0400 111 222' },
    },
  },
  {
    method: 'DELETE',
    path: '/conversations/:id',
    scope: 'conversations:write',
    tag: 'Conversations',
    summary: 'Delete a conversation',
    description: 'Deletes it with its messages and callback requests. The lead it produced stays (delete it with `DELETE /leads/:id`).',
    response: { id: conversationId, deleted: true },
  },
  // -------------------------------------------------------------------- leads
  {
    method: 'GET',
    path: '/leads',
    scope: 'leads:read',
    tag: 'Leads',
    summary: 'List leads',
    description: 'Most recently updated first, up to 500, with counts by status.',
    query: [
      { name: 'q', description: 'Search name, email, phone and notes.', example: 'ada' },
      { name: 'status', description: '`new`, `contacted`, `qualified`, `won` or `lost`.', example: 'new' },
      siteQuery,
    ],
    response: {
      items: [
        {
          id: leadId,
          site: 'acme',
          conversationId,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          phone: '0400 111 222',
          fields: '{"company":"Analytical Engines"}',
          source: 'form',
          status: 'new',
          notes: null,
          createdAt: T,
          updatedAt: T,
          conversations: 2,
          lastConversationId: conversationId,
          openCallbacks: 1,
        },
      ],
      counts: { new: 1 },
    },
  },
  {
    method: 'POST',
    path: '/leads',
    scope: 'leads:write',
    tag: 'Leads',
    summary: 'Create a lead',
    description: 'Adds a contact from elsewhere (your CRM, an import). Needs a name, an email or a phone. One lead per email per site: a second answers 409 with the first one\'s id. Sends `lead.captured` with `source: "api"`.',
    fields: [
      { name: 'name', description: 'Up to 200 characters.' },
      { name: 'email', description: 'One lead per email per site.' },
      { name: 'phone', description: 'Up to 40 characters.' },
      { name: 'fields', description: 'Any other details: up to 20 string values.' },
      { name: 'status', description: '`new` (default), `contacted`, `qualified`, `won` or `lost`.' },
      { name: 'notes', description: 'Up to 5000 characters.' },
    ],
    body: { name: 'Grace Hopper', email: 'grace@example.com', phone: '0400 333 444', fields: { company: 'Navy' }, status: 'new', notes: 'Met at the expo.' },
    status: 201,
    response: { ...leadRow, id: 'lead_7a1c…', name: 'Grace Hopper', email: 'grace@example.com', phone: '0400 333 444', fields: '{"company":"Navy"}', source: 'api', conversation_id: null, notes: 'Met at the expo.' },
    errors: [{ status: 409, code: 'conflict', when: 'A lead with this email exists (its id is in the message).' }],
  },
  {
    method: 'GET',
    path: '/leads/:id',
    scope: 'leads:read',
    tag: 'Leads',
    summary: 'Get a lead',
    description: 'The lead with the conversations linked to it.',
    response: { ...leadRow, conversations: [{ id: conversationId, startedAt: T, lastAt: T + 120000, pageUrl: 'https://acme.example/pricing', firstMessage: 'How much is a blocked drain?', messageCount: 6, summary: null, channel: 'widget' }] },
  },
  {
    method: 'PATCH',
    path: '/leads/:id',
    scope: 'leads:write',
    tag: 'Leads',
    summary: 'Update a lead',
    description: 'Changes the status, notes or name. Sends `lead.updated`.',
    fields: [
      { name: 'status', description: '`new`, `contacted`, `qualified`, `won` or `lost`.' },
      { name: 'notes', description: 'Replaces the notes (up to 5000 characters).' },
      { name: 'name', description: 'Up to 200 characters.' },
    ],
    body: { status: 'contacted', notes: 'Called, booked for Tuesday.' },
    response: { ...leadRow, status: 'contacted', notes: 'Called, booked for Tuesday.' },
  },
  {
    method: 'DELETE',
    path: '/leads/:id',
    scope: 'leads:write',
    tag: 'Leads',
    summary: 'Delete a lead',
    description: 'Deletes the lead. With `?erase=conversations`, also every conversation linked to it, with their messages and callback requests: for a person who asks to be forgotten.',
    query: [{ name: 'erase', description: '`conversations` to delete the linked conversations too.', example: 'conversations' }],
    response: { id: leadId, deleted: true, conversationsDeleted: 2 },
  },
  {
    method: 'GET',
    path: '/leads.csv',
    scope: 'leads:read',
    tag: 'Leads',
    summary: 'Export leads as CSV',
    description: 'Every lead, newest first. Cells that could run as a spreadsheet formula are prefixed with `\'`.',
    query: [siteQuery],
    csv: 'created,name,email,phone,status,source,notes,site,conversation\n2025-10-09T08:53:20.000Z,Ada Lovelace,ada@example.com,0400 111 222,new,form,,acme,1b0f6a52-…',
  },
  // ---------------------------------------------------------------- callbacks
  {
    method: 'GET',
    path: '/callbacks',
    scope: 'callbacks:read',
    tag: 'Callbacks',
    summary: 'List callback requests',
    description: 'Open ones oldest first (the queue); others most recent first. Up to 500, with counts by status.',
    query: [{ name: 'status', description: '`open` (default), `done`, `dismissed` or `all`.', example: 'open' }, siteQuery],
    response: { items: [callback], counts: { open: 1, done: 4, dismissed: 0 } },
  },
  {
    method: 'PATCH',
    path: '/callbacks/:id',
    scope: 'callbacks:write',
    tag: 'Callbacks',
    summary: 'Update a callback request',
    description: 'Mark it done or dismissed (or reopen it), or change its note. Sends `callback.updated`.',
    fields: [
      { name: 'status', description: '`open`, `done` or `dismissed`.' },
      { name: 'note', description: 'What happened (up to 2000 characters); empty clears it.' },
    ],
    body: { status: 'done', note: 'Booked for Tuesday 9am.' },
    response: { ...callback, status: 'done', note: 'Booked for Tuesday 9am.', closedAt: T + 3600000, closedBy: 'key:k7m3p9q2r4s8' },
  },
  // ---------------------------------------------------------------- analytics
  {
    method: 'GET',
    path: '/overview',
    scope: 'analytics:read',
    tag: 'Analytics',
    summary: 'Totals over a period',
    description: 'Conversations, messages, leads and conversion over `days`, against the period before, a day-by-day series, top pages, countries, recent questions and leads.',
    query: [
      { name: 'days', description: '1–365, default 30.', example: '30' },
      { name: 'tz', description: 'Minutes to add to UTC for day boundaries (e.g. 600 for Sydney).', example: '600' },
      siteQuery,
    ],
    response: {
      range: { days: 30, since: T - 30 * 86400000 },
      openCallbacks: 1,
      totals: { conversations: 120, messages: 830, leads: 31, conversion: 0.26, avgMessages: 6.9 },
      previous: { conversations: 98, messages: 640, leads: 22, conversion: 0.22, avgMessages: 6.5 },
      series: [{ date: '2025-10-09', conversations: 5, leads: 1 }],
      topPages: [{ url: 'https://acme.example/pricing', count: 40 }],
      countries: [{ country: 'AU', count: 110 }],
      recentQuestions: [{ id: conversationId, text: 'How much is a blocked drain?', at: T }],
      recentLeads: [{ id: leadId, name: 'Ada Lovelace', email: 'ada@example.com', phone: '0400 111 222', status: 'new', at: T, conversationId }],
    },
  },
  {
    method: 'GET',
    path: '/usage',
    scope: 'analytics:read',
    tag: 'Analytics',
    summary: 'AI usage by day',
    description: 'Today\'s use of the daily budget (Workers AI neurons) and messages, and the last days.',
    query: [siteQuery],
    response: { site: 'acme', today: usage, days: [{ day: '2025-10-08', neurons: 3100, messages: 150 }] },
  },
  {
    method: 'GET',
    path: '/version',
    scope: 'analytics:read',
    tag: 'Analytics',
    summary: 'Running version',
    description: 'The release running, the latest one, and the database schema.',
    response: { current: '0.2.0', latest: '0.3.0', upgradeAvailable: true, schema: { applied: 9, expected: 9 }, command: 'npx @knowtific/helppuff@latest upgrade', releaseNotes: 'https://github.com/knowtific/helppuff/releases' },
  },
  {
    method: 'GET',
    path: '/install-check',
    scope: 'settings:read',
    tag: 'Analytics',
    summary: 'Check the widget is on the website',
    description: 'Fetches the website and looks for the embed snippet.',
    query: [{ name: 'url', description: 'A page to check (defaults to the website).', example: 'https://acme.example/' }, siteQuery],
    response: { url: 'https://acme.example/', reachable: true, installed: true, reason: null },
  },
  // ---------------------------------------------------------------- knowledge
  {
    method: 'GET',
    path: '/knowledge/status',
    scope: 'knowledge:read',
    tag: 'Knowledge',
    summary: 'Knowledge base status',
    description: 'The latest crawl, page counts, chunks and today\'s AI usage.',
    query: [siteQuery],
    response: {
      site: 'acme',
      connector: 'workers-ai',
      browserRendering: false,
      workflow: true,
      schedule: 'weekly',
      run: { id: 'run_1', status: 'done', trigger: 'dashboard', total: 42, done: 42, failed: 0, chunks: 310, error: null, startedAt: T, finishedAt: T + 90000 },
      pages: { indexed: 40, unchanged: 2 },
      chunks: 310,
      lastIndexedAt: T + 90000,
      usage,
    },
  },
  {
    method: 'POST',
    path: '/knowledge/discover',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Find the website pages',
    description: 'Reads robots.txt and the sitemaps, and suggests which pages to learn.',
    body: {},
    response: { site: 'acme', origin: 'https://acme.example', reachable: true, sitemaps: ['https://acme.example/sitemap.xml'], warnings: [], urls: [{ url: 'https://acme.example/pricing', category: 'pricing', suggested: true, status: 'indexed', title: 'Pricing', error: null, selected: true }] },
  },
  {
    method: 'POST',
    path: '/knowledge/crawl',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Learn the website',
    description: 'Crawls the given pages (or the selected ones) in the background. Follow progress with `GET /knowledge/status`.',
    fields: [
      { name: 'urls', description: 'The pages to learn. Without it, the selected pages.' },
      { name: 'include', description: 'Glob patterns of pages to add, e.g. `["/services/**"]`.' },
      { name: 'exclude', description: 'Glob patterns of pages to leave out.' },
    ],
    body: { urls: ['https://acme.example/pricing', 'https://acme.example/services'] },
    status: 202,
    response: { site: 'acme', runId: 'run_2', total: 2 },
  },
  {
    method: 'POST',
    path: '/knowledge/runs/:id/cancel',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Cancel a crawl',
    response: { cancelled: true },
  },
  {
    method: 'GET',
    path: '/knowledge/pages',
    scope: 'knowledge:read',
    tag: 'Knowledge',
    summary: 'List learned pages',
    query: [{ name: 'status', description: '`discovered`, `indexed`, `unchanged`, `failed`…', example: 'indexed' }, siteQuery],
    response: { site: 'acme', pages: [{ id: 'pg_1', url: 'https://acme.example/pricing', finalUrl: 'https://acme.example/pricing', title: 'Pricing', category: 'pricing', status: 'indexed', httpStatus: 200, error: null, selected: 1, source: 'crawl', crawledAt: T, chunks: 6 }] },
  },
  {
    method: 'GET',
    path: '/knowledge/pages/:id/chunks',
    scope: 'knowledge:read',
    tag: 'Knowledge',
    summary: 'Chunks of a page',
    description: 'The passages the assistant searches, as stored.',
    query: [siteQuery],
    response: { chunks: [{ id: 'ch_1', headingPath: 'Pricing › Drains', ordinal: 0, content: 'Blocked drains: $180–$250 including the first hour.', tokens: 14 }] },
  },
  {
    method: 'POST',
    path: '/knowledge/search',
    scope: 'knowledge:read',
    tag: 'Knowledge',
    summary: 'Search the knowledge base',
    description: 'What the assistant would find for a question (hybrid search, then the reranker). A few neurons.',
    fields: [
      { name: 'query', description: 'The question (up to 1000 characters).', required: true },
      { name: 'k', description: 'How many passages to return.' },
      { name: 'rerank', description: '`false` to skip the reranker.' },
    ],
    body: { query: 'blocked drain price', k: 3 },
    response: {
      site: 'acme',
      query: 'blocked drain price',
      neurons: 2.1,
      chunks: [{ id: 'ch_1', pageId: 'pg_1', url: 'https://acme.example/pricing', title: 'Pricing', headingPath: 'Pricing › Drains', category: 'pricing', content: 'Blocked drains: $180–$250…', ordinal: 0, score: 0.91 }],
      trace: { vector: 8, keyword: 5, fused: 10, reranked: true, threshold: 0.2, errors: [], ms: { embed: 40, vector: 30, keyword: 6, rerank: 120 } },
    },
  },
  {
    method: 'POST',
    path: '/knowledge/suggest-questions',
    scope: 'knowledge:read',
    tag: 'Knowledge',
    summary: 'Suggest starter questions',
    description: 'Four questions a customer might ask, written from what the site taught the assistant.',
    body: {},
    response: { questions: ['How much is a blocked drain?', 'Do you do emergency callouts?', 'Which suburbs do you cover?', 'Can I book online?'], source: 'model' },
  },
  {
    method: 'GET',
    path: '/knowledge/manual',
    scope: 'knowledge:read',
    tag: 'Knowledge',
    summary: 'List hand-written knowledge',
    query: [siteQuery],
    response: { entries: [{ id: 'holiday-hours', title: 'Holiday hours', content: 'Closed 25–26 December.', updatedAt: T }] },
  },
  {
    method: 'POST',
    path: '/knowledge/manual',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Add or replace hand-written knowledge',
    description: 'Searchable at once. The same `id` replaces an entry.',
    fields: [
      { name: 'title', description: 'Up to 200 characters.', required: true },
      { name: 'content', description: 'Markdown or plain text, up to 100,000 characters.', required: true },
      { name: 'id', description: 'Lowercase letters, digits and `-`. The same id replaces an entry.' },
    ],
    body: { id: 'holiday-hours', title: 'Holiday hours', content: 'We are closed on 25 and 26 December.' },
    response: { id: 'holiday-hours', chunks: 1 },
  },
  {
    method: 'DELETE',
    path: '/knowledge/manual/:id',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Remove hand-written knowledge',
    query: [siteQuery],
    response: { deleted: true },
  },
  {
    method: 'GET',
    path: '/knowledge/files',
    scope: 'knowledge:read',
    tag: 'Knowledge',
    summary: 'List uploaded files',
    query: [siteQuery],
    response: { files: [{ id: '0b8f…', name: 'price-list.pdf', kind: 'pdf', size: 182044, status: 'indexed', error: null, chunks: 12, truncated: 0, createdAt: T, updatedAt: T }] },
  },
  {
    method: 'POST',
    path: '/knowledge/files',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Upload a file',
    description: 'The raw bytes as the body, the file name as `?name=`. PDF, Word (.docx), Markdown or text, up to 10 MB. Read and learned in the background.',
    query: [{ name: 'name', description: 'The file name, with its extension.', required: true, example: 'price-list.pdf' }, siteQuery],
    raw: { contentType: 'application/octet-stream', description: 'The file\'s bytes.' },
    status: 202,
    response: { id: '0b8f…', name: 'price-list.pdf', kind: 'pdf', size: 182044, status: 'queued' },
  },
  {
    method: 'DELETE',
    path: '/knowledge/files/:id',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Remove an uploaded file',
    description: 'And everything learned from it.',
    query: [siteQuery],
    response: { deleted: true, chunks: 12 },
  },
  {
    method: 'GET',
    path: '/knowledge/facts',
    scope: 'knowledge:read',
    tag: 'Knowledge',
    summary: 'Business details',
    description: 'Phone, email, address, hours, service areas: read from the site (`crawl`) or set by you (`owner`).',
    query: [siteQuery],
    response: { facts: [{ key: 'phone', value: '1300 000 000', source: 'owner', sourceUrl: 'owner' }] },
  },
  {
    method: 'PUT',
    path: '/knowledge/facts',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Set business details',
    description: 'Yours are never overwritten by a crawl. An empty value removes one. Re-indexed at once.',
    fields: [{ name: 'facts', description: 'Keys `name`, `phone`, `email`, `address`, `hours`, `serviceAreas` and others; an empty value removes one.', required: true }],
    body: { facts: { phone: '1300 000 000', hours: 'Mon–Fri 8am–5pm' } },
    response: { facts: [{ key: 'phone', value: '1300 000 000' }, { key: 'hours', value: 'Mon–Fri 8am–5pm' }] },
  },
  {
    method: 'POST',
    path: '/knowledge/facts/detect',
    scope: 'knowledge:write',
    tag: 'Knowledge',
    summary: 'Read business details from the site',
    body: {},
    response: { found: 4, facts: [{ key: 'phone', value: '1300 000 000', source: 'site' }] },
  },
  // ------------------------------------------------------------------- prompt
  {
    method: 'GET',
    path: '/prompt',
    scope: 'prompt:read',
    tag: 'Prompt',
    summary: 'The prompt and its versions',
    description: 'The business-specific instructions, everything HelpPuff adds around them (`builtIn`), lines that repeat a setting (`overlaps`), and the version history.',
    query: [siteQuery],
    response: { site: 'acme', connector: 'workers-ai', builtIn: 'You are the website assistant for Acme…', overlaps: [], editable: true, reason: null, text: 'We service the Inner West only.', hash: '9f2c…', version: 3, meta: { version: 3, hash: '9f2c…', at: T, by: 'owner@acme.example', source: 'dashboard' }, limit: 16000, versions: [{ version: 3, hash: '9f2c…', source: 'dashboard', author: 'owner@acme.example', note: null, restoredFrom: null, createdAt: T, chars: 31 }] },
  },
  {
    method: 'GET',
    path: '/prompt/versions/:version',
    scope: 'prompt:read',
    tag: 'Prompt',
    summary: 'One prompt version',
    query: [siteQuery],
    response: { version: 2, hash: '1d4e…', source: 'cli', author: 'cli', note: null, restoredFrom: null, createdAt: T, chars: 38, text: 'We service the Inner West and the CBD.' },
  },
  {
    method: 'POST',
    path: '/prompt',
    scope: 'prompt:write',
    tag: 'Prompt',
    summary: 'Publish a prompt version',
    description: 'Live within a minute. `baseVersion` is the version you edited: if someone published since, the answer is 409 with theirs.',
    fields: [
      { name: 'text', description: 'The whole prompt (up to 16,000 characters).', required: true },
      { name: 'baseVersion', description: 'The version you edited (from `GET /prompt`).', required: true },
      { name: 'note', description: 'What changed, for the history.' },
    ],
    body: { text: 'We service the Inner West only. Never quote for gas work.', baseVersion: 3, note: 'No gas quotes' },
    response: { status: 'published', version: 4, hash: 'a1b2…' },
    errors: [{ status: 409, code: 'bad_request', when: 'Someone published a newer version (it is in the body).' }],
  },
  {
    method: 'POST',
    path: '/prompt/restore',
    scope: 'prompt:write',
    tag: 'Prompt',
    summary: 'Restore a prompt version',
    description: 'Publishes an old version\'s text as a new version.',
    body: { version: 2, baseVersion: 4 },
    response: { status: 'published', version: 5, hash: 'c3d4…' },
  },
  // ----------------------------------------------------------------- settings
  {
    method: 'GET',
    path: '/settings',
    scope: 'settings:read',
    tag: 'Settings',
    summary: 'The settings',
    description: 'The assistant, widget, lead form, crawl and security settings as one object, with a hash of it.',
    query: [siteQuery],
    response: {
      site: 'acme',
      connector: 'workers-ai',
      settings,
      hash: '5c1e…',
      meta: null,
      captcha: false,
    },
  },
  {
    method: 'PUT',
    path: '/settings',
    scope: 'settings:write',
    tag: 'Settings',
    summary: 'Change settings',
    description: 'A partial update: send only the sections to change (nested objects merge one level deep). Live within a minute. Run `helppuff config pull` afterwards if you keep helppuff.json in git.',
    fields: [{ name: 'settings', description: 'Any sections of the object `GET /settings` returns: `botName`, `welcomeMessage`, `leads`, `assistant`, `behaviour`, `crawl`, `security` …', required: true }],
    body: { settings: { welcomeMessage: 'Hi! Ask me anything about our plumbing services.', security: { limits: { messagesPerSitePerDay: 800 } } } },
    response: { site: 'acme', connector: 'workers-ai', settings: { ...settings, welcomeMessage: 'Hi! Ask me anything about our plumbing services.' }, hash: '7d2a…', meta: { at: T, by: 'key:k7m3p9q2r4s8', hash: '7d2a…' }, captcha: false },
  },
  // ----------------------------------------------------------------- webhooks
  {
    method: 'GET',
    path: '/webhooks',
    scope: 'webhooks:read',
    tag: 'Webhooks',
    summary: 'List webhook endpoints',
    description: 'With every event type there is to subscribe to.',
    query: [siteQuery],
    response: { webhooks: [webhook], events: [{ type: 'lead.captured', description: 'Contact details arrived…' }] },
  },
  {
    method: 'POST',
    path: '/webhooks',
    scope: 'webhooks:write',
    tag: 'Webhooks',
    summary: 'Add a webhook endpoint',
    description: 'An https URL and the events it wants (`["*"]` or absent: all). Deliveries are signed with the returned `secret`. Up to 10 per site.',
    fields: [
      { name: 'url', description: 'An https URL.', required: true },
      { name: 'events', description: 'Event types (`GET /webhooks` lists them), or `["*"]` for all (the default).' },
      { name: 'description', description: 'Up to 200 characters.' },
    ],
    body: { url: 'https://hooks.example.com/helppuff', events: ['lead.captured', 'callback.requested'], description: 'CRM sync' },
    status: 201,
    response: webhook,
  },
  {
    method: 'PATCH',
    path: '/webhooks/:id',
    scope: 'webhooks:write',
    tag: 'Webhooks',
    summary: 'Change a webhook endpoint',
    description: 'Any of `url`, `events`, `enabled`, `description`; `rotateSecret: true` makes a new signing secret.',
    body: { enabled: false },
    response: { ...webhook, enabled: false },
  },
  {
    method: 'DELETE',
    path: '/webhooks/:id',
    scope: 'webhooks:write',
    tag: 'Webhooks',
    summary: 'Remove a webhook endpoint',
    query: [siteQuery],
    response: { deleted: true },
  },
  {
    method: 'POST',
    path: '/webhooks/:id/test',
    scope: 'webhooks:write',
    tag: 'Webhooks',
    summary: 'Send a test event',
    description: 'Delivers a signed `test.ping` now and says what came back.',
    body: {},
    response: { ok: true, status: 200, error: null, attempts: 1, durationMs: 182, retryable: false, eventId: 'evt_4f3e2d1c' },
  },
  {
    method: 'GET',
    path: '/webhooks/:id/deliveries',
    scope: 'webhooks:read',
    tag: 'Webhooks',
    summary: 'Recent deliveries',
    description: 'The last 50 attempts for an endpoint.',
    query: [siteQuery],
    response: { deliveries: [{ id: 'd_1', eventId: 'evt_4f3e2d1c', event: 'lead.captured', ok: true, status: 200, error: null, attempts: 1, durationMs: 182, at: T }] },
  },
  // --------------------------------------------------------------------- team
  {
    method: 'GET',
    path: '/admins',
    scope: 'team:read',
    tag: 'Team',
    summary: 'List dashboard accounts',
    response: { me: 'key:k7m3p9q2r4s8', owner: 'owner@acme.example', admins: [{ email: 'sam@acme.example', name: 'Sam', createdAt: T, lastLoginAt: T }] },
  },
  {
    method: 'POST',
    path: '/admins',
    scope: 'team:write',
    tag: 'Team',
    summary: 'Add a dashboard account',
    description: 'With a `password` (10+ characters) they can sign in at once; without one, the answer has a one-time sign-in link (7 days) to send them. `team:write` can give dashboard access: treat it like full access.',
    fields: [
      { name: 'email', description: 'Their email address.', required: true },
      { name: 'name', description: 'Up to 100 characters.' },
      { name: 'password', description: '10+ characters. Without it, the answer has a sign-in link.' },
    ],
    body: { email: 'sam@acme.example', name: 'Sam' },
    status: 201,
    response: { email: 'sam@acme.example', name: 'Sam', createdAt: T, signInLink: 'https://helppuff.example.workers.dev/admin/#/signin/9xQ…', signInLinkExpiresAt: T + 7 * 86400000 },
    errors: [{ status: 409, code: 'conflict', when: 'The email can already sign in.' }],
  },
  {
    method: 'DELETE',
    path: '/admins/:email',
    scope: 'team:write',
    tag: 'Team',
    summary: 'Remove a dashboard account',
    description: 'They are signed out at their next request. The owner (set in the Worker\'s config) cannot be removed here.',
    response: { email: 'sam@acme.example', deleted: true },
  },
  {
    method: 'POST',
    path: '/admins/:email/sign-in-link',
    scope: 'team:write',
    tag: 'Team',
    summary: 'Make a one-time sign-in link',
    description: 'Valid 15 minutes, once. The way back in after a lost password.',
    status: 201,
    response: { email: 'sam@acme.example', url: 'https://helppuff.example.workers.dev/admin/#/signin/7bR…', expiresAt: T + 900000 },
  },
  // --------------------------------------------------------------------- keys
  {
    method: 'GET',
    path: '/keys',
    scope: 'keys:read',
    tag: 'API keys',
    summary: 'List API keys',
    description: 'Never their secrets. With the scopes and presets there are.',
    query: [siteQuery],
    response: { keys: [keyView], scopes: [{ scope: 'chat', description: 'Talk to the assistant as a visitor…' }], presets: [{ id: 'chat', label: 'Chat only', scopes: ['chat'] }] },
  },
  {
    method: 'POST',
    path: '/keys',
    scope: 'keys:write',
    tag: 'API keys',
    summary: 'Create an API key',
    description: 'The full key is in this answer only: store it in your secrets manager. A key cannot create a key with scopes it does not have.',
    fields: [
      { name: 'name', description: 'What the key is for.', required: true },
      { name: 'preset', description: '`chat`, `crm`, `read` or `full`. Or, instead:' },
      { name: 'scopes', description: 'A list of scopes (see the API page).' },
      { name: 'expiresInDays', description: '1–3650; absent or null: never.' },
      { name: 'allowIps', description: 'IP addresses or CIDR ranges it may be used from.' },
      { name: 'ratePerMinute', description: 'Requests a minute (default 120).' },
    ],
    body: { name: 'Website backend', preset: 'chat', expiresInDays: 365 },
    status: 201,
    response: { key: 'hp_live_k7m3p9q2r4s8_Zx1…', ...keyView, scopes: ['chat'], expiresAt: T + 365 * 86400000 },
    errors: [{ status: 403, code: 'forbidden', when: 'The calling key would hand out scopes it does not have.' }],
  },
  {
    method: 'DELETE',
    path: '/keys/:id',
    scope: 'keys:write',
    tag: 'API keys',
    summary: 'Revoke an API key',
    description: 'Refused everywhere within 30 seconds. `:id` is the key\'s id or prefix.',
    query: [siteQuery],
    response: { ...keyView, revokedAt: T + 60000, revoked: true },
  },
  // -------------------------------------------------------------------- audit
  {
    method: 'GET',
    path: '/audit',
    scope: 'audit:read',
    tag: 'Audit',
    summary: 'Audit log',
    description: 'Every change made through the API or the dashboard, newest first, kept 90 days. Pass `next` as `before` for the next page.',
    query: [{ name: 'before', description: 'Cursor: the `next` of the previous page.' }, { name: 'limit', description: '1–200, default 50.', example: '50' }],
    response: { items: [{ id: 'au_1', at: T, actor: 'key:k7m3p9q2r4s8', action: 'PATCH /leads/:id', target: leadId, site: 'acme', status: 200 }], next: null },
  },
  // ---------------------------------------------------- the dashboard's own
  ...(['POST /login', 'POST /logout', 'GET /login/options', 'POST /links', 'GET /setup', 'POST /setup', 'POST /login-link', 'GET /setup/state', 'POST /diagnostics/models'] as const).map((route) => {
    const [method, path] = route.split(' ') as [Method, string];
    return { method, path, scope: null, tag: 'Dashboard', summary: 'The dashboard\'s own (not part of the public API)' } satisfies Endpoint;
  }),
];

/** `/leads/:id` → a regex for the path relative to the base. */
function pattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/[.]/g, '\\.').replace(/:[A-Za-z]+/g, '[^/]+')}$`);
}
const compiled = ENDPOINTS.map((endpoint) => ({ endpoint, re: pattern(endpoint.path) }));

/** The registry entry for a request, relative to the base (`/leads/abc`). Literal paths win over parameters. */
export function findEndpoint(method: string, path: string): Endpoint | null {
  const matches = compiled.filter((e) => e.endpoint.method === method && e.re.test(path));
  if (!matches.length) return null;
  return (matches.find((m) => !m.endpoint.path.includes(':')) ?? matches[0]!).endpoint;
}

/** The public endpoints (what the docs describe). */
export const PUBLIC_ENDPOINTS = ENDPOINTS.filter((e) => e.scope !== null);
