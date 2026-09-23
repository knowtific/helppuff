# Murmur Knowtific— Build Plan

> Working name. Rename freely — it appears in package names, the CSS prefix (`--mm-`) and the global (`window.Murmur`).

An open-source, serverless AI chat widget for websites. The widget speaks one small REST protocol. A thin server translates that protocol to any AI backend through **connectors** — Retell first, then a generic HTTP connector so anyone can plug in their own system.

This document is the complete spec. Build it in the milestone order at the end. Where this document is silent, choose the simplest option that keeps the bundle small and the protocol stable.

---

## 1. Goals and non-goals

### Goals

- **Fail-safe above all.** Any unrecoverable error hides the widget silently. A broken widget on a client's site is worse than no widget (§8.3).
- **Beautiful by default.** Minimal, modern, a little intriguing. Looks designed, not templated.
- **Tiny.** Loader under 4 kb gzipped, full widget under 35 kb gzipped. Zero impact on host page LCP and CLS.
- **Backend-agnostic.** The widget knows nothing about Retell. It speaks the Murmur protocol only.
- **Serverless and free to run.** Reference server runs on Cloudflare Workers free tier. No database required.
- **Pluggable.** Each connector lives in its own directory and is selected by config.
- **Lead capture first.** Pre-chat form, context capture, and lead forwarding are core, not add-ons.
- **Easy to self-host.** Clone, fill in a config file and secrets, run one script.

### Non-goals (v1)

- An operator inbox or dashboard
- Human live handoff (the protocol leaves room for it — see §4.6)
- Streaming responses (connectors may add it later; v1 is request/response)
- Email, WhatsApp, social channels
- A visual flow builder or admin UI — config is a file
- Multi-tenant SaaS signup

---

## 2. Architecture

```
┌──────────────────────┐      Murmur protocol (REST/JSON)     ┌──────────────────────────┐
│  Widget (browser)    │ ───────────────────────────────────▶ │  Server (CF Worker)      │
│  loader.js + app.js  │ ◀─────────────────────────────────── │  Hono + protocol core    │
│  Preact, Shadow DOM  │                                      │                          │
└──────────────────────┘                                      │  ┌────────────────────┐  │
                                                              │  │ connectors/retell  │──┼──▶ Retell API
                                                              │  │ connectors/http    │──┼──▶ Your webhook
                                                              │  │ connectors/openai  │──┼──▶ Any OpenAI-compatible API
                                                              │  │ connectors/echo    │  │   (dev/testing)
                                                              │  └────────────────────┘  │
                                                              │  ┌────────────────────┐  │
                                                              │  │ sinks/webhook      │──┼──▶ Lead destinations
                                                              │  │ sinks/supabase     │  │
                                                              │  └────────────────────┘  │
                                                              └──────────────────────────┘
```

Three separable pieces:

1. **Protocol** — TypeScript types + Zod schemas. The public contract. Anyone may implement a server for it in any language.
2. **Widget** — renders the protocol. Can point at *any* server that implements it.
3. **Server** — reference implementation. Routes, security, rate limiting, connector registry, lead sinks.

### Stateless sessions

The server stores **no session state**. On session start it returns a signed session token (HMAC-SHA256) containing `{ siteId, sessionId, connectorState, exp }`. `connectorState` is a small opaque object the connector needs to continue — for Retell, the `chat_id`. Every later request carries the token; the server verifies the signature and hands `connectorState` back to the connector.

This is what makes it free and zero-maintenance: no database is required to run a conversation. Connectors that need more state (conversation history for the OpenAI connector) keep it client-side in the token-bound transcript the widget sends, or in KV — see §6.3.

---

## 3. Repository layout

pnpm workspaces monorepo.

```
murmur/
├── packages/
│   ├── protocol/                 # types + zod schemas, zero runtime deps beyond zod
│   │   └── src/
│   │       ├── messages.ts
│   │       ├── actions.ts
│   │       ├── api.ts            # request/response shapes for every endpoint
│   │       ├── config.ts         # public widget config shape
│   │       └── index.ts
│   │
│   ├── widget/
│   │   ├── src/
│   │   │   ├── loader.ts         # tiny entry: launcher + lazy import
│   │   │   ├── app/
│   │   │   │   ├── App.tsx
│   │   │   │   ├── store.ts      # reducer + state machine
│   │   │   │   ├── api.ts        # protocol client
│   │   │   │   ├── persist.ts    # localStorage, try/catch, versioned
│   │   │   │   └── context.ts    # page URL, referrer, UTM, locale
│   │   │   ├── components/
│   │   │   │   ├── Launcher.tsx
│   │   │   │   ├── Panel.tsx
│   │   │   │   ├── Header.tsx
│   │   │   │   ├── Home.tsx      # intro screen: greeting, shortcuts, links
│   │   │   │   ├── LeadForm.tsx
│   │   │   │   ├── Thread.tsx
│   │   │   │   ├── Composer.tsx
│   │   │   │   ├── ShortcutBar.tsx
│   │   │   │   ├── Teaser.tsx
│   │   │   │   ├── Typing.tsx
│   │   │   │   └── messages/
│   │   │   │       ├── index.tsx # renderer switch
│   │   │   │       ├── Text.tsx
│   │   │   │       ├── Notice.tsx
│   │   │   │       ├── Options.tsx
│   │   │   │       ├── Card.tsx
│   │   │   │       ├── Links.tsx
│   │   │   │       └── Form.tsx
│   │   │   ├── flows/
│   │   │   │   └── runner.ts     # client-side multi-step shortcut flows
│   │   │   ├── lib/
│   │   │   │   ├── markdown.ts   # minimal safe renderer
│   │   │   │   ├── sound.ts
│   │   │   │   └── focus.ts      # focus trap
│   │   │   └── styles/
│   │   │       ├── tokens.ts     # design tokens → CSS custom properties
│   │   │       └── widget.css.ts # all styles as one string
│   │   ├── demo/index.html       # local playground page
│   │   ├── fixtures/            # hostile host pages for isolation tests
│   │   └── vite.config.ts
│   │
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts          # Hono app, Worker export
│   │   │   ├── routes/
│   │   │   │   ├── config.ts
│   │   │   │   ├── sessions.ts
│   │   │   │   └── messages.ts
│   │   │   ├── core/
│   │   │   │   ├── registry.ts   # connector + sink registry
│   │   │   │   ├── token.ts      # HMAC session tokens
│   │   │   │   ├── origin.ts     # origin allowlist
│   │   │   │   ├── ratelimit.ts
│   │   │   │   ├── turnstile.ts
│   │   │   │   ├── sanitize.ts   # validate connector output against protocol
│   │   │   │   └── errors.ts
│   │   │   └── config/
│   │   │       └── load.ts       # reads murmur.config.ts, resolves secrets from env
│   │   └── wrangler.toml
│   │
│   ├── connectors/
│   │   ├── _types/               # Connector interface, shared helpers
│   │   ├── echo/                 # built first — for testing every widget feature
│   │   ├── retell/
│   │   ├── http/                 # generic: forward protocol to any URL
│   │   └── openai/               # any OpenAI-compatible chat completions API
│   │
│   └── sinks/
│       ├── _types/
│       ├── webhook/
│       └── supabase/
│
├── murmur.config.ts              # the user's config (example committed as .example)
├── scripts/
│   ├── setup.sh                  # one-command deploy
│   └── dev.sh
├── docs/
│   ├── protocol.md
│   ├── connectors.md             # how to write a connector
│   ├── theming.md
│   └── self-hosting.md
├── LICENSE                       # MIT
└── README.md
```

Each connector and sink directory has the same shape:

```
connectors/retell/
├── src/index.ts      # default export: the connector
├── src/schema.ts     # zod schema for its options
├── README.md         # setup steps for this backend
└── test/
```

---

## 4. The Murmur protocol

All endpoints are versioned under `/v1`. JSON in, JSON out. Errors always use one envelope:

```json
{ "error": { "code": "rate_limited", "message": "Too many messages. Try again shortly.", "retryAfter": 30 } }
```

Error codes: `bad_request`, `unauthorized`, `forbidden_origin`, `not_found`, `rate_limited`, `quota_exceeded`, `captcha_failed`, `connector_error`, `session_expired`, `internal`.

`message` is always safe to show a visitor. Never pass a backend's raw error text through.

### 4.1 Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/sites/:siteId/config` | Public widget config (branding, form, shortcuts, copy) |
| `POST` | `/v1/sites/:siteId/sessions` | Start a session with lead + context |
| `POST` | `/v1/sessions/messages` | Send a user message or action |
| `GET` | `/v1/sessions/messages?after=:id` | Poll for new messages (only if `capabilities.poll`) |
| `POST` | `/v1/sessions/end` | End session (best effort, fire-and-forget) |

Session endpoints authenticate with `Authorization: Bearer <sessionToken>`.

### 4.2 Start a session

Request:

```ts
type StartSessionRequest = {
  lead?: Record<string, string>;        // keys match the configured form fields
  context: {
    pageUrl: string;
    pageTitle?: string;
    referrer?: string;
    utm?: Partial<Record<'source'|'medium'|'campaign'|'term'|'content', string>>;
    locale?: string;
    timezone?: string;
  };
  firstMessage?: string;                // optional "How can we help?" field
  captchaToken?: string;
};
```

Response:

```ts
type StartSessionResponse = {
  sessionToken: string;
  sessionId: string;
  expiresAt: number;                    // epoch ms
  messages: Message[];                  // greeting and/or reply to firstMessage
  capabilities: { poll: boolean; end: boolean };
};
```

### 4.3 Send a message

```ts
type SendRequest =
  | { kind: 'text'; text: string; clientId: string }
  | { kind: 'action'; actionId: string; value: string; label: string; clientId: string };

type SendResponse = { messages: Message[] };
```

`clientId` is generated by the widget for optimistic rendering and deduplication. `action` is sent when a visitor taps an option or button of kind `reply` — the connector receives both the label (for display and history) and the value.

### 4.4 Messages

```ts
type Base = { id: string; ts: number; role: 'user' | 'agent' | 'system' };

type Message =
  | Base & { type: 'text'; text: string }                      // markdown subset
  | Base & { type: 'notice'; text: string; tone?: 'info' | 'warn' }
  | Base & { type: 'options'; text?: string; options: Option[]; multi?: boolean }
  | Base & { type: 'card'; title: string; body?: string; image?: Img; actions?: Action[] }
  | Base & { type: 'carousel'; cards: CardItem[] }
  | Base & { type: 'links'; title?: string; links: LinkItem[] }
  | Base & { type: 'form'; title?: string; fields: Field[]; submitLabel?: string };

type Option   = { id: string; label: string; value: string };
type Img      = { src: string; alt: string; aspect?: '1:1' | '16:9' | '4:3' };
type CardItem = { title: string; body?: string; image?: Img; actions?: Action[] };
type LinkItem = { label: string; url: string; description?: string };
```

Rules:

- The server validates every connector message against the Zod schema before returning it. Invalid messages are dropped and logged; if all are dropped, return a single `notice` with a friendly fallback. The widget must never crash on unexpected input either — an unknown `type` renders nothing.
- `text` supports a markdown subset only: paragraphs, line breaks, `**bold**`, `*italic*`, `` `code` ``, `[links](url)`, and `-` bullet lists. No headings, images, HTML or tables.
- URLs anywhere in the protocol accept only `https:`, `http:`, `mailto:`, `tel:`. Anything else is rejected server-side and rendered as plain text client-side.

### 4.5 Actions

Used by cards, shortcuts and flows.

```ts
type Action =
  | { id: string; kind: 'reply'; label: string; value: string }   // sends as a user action
  | { id: string; kind: 'url';   label: string; url: string; newTab?: boolean }
  | { id: string; kind: 'tel';   label: string; phone: string }
  | { id: string; kind: 'email'; label: string; email: string }
  | { id: string; kind: 'flow';  label: string; flowId: string }  // runs a client-side flow
  | { id: string; kind: 'form';  label: string; formId: string }; // opens a configured form
```

### 4.6 Future-proofing for human handoff

Not built in v1, but the protocol already supports it:

- `capabilities.poll = true` tells the widget to poll `GET /v1/sessions/messages?after=` every 4s while the panel is open and 20s while closed (paused when the tab is hidden).
- A connector that returns an `agent` message with a `meta.agentName` / `meta.avatar` lets the widget show a human identity.

A later Telegram or dashboard handoff becomes a connector feature, with no widget changes.

---

## 5. Configuration

One file, `murmur.config.ts`, typed and validated at build time. Secrets are never written here — they are referenced by environment variable name.

```ts
import { defineConfig } from '@murmur/server';

export default defineConfig({
  sites: {
    knowtific: {
      origins: ['https://knowtific.com', 'https://www.knowtific.com', 'http://localhost:5173'],

      connector: {
        type: 'retell',
        options: {
          apiKey: { env: 'RETELL_API_KEY' },
          agentId: 'agent_xxx',
          dynamicVariables: {             // mapping from lead/context → Retell variables
            customer_name: '{{lead.name}}',
            customer_phone: '{{lead.phone}}',
            page_url: '{{context.pageUrl}}',
          },
        },
      },

      sinks: [
        { type: 'webhook', options: { url: { env: 'LEAD_WEBHOOK_URL' } } },
      ],

      security: {
        captcha: { provider: 'turnstile', siteKey: '0x...', secret: { env: 'TURNSTILE_SECRET' } },
        limits: {
          messagesPerIpPerMinute: 10,
          sessionsPerIpPerHour: 5,
          messagesPerSession: 60,
          messagesPerSitePerDay: 500,     // cost backstop — always set this
          maxMessageLength: 1000,
        },
        sessionTtlHours: 24,
      },

      widget: { /* see §5.1 — this is the public part, served by /config */ },
    },
  },
});
```

The config file is bundled into the Worker at build time. Changing it means redeploying the Worker (`pnpm deploy:worker`), which takes seconds. A KV-backed override (edit config without deploying) is a later milestone and is not required.

### 5.1 Public widget config

Everything the browser may see. Returned by `GET /v1/sites/:siteId/config`, cached at the edge for 5 minutes.

```ts
type WidgetConfig = {
  brand: {
    name: string;                     // "Knowtific"
    agentName: string;                // "Alex"
    avatar?: string;                  // url; falls back to generated monogram orb
    accent: string;                   // "#5B5BF7"
    theme?: 'light' | 'dark' | 'auto';
    tokens?: Partial<ThemeTokens>;    // any CSS token override, see §9.3
  };

  launcher: {
    position: 'bottom-right' | 'bottom-left';
    offset?: { x: number; y: number };
    label?: string;                   // optional text beside the orb on desktop: "Ask us"
    hideOnPaths?: string[];           // glob patterns
  };

  home: {
    title: string;                    // "Hi there"
    subtitle: string;                 // "Ask anything, or pick a shortcut."
    shortcuts?: Shortcut[];           // big tappable tiles on the home screen
    links?: { title: string; items: LinkItem[] };   // help centre section
  };

  leadForm: {
    enabled: boolean;
    title?: string;
    fields: Field[];
    submitLabel?: string;             // "Start chat"
    privacy?: { text: string; url: string };
    askFirstMessage?: boolean;        // adds "How can we help?" textarea
  };

  chat: {
    placeholder?: string;
    initialMessages?: string[];       // shown locally before the first server reply
    shortcuts?: Shortcut[];           // persistent chips above the composer
    fallbackContact?: { phone?: string; email?: string };  // shown on errors/limits
  };

  teaser?: {
    text: string;
    delayMs: number;                  // min 2000
    paths?: string[];
    oncePerSession: boolean;
  };

  flows?: Flow[];
  forms?: Record<string, { title: string; fields: Field[]; submitLabel?: string }>;

  sound?: { enabled: boolean };       // default false
  captcha?: { provider: 'turnstile'; siteKey: string };
  poweredBy?: boolean;                // tiny footer link, default true
};

type Field = {
  name: string;                       // key in lead record
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: string[];                 // for select
  pattern?: string;                   // optional regex
  autocomplete?: string;              // "name", "email", "tel"
};

type Shortcut = {
  id: string;
  label: string;
  description?: string;               // for home-screen tiles only
  icon?: string;                      // name from the built-in icon set (§9.6)
  action: Action;
  paths?: string[];                   // glob: only show on matching pages
};

type Flow = {
  id: string;
  steps: FlowStep[];
  submit: { as: 'message'; template: string };   // "I'd like a quote for {{job}} in {{suburb}}, {{when}}."
};

type FlowStep = {
  field: string;
  ask: string;                        // shown as an agent-style message
  input: 'text' | 'choice' | 'phone' | 'email';
  choices?: string[];
  required?: boolean;
};
```

---

## 6. Connectors

### 6.1 Interface

```ts
// packages/connectors/_types/src/index.ts
import type { z } from 'zod';
import type { Message, StartSessionRequest, SendRequest } from '@murmur/protocol';

export interface Connector<Opts = unknown, State = unknown> {
  type: string;                                       // 'retell'
  optionsSchema: z.ZodType<Opts>;
  capabilities: { poll: boolean; end: boolean };

  start(ctx: ConnectorContext<Opts>, input: StartSessionRequest):
    Promise<{ state: State; messages: Message[] }>;

  send(ctx: ConnectorContext<Opts>, state: State, input: SendRequest):
    Promise<{ state?: State; messages: Message[] }>;   // may return updated state → new token

  poll?(ctx: ConnectorContext<Opts>, state: State, afterId?: string):
    Promise<{ messages: Message[] }>;

  end?(ctx: ConnectorContext<Opts>, state: State): Promise<void>;
}

export type ConnectorContext<Opts> = {
  options: Opts;                   // validated, secrets resolved
  siteId: string;
  sessionId: string;
  env: Record<string, unknown>;    // Worker bindings (KV etc.)
  fetch: typeof fetch;             // injected for testability
  log: (event: string, data?: object) => void;
  waitUntil: (p: Promise<unknown>) => void;
};
```

Rules for every connector:

- **State must be small** — it is embedded in the signed token. Keep under 1 kb serialized.
- Throw `ConnectorError` with a safe message; the core converts it to the error envelope.
- Time out outbound calls at 25s and throw a retryable error.
- Never import from another connector.
- Registration is explicit in `server/src/core/registry.ts` — a map of `type → connector`. No dynamic discovery, so the bundle only contains what's registered and tree-shaking works.

### 6.2 `echo` connector (build first)

For development and tests. Deterministic commands exercise every widget feature without a paid backend:

| User sends | Echo returns |
| --- | --- |
| anything | `text` echoing it with markdown |
| `/options` | an `options` message |
| `/card` | a `card` with image and three action kinds |
| `/carousel` | 3 cards |
| `/links` | a `links` message |
| `/form` | an inline `form` message |
| `/slow` | reply after 3s (typing indicator test) |
| `/error` | throws a `ConnectorError` |
| `/long` | a 600-word markdown reply (scroll test) |

### 6.3 `retell` connector

- `start` → `POST create-chat` with `agent_id` and rendered `retell_llm_dynamic_variables`. State: `{ chatId }`. If `firstMessage` is present, immediately call `create-chat-completion` with it and return both.
- `send` → `create-chat-completion` with the text. For `action` inputs, send the **label** as the user content.
- `end` → `end-chat`, fire-and-forget via `waitUntil`.
- Map Retell reply text → `text` messages.
- **Rich messages**, two supported mechanisms:
  1. **Tool calls (preferred).** If the Retell response includes tool/function call results for tools named `show_options`, `show_card`, `show_links`, parse their arguments into the matching protocol messages. Document the exact tool JSON schemas in `connectors/retell/README.md` so users can paste them into their Retell agent.
  2. **Inline markers (fallback).** Parse and strip a trailing block: `[[options: Label A | Label B | Label C]]`, `[[link: Label | https://…]]`. Tolerant parser; malformed markers are stripped silently.
- Confirm the exact Retell chat API request/response shapes from the current Retell docs before implementing. Do not guess field names.

### 6.4 `http` connector (the "bring your own backend" connector)

The versatility story. Forwards the Murmur protocol to a user's URL and expects Murmur messages back.

- Options: `url`, optional `headers` (values may be `{ env }` refs), optional `signingSecret`.
- `start` → `POST {url}/start` with `{ sessionId, siteId, lead, context, firstMessage }`, expects `{ state?: object, messages: Message[] }`.
- `send` → `POST {url}/message` with `{ sessionId, state, input }`, expects `{ state?, messages }`.
- Signs each request body with `X-Murmur-Signature: sha256=…` when `signingSecret` is set.
- `docs/connectors.md` includes a 30-line reference receiver (Hono and plain Node) so a developer can wire n8n, a Python RAG service, or anything else in minutes.

### 6.5 `openai` connector

Any OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, Groq, a local model, Cloudflare Workers AI's OpenAI-compatible route).

- Options: `baseUrl`, `apiKey`, `model`, `systemPrompt` (templated with lead/context), `maxHistory` (default 20).
- History: stored in KV under `hist:{sessionId}` with the session TTL. State in the token is just `{ turn }`.
- Rich messages via function calling: expose `show_options`, `show_card`, `show_links` as tools; convert tool call arguments into protocol messages.
- This connector is what makes the project useful to people who don't use Retell. Build it after Retell.

### 6.6 Sinks (lead destinations)

Run on session start, after the lead is accepted, via `waitUntil` — never blocking the visitor.

```ts
export interface Sink<Opts = unknown> {
  type: string;
  optionsSchema: z.ZodType<Opts>;
  onLead(ctx: SinkContext<Opts>, lead: LeadEvent): Promise<void>;
  onTranscript?(ctx: SinkContext<Opts>, t: TranscriptEvent): Promise<void>;   // later
}
```

- `webhook` — POST JSON, optional HMAC signature. Covers Zapier, Make, n8n, Google Sheets via Apps Script, any CRM.
- `supabase` — inserts into a `leads` table via PostgREST using the service key. Ship the SQL migration in the sink's README.

A sink failure is logged and never surfaces to the visitor.

---

## 7. Server behaviour

### 7.1 Request pipeline

Order matters: cheap rejections first, anything that costs money or writes data last.

For `POST /v1/sites/:siteId/sessions`:

1. Resolve site → 404 if unknown.
2. Origin check against `site.origins` → `forbidden_origin`.
3. Parse + validate body with Zod → `bad_request`.
4. Validate lead fields against the site's configured form (required, type, pattern, length ≤ 200 each).
5. Rate limit: sessions per IP per hour, site daily quota.
6. Verify Turnstile token if captcha is configured → `captcha_failed`.
7. `connector.start(...)`.
8. Sign token, respond.
9. `waitUntil`: run sinks.

For `POST /v1/sessions/messages`:

1. Verify token → `unauthorized` / `session_expired`.
2. Origin check (token's site).
3. Validate body, length cap.
4. Rate limit: per IP per minute, per session total, site daily quota.
5. `connector.send(...)`.
6. Sanitize + validate returned messages.
7. If connector returned new state, issue a refreshed token in the `X-Murmur-Token` response header.

### 7.2 Security

- **Origin allowlist is mandatory.** Without it anyone can copy the embed snippet and spend your AI budget. Requests with no `Origin` header are rejected on session endpoints.
- **CORS**: reflect the request origin only when it's in the allowlist; `Access-Control-Allow-Headers: content-type, authorization`; expose `X-Murmur-Token`, `Retry-After`.
- **Tokens**: HMAC-SHA256 with `MURMUR_SECRET` (≥ 32 bytes, generated by `setup.sh`). Payload base64url JSON. Include `exp`. Constant-time comparison.
- **Rate limits** in KV with TTL keys: `rl:{scope}:{key}:{window}`. KV is eventually consistent — acceptable for abuse bounds, never used for billing.
- **Daily site quota** is the cost backstop. When hit, return `quota_exceeded`; the widget shows the fallback contact details.
- **IP** from `CF-Connecting-IP`. Hash it (SHA-256 + secret salt) before using it in any key or log.
- **No PII in logs.** Log event names, site ids, session ids, latencies and error codes — never lead data or message text.
- Response header `Cache-Control: no-store` on all session endpoints.

### 7.3 Runtime

- Cloudflare Workers is the primary target: `wrangler.toml` with one KV namespace (`MURMUR_KV`) and `nodejs_compat` only if a dependency needs it.
- Keep the server core free of Worker-only APIs except through an injected `Platform` interface (`kv`, `waitUntil`, `ip`). A Node/Vercel adapter should be a ~50-line file later, not a rewrite.
- The server also serves the widget bundles as static assets from the same Worker, content-hashed and cached immutably for a year. `loader.js` itself is cached for 5 minutes (it references the hashed app bundle).

---

## 8. Widget

### 8.1 Embedding

```html
<script src="https://chat.example.com/loader.js" data-site="knowtific" async></script>
```

Optional attributes: `data-api` (override server URL for self-hosted/BYO servers), `data-theme`, `data-open` (open on load, for a dedicated support page).

JavaScript API on `window.Murmur`:

```ts
Murmur.open(); Murmur.close(); Murmur.toggle();
Murmur.send('I need a quote');                 // opens and sends
Murmur.identify({ name, email, phone });       // prefills/skips the lead form
Murmur.on('lead' | 'open' | 'close' | 'message', handler);   // for analytics hooks
Murmur.reset();                                // clears the stored session
```

Queue calls made before load (`window.Murmur = window.Murmur || { q: [] }` pattern) so site owners can call it immediately.

### 8.2 Isolation — zero conflicts with the host site

The widget must work identically on plain HTML, WordPress, Webflow, Shopify, Next.js, Nuxt, Angular and any other stack, and must never break or be broken by the host page. These are hard requirements, each covered by an E2E test (§11).

**JavaScript**
- Ship as a self-contained IIFE. Preact is bundled privately inside it — never read from or written to the page. The host's React/Vue/jQuery versions are irrelevant.
- Exactly one global: `window.Murmur`. Everything else is module-scoped.
- No polyfills that patch built-ins or prototypes. No modifications to `history`, `fetch`, `XMLHttpRequest`, `console` or any global. Target ES2019+ and let old browsers simply not show the launcher.
- Guard against double inclusion: if `window.Murmur.__loaded` is set, the second script tag does nothing.
- Keep all event listeners on the shadow root or the widget's own elements. The only exceptions are `keydown` for Escape (scoped: acts only when the panel is open) and `visibilitychange`, `storage`, `popstate` — all passive and removed on `Murmur.destroy()`.
- SPA route changes (Next.js, Nuxt, etc.) are detected by polling `location.pathname` every 500ms while visible rather than monkey-patching `history.pushState`. `paths` filters re-evaluate on change.

**CSS**
- Everything renders inside a closed-mode-agnostic **Shadow DOM** attached to one host element: `<murmur-widget>` appended to `document.body`.
- The host element gets inline `all: initial; position: fixed; z-index: var(--mm-z); inset: auto;` so no page stylesheet can reach it, and inside the shadow root `:host { all: initial; }` plus an explicit reset (`box-sizing`, `font`, `line-height`, `color`, `letter-spacing`, `text-align`, `direction`) stops *inherited* properties (font-size, color, line-height) from leaking in — Shadow DOM blocks selectors but not inheritance.
- Styles are applied with a constructable stylesheet (`adoptedStyleSheets`), falling back to a `<style>` element inside the shadow root. Nothing is ever added to `document.head` except the script itself.
- No global CSS, no `@font-face` on the page, no changes to `html`/`body` styles — except the mobile full-screen scroll lock, which saves and restores the exact previous inline `overflow` value.
- Rem units are forbidden (they follow the host's `html` font-size). Use px and the token scale.

**Networking & CSP**
- The widget only contacts its own server origin (and Cloudflare Turnstile when captcha is enabled). No analytics, no fonts, no CDNs.
- Document the exact CSP entries a strict site needs: `script-src <server>`, `connect-src <server>`, and `challenges.cloudflare.com` for Turnstile. Styles via `adoptedStyleSheets` do not require `style-src 'unsafe-inline'`.
- Turnstile's widget renders inside the shadow root's form container; if a browser rejects that, fall back to rendering it in a single hidden light-DOM container owned by the widget. Test both.

**Storage**
- localStorage keys are all prefixed `mm:`. No cookies are set.

**Teardown**
- `Murmur.destroy()` removes the host element, all listeners, timers and pollers. Required for SPA frameworks and for tests.

**Next.js embedding (Knowtific)**

```tsx
// app/layout.tsx
import Script from 'next/script';

<Script
  src="https://chat.knowtific.com/loader.js"
  data-site="knowtific"
  strategy="lazyOnload"
/>
```

`lazyOnload` keeps it off the critical path. The widget must survive Next.js client-side navigation and React Strict Mode double-mounting of the layout without creating two widgets.

### 8.3 Fail-safe behaviour

**Governing rule: the widget is never more important than the page it sits on.** A broken widget on a client's site is worse than no widget — a visitor who can't use it will leave, and the site owner sees a broken element they didn't build. So when anything goes wrong that the widget cannot recover from, it removes itself silently and leaves no trace.

This is the highest-priority behavioural requirement in this document. When it conflicts with a feature, the feature loses.

**Two tiers of failure, handled differently**

| Tier | When | Behaviour |
| --- | --- | --- |
| **Fatal** | Before or outside a live conversation — boot, config fetch, render, unhandled exception | Remove the widget entirely, silently |
| **Recoverable** | During a live conversation — a send fails, a limit is hit | Keep the widget open, show an inline notice with fallback contact (§8.7) |

The split matters: vanishing mid-sentence would destroy a visitor's typed message and their conversation. Once a conversation is live, degrade in place instead.

**Fatal conditions → hide**

- Missing or invalid `data-site`, or the `/config` request fails, 404s, times out (6s), or returns a body that fails schema validation.
- The dynamic import of `app.js` fails (offline, CSP block, network error).
- The environment lacks something required: no `attachShadow`, no `fetch`, no `Promise`, no `CSS.supports`. Feature-detect; never user-agent sniff.
- Any exception thrown during initial mount or first render.
- Two or more uncaught render errors in a session (see error boundary below).
- `document.body` is unavailable when the loader runs.

**What "hide" means exactly**

1. Remove the `<murmur-widget>` host element from the DOM.
2. Remove every listener, timer, poller and observer — the same path as `Murmur.destroy()`.
3. Leave `window.Murmur` in place as an inert stub whose methods are no-ops that return `undefined`, so host-page code calling `Murmur.open()` never throws.
4. Write nothing to the console at default verbosity. Nothing visible: no error text, no empty box, no stray element, no layout shift.
5. Leave localStorage untouched, so a later page load can still restore a valid session.
6. Do not retry automatically within the page view. A fresh page load may try again.

**Defensive coding requirements**

- **Every entry point is wrapped.** The loader IIFE body, the dynamic import, the mount call, and every public `window.Murmur` method sit inside try/catch. A throw from any of them results in `hide()`, never a propagated exception.
- **Error boundary** around the Preact app. First uncaught render error: reset to a safe state (`home`) and re-render once. Second: fatal, hide.
- **Global listeners are scoped, not swallowed.** Do not install a global `window.onerror` or `unhandledrejection` handler — that would intercept the host page's own errors and interfere with their monitoring. Catch at the widget's own boundaries only.
- **Never throw into host code.** Everything exposed on `window.Murmur` catches internally and returns `undefined` on failure.
- **Validate everything crossing the boundary.** Config and every message from the server are parsed against the schema before use. A field of the wrong type is treated as absent and its default applied; an unknown message `type` renders nothing; a malformed config is fatal.
- **Conservative defaults.** Every optional config key has a safe default. If `accent` isn't a valid colour, use the built-in. If `fields` is empty or malformed, fall back to a name + phone form. The widget must be fully functional on `{}`.
- **All timers bounded.** Every fetch gets an `AbortController` timeout (6s for config, 30s for a message send). No unbounded retry, no exponential backoff loop that outlives the page view — at most one automatic retry per request.
- **Storage is never load-bearing.** Every read and write is in try/catch; unavailable or corrupt storage degrades to an in-memory session rather than failing.
- **No optional chaining on required data.** Validate at the boundary once, then treat data as typed inside.

**Diagnostics without noise**

Silent by default, debuggable when needed. `window.Murmur.debug()` returns `{ state, lastError, config, version }` for troubleshooting a client site. `?mmdebug=1` in the page URL enables console logging for that page view only. Neither is on by default and neither is needed to report a bug — the server logs error codes, and §7.2's no-PII rule still applies.

**Server-side conservatism**

The same posture applies at the edge:

- A connector throwing or timing out returns a `connector_error` with the fallback contact, never a stack trace or a backend error string.
- A connector returning malformed messages has them dropped by the sanitizer; a single friendly `notice` is returned rather than a failure.
- A sink failing is logged and never surfaces to the visitor.
- An unknown site id, a bad origin or a bad token returns a clean envelope; the widget treats the response as fatal and hides.
- Never return a 5xx with an HTML error page — always the JSON envelope, so the widget's parser has something valid to read.

### 8.4 Loading strategy

Performance is a feature — many adopters will care about Core Web Vitals.

1. `loader.js` (< 4 kb gz): reads its script tag, injects a host element with a Shadow DOM, renders the launcher orb with inline CSS, fetches `/config` with low priority, sets up the teaser timer. No Preact.
2. `app.js` (< 35 kb gz total): dynamically imported on the first of — launcher hover (desktop), launcher `pointerdown`, teaser display, `Murmur.open()`, or `requestIdleCallback` after 6s.
3. Never block `load`. Never render before `DOMContentLoaded`. Launcher is `position: fixed` → zero CLS.

### 8.5 State machine

One reducer. Build and unit test it before any UI.

```
            ┌──────────────────────────────── reset ──────────────────────────┐
            ▼                                                                  │
 closed ──open──▶ home ──start──▶ lead_form ──submit──▶ starting ──ok──▶ chat │
   ▲               │                  ▲                     │              │   │
   └────close──────┴──────────────────┴─────────────────────┘              │   │
                   │ (lead form disabled or already identified)            │   │
                   └──────────────────────start──────────────▶ starting    │   │
                                                                           ▼   │
                                                          chat ⇄ sending ──┴───┘
                                                            │
                                                            └─▶ ended (session expired → offer new chat)
```

- `home` — greeting, shortcut tiles, help links, "Start a conversation" button. Skipped straight to `chat` if a live session exists.
- `lead_form` — no server session yet, no AI cost yet.
- `starting` — POST sessions; button shows inline spinner.
- `chat` / `sending` — optimistic user message appended immediately; typing indicator while waiting.
- Errors are a flag on the state, not a state: `{ error: { code, retryable } }`, rendered inline with a retry control that keeps the unsent text.

A home-screen shortcut with a `reply` action goes through the lead form first (if enabled), then sends its value as the first message — the visitor's intent is not lost.

### 8.6 Persistence

One localStorage key per site: `mm:{siteId}`.

```ts
type Persisted = {
  v: 1;
  sessionToken: string;
  sessionId: string;
  expiresAt: number;
  lead?: Record<string, string>;
  messages: Message[];            // capped at the last 60
  consumedActions: string[];      // option ids already tapped
  ui: { sound: boolean; teaserDismissed: boolean };
};
```

- Every access in try/catch; fall back to in-memory when storage is unavailable.
- Discard on version mismatch or expiry.
- Listen to the `storage` event so two tabs stay in sync instead of clobbering each other.

### 8.7 Features checklist

**Launcher**
- Orb button with unread dot; optional text label on desktop.
- `hideOnPaths` support.
- Keyboard focusable, `aria-expanded`, `aria-controls`.

**Teaser bubble**
- Appears after `delayMs` (min 2000) on matching paths, once per session, dismissible.
- Never shown after the widget has been opened in this session.

**Home screen**
- Title, subtitle, agent avatar orb.
- Shortcut tiles (icon + label + description), filtered by `paths`.
- Help/links section with arrow affordance.
- Primary "Start a conversation" button; if a session exists, "Continue conversation" with the last message preview.

**Lead form**
- Configurable fields; inline validation on blur; accessible error text tied with `aria-describedby`.
- Correct `autocomplete` and `inputmode` attributes so mobile autofill works.
- Turnstile rendered invisibly when configured (loaded only when the form is shown).
- Privacy line with link.
- `Murmur.identify()` prefills and, if all required fields are present, skips it.

**Thread**
- Message grouping: consecutive messages from one sender share an avatar and tighter spacing.
- Timestamps on hover/tap, relative ("2m").
- Markdown subset renderer (§4.4), links safe and `rel="noopener noreferrer nofollow"`, `tel:`/`mailto:` handled natively.
- Options: chips; tapped option highlights, others fade to disabled; `multi` shows checkboxes + confirm.
- Cards: image with aspect ratio, title, body, up to 3 actions.
- Carousel: horizontal scroll-snap, arrow buttons on desktop, swipe on touch.
- Links: stacked rows with title + description + arrow.
- Inline forms: same field component as the lead form; submitted as an `action` with JSON-encoded value and a readable label.
- Typing indicator.
- "New messages" pill when the user has scrolled up.
- Auto-scroll only when already near the bottom.

**Composer**
- Auto-growing textarea to 5 lines.
- Enter to send, Shift+Enter newline; on touch devices Enter is newline and the send button is primary.
- Character counter appears in the last 100 chars of the limit.
- Disabled while `sending`.

**Shortcut bar**
- Horizontal scrolling chips above the composer, filtered by `paths`.
- Hidden once the thread has more than ~6 messages to reduce clutter; reachable via a "⋯" button.

**Flows (multi-step shortcuts)**
- Run entirely client-side: each step appears as an agent-style message with the right input (choices as chips).
- Visitor can cancel at any step.
- On completion, render the template and send it as one message. Zero server calls until then.

**Sound**
- Off by default. Only after the visitor has sent at least one message. Silent when the panel is visible and the tab is focused. Toggle in the header menu, persisted. Tone embedded as a tiny base64 asset.

**Header**
- Agent avatar + name + status line ("Typically replies instantly").
- Menu: sound toggle, "Start new conversation", close.
- Back arrow to home from chat.

**Errors & limits**
- `rate_limited` → notice with countdown from `retryAfter`.
- `quota_exceeded` / `connector_error` → notice with fallback phone/email as tappable buttons.
- `session_expired` → notice + "Start a new conversation".
- Offline (`navigator.onLine === false`) → composer shows "You're offline" and queues nothing.

**Accessibility**
- Panel `role="dialog"`, `aria-modal="false"` (non-blocking), labelled by header.
- Focus moves into the panel on open and back to the launcher on close; Escape closes.
- Thread `aria-live="polite"` announcing agent messages only.
- All targets ≥ 44×44 px. WCAG AA contrast, checked against the accent at runtime (auto-choose black/white foreground).
- Full keyboard operation. `prefers-reduced-motion` disables all non-essential motion.

**Internationalisation**
- All UI strings in one `strings` object, overridable via config (`widget.strings`). English default.
- `dir="rtl"` support via logical CSS properties throughout.

### 8.8 Mobile

- Under 640px the panel is full-screen, using `100dvh` and safe-area insets.
- Handle the iOS keyboard with `visualViewport` resize events so the composer stays visible.
- Prevent background scroll while open (`overscroll-behavior: contain` on the thread; lock `body` only on mobile full-screen).
- Inputs at 16px font size minimum to stop iOS zoom.

---

## 9. Visual design

### 9.1 Direction

**Quiet, precise, slightly alive.** The widget should feel like a well-made object rather than a chat app: calm neutral surfaces, one confident accent, generous space, soft depth, and a single signature element that makes people look twice — the orb.

Avoid: heavy drop shadows, saturated gradients everywhere, speech-bubble tails, emoji-laden defaults, generic "chat bot" robot icons.

### 9.2 The signature: the orb

The launcher and agent avatar are a **living orb** — a circle filled with a slow-moving soft gradient derived from the accent (accent → accent rotated 30° in OKLCH → a lighter tint), with a subtle inner highlight.

- Idle: the gradient drifts slowly (12s loop) via an animated `conic-gradient` angle using `@property`. It should be barely perceptible — noticed on the second look.
- Hover: scales to 1.06, highlight brightens.
- Open: orb morphs into a close (×) glyph with a 220ms rotate + crossfade.
- Agent "thinking": the header orb pulses gently instead of a separate spinner, alongside the three-dot typing indicator in the thread.
- If `brand.avatar` is set, the image sits inside the orb ring.
- Under reduced motion: static gradient.

### 9.3 Tokens

All styling reads CSS custom properties on `:host`. Theming = overriding tokens.

```css
:host {
  /* colour */
  --mm-accent: #5B5BF7;
  --mm-accent-fg: #FFFFFF;          /* auto-computed for contrast */
  --mm-accent-soft: color-mix(in oklch, var(--mm-accent) 12%, transparent);
  --mm-bg: #FFFFFF;
  --mm-surface: #F7F7F8;
  --mm-surface-2: #EFEFF1;
  --mm-border: rgba(15, 15, 20, 0.08);
  --mm-text: #111114;
  --mm-text-2: #5C5C66;
  --mm-text-3: #8E8E98;
  --mm-danger: #D93F3F;

  /* type */
  --mm-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
  --mm-text-xs: 12px;  --mm-text-sm: 13px;  --mm-text-md: 15px;  --mm-text-lg: 20px;  --mm-text-xl: 26px;
  --mm-leading: 1.5;
  --mm-tracking-tight: -0.02em;

  /* shape */
  --mm-radius-sm: 10px;
  --mm-radius-md: 16px;
  --mm-radius-lg: 24px;
  --mm-radius-panel: 28px;

  /* depth */
  --mm-shadow-panel: 0 24px 80px -20px rgba(15,15,30,.28), 0 0 0 1px var(--mm-border);
  --mm-shadow-orb: 0 10px 30px -8px color-mix(in oklch, var(--mm-accent) 55%, transparent);

  /* motion */
  --mm-ease-out: cubic-bezier(.22, 1, .36, 1);
  --mm-ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --mm-dur-fast: 140ms;  --mm-dur: 220ms;  --mm-dur-slow: 360ms;

  /* layout */
  --mm-panel-w: 400px;
  --mm-panel-h: min(680px, calc(100vh - 120px));
  --mm-z: 2147483000;
}

@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) {
    --mm-bg: #0E0E12;  --mm-surface: #17171C;  --mm-surface-2: #202027;
    --mm-border: rgba(255,255,255,.08);
    --mm-text: #F4F4F6;  --mm-text-2: #A6A6B0;  --mm-text-3: #74747E;
  }
}
```

### 9.4 Component styling notes

- **Panel**: `--mm-radius-panel`, `--mm-shadow-panel`, background `--mm-bg`. On capable browsers, the header uses a subtle `backdrop-filter: blur(16px)` over a translucent background so the thread scrolls softly beneath it.
- **Home screen**: large title (`--mm-text-xl`, weight 600, tight tracking) sitting on a very soft accent-tinted gradient wash at the top that fades into `--mm-bg`. This wash is the only large colour area in the widget.
- **Agent messages**: *no bubble*. Plain text on the background, max width 88%, comfortable line height. Feels editorial and calm.
- **User messages**: right-aligned, `--mm-accent` background, `--mm-accent-fg` text, `--mm-radius-lg` pill, max width 80%.
- **Option chips**: 1px `--mm-border` outline, `--mm-radius-md`, hover fills with `--mm-accent-soft`; selected fills accent.
- **Cards**: `--mm-surface` background, no border, image top with `--mm-radius-md` inner corners.
- **Shortcut tiles** (home): 2-column grid, `--mm-surface`, icon in a small accent-soft rounded square, label weight 500, description `--mm-text-2`.
- **Composer**: floating pill at the bottom — `--mm-surface` background, 1px border, inset 12px from panel edges, send button is a small accent orb that appears (scale-in) only when there's text.
- **Focus ring**: 2px accent outline with 2px offset, visible only for keyboard focus (`:focus-visible`).

### 9.5 Motion

All motion uses CSS only (transitions, keyframes, `@property`). No animation library.

| Moment | Motion |
| --- | --- |
| Panel open | From the launcher corner: scale .92 → 1, translateY 12px → 0, opacity 0 → 1, `--mm-dur-slow`, `--mm-ease-out`. `transform-origin` set to the launcher's corner |
| Panel close | Reverse at `--mm-dur` |
| Screen change (home ↔ form ↔ chat) | Crossfade + 8px horizontal slide, `--mm-dur` |
| Message in | translateY 6px → 0 + opacity, `--mm-dur`; consecutive messages stagger 50ms |
| Option chips | Stagger in 30ms each, spring ease |
| Typing dots | Three dots, staggered opacity/translate loop, 1.2s |
| Send button | Scale 0 → 1 spring when text is entered |
| Teaser | Slide up 8px + fade from the launcher, dismiss collapses back into the orb |
| Orb idle | Gradient angle drift, 12s linear infinite |

`@media (prefers-reduced-motion: reduce)` → all durations 0 except opacity fades at 120ms; orb drift off.

### 9.6 Icons

A built-in set of ~20 inline SVG icons (1.5px stroke, 20px grid, rounded caps): `chat, phone, mail, calendar, quote, pin, clock, wrench, heart, info, book, arrow-right, arrow-left, close, send, menu, sound, sound-off, check, external`. Referenced by name in config. No icon font, no external requests.

---

## 10. Setup and deploy

### 10.1 `scripts/setup.sh`

Interactive, idempotent, safe to re-run.

1. Check prerequisites: Node ≥ 20, pnpm, and wrangler (install if missing).
2. `wrangler login` if not authenticated (or use `CLOUDFLARE_API_TOKEN` if set).
3. Copy `murmur.config.example.ts` → `murmur.config.ts` if absent; prompt for site id, allowed origin, connector type.
4. Create the KV namespace if it doesn't exist; write its id into `wrangler.toml`.
5. Generate `MURMUR_SECRET` (32 random bytes) and set it with `wrangler secret put`.
6. Prompt for each secret the chosen connector and sinks declare (from their option schemas' `{ env }` refs) and set them with `wrangler secret put`. Never echo secrets.
7. Build protocol → widget → server; deploy.
8. Print the embed snippet with the real Worker URL.

### 10.2 Local development

- `pnpm dev` runs `wrangler dev` for the server and Vite for the widget demo page concurrently, with the demo pointed at the local server and the `echo` connector.
- `demo/index.html` contains a control panel: switch sites, toggle dark mode, trigger `Murmur.*` API calls, simulate mobile width.

---

## 11. Testing

| Layer | Tooling | What |
| --- | --- | --- |
| Protocol | Vitest | Schema accepts valid and rejects invalid fixtures for every message and action type |
| Widget store | Vitest | Every state-machine transition, persistence restore, expiry, tab sync |
| Widget markdown | Vitest | XSS fixtures (`javascript:` links, raw HTML, nested brackets) all neutralised |
| Server | Vitest + `@cloudflare/vitest-pool-workers` | Origin rejection, token tamper/expiry, every rate limit, captcha failure, sanitize dropping bad connector output, error envelope shape |
| Connectors | Vitest with injected `fetch` mocks | Request shapes, marker parsing, tool-call mapping, error mapping |
| E2E | Playwright against `pnpm dev` + echo | Open → form → chat → options → card → flow → refresh restores → reset; mobile viewport; keyboard-only run |
| Isolation | Playwright | Widget embedded in hostile fixture pages: aggressive global CSS (`* { all: unset }`, `html { font-size: 10px }`, `button { display: none }`), a page running React 18, a page with jQuery and prototype-patching libraries, a strict-CSP page, a Next.js app with client-side navigation, and the same script tag included twice. The widget must look and behave identically in all of them, and the host page must be visually and functionally unchanged |
| Fail-safe | Vitest + Playwright | Each fatal condition in §8.3 individually forced — missing `data-site`, /config 404 / timeout / malformed body, `app.js` import failure, `attachShadow` absent, a throw during mount, two render errors. Each must leave the DOM clean, `window.Murmur` callable and inert, the console silent, and the host page unaffected. Separately: recoverable send failures must NOT hide the widget or lose the typed message |
| Budgets | CI script | Fail the build if loader > 4 kb gz or app > 35 kb gz |

CI (GitHub Actions): lint, typecheck, unit, e2e, isolation, fail-safe, size check on every PR.

---

## 12. Milestones

Build strictly in order. Each milestone ends in a working, demoable state.

### M1 — Protocol and server skeleton
- `protocol` package complete with Zod schemas and fixtures.
- Server: config loading, registry, token signing, origin check, error envelope, `/config` and `/sessions` routes.
- `echo` connector.
- ✅ Done when: `curl` can start a session and exchange messages with echo; tampered tokens and wrong origins are rejected.

### M2 — Widget core
- Loader + lazy app, Shadow DOM, tokens, launcher orb, panel, state machine, persistence.
- Home screen (title only), lead form, thread with `text`/`notice`, composer, typing indicator, markdown renderer.
- Hostile-page fixtures and the isolation test suite (§11).
- Fail-safe layer (§8.3): hide-on-fatal, error boundary, bounded timeouts, and the fail-safe test suite.
- ✅ Done when: full conversation with echo works on the demo page, survives refresh, meets size budgets, and passes every isolation and fail-safe test — including a run with the server deliberately switched off, which must leave the page looking untouched.

### M3 — Retell connector + security hardening
- Retell connector (text only first, then markers, then tool calls).
- Rate limits, daily quota, Turnstile, IP hashing.
- `webhook` sink.
- `setup.sh`.
- ✅ Done when: deployed to a real Worker, embedded on the Knowtific Next.js site via `next/script`, surviving client-side navigation, and a real lead reaches the webhook.

### M4 — Rich interaction
- `options`, `card`, `carousel`, `links`, `form` messages.
- Home shortcut tiles, help links, composer shortcut bar, `paths` filtering.
- Client-side flows.
- ✅ Done when: every echo command renders correctly and a Retell agent can trigger options via tool call.

### M5 — Polish
- Full motion spec, orb animation, teaser, sound, dark mode, header menu.
- Accessibility pass (keyboard, screen reader on VoiceOver + NVDA, contrast).
- Mobile pass on real iOS and Android devices.
- `window.Murmur` API and event hooks.
- ✅ Done when: Lighthouse on the host page is unchanged (±1), and axe reports no violations.

### M6 — Open-source readiness
- `http` and `openai` connectors, `supabase` sink.
- Docs: README (30-second quick start, screenshots/GIF), `protocol.md`, `connectors.md` with the reference receiver, `theming.md`, `self-hosting.md`.
- Examples: `examples/n8n`, `examples/python-fastapi` receivers for the `http` connector.
- CONTRIBUTING, issue templates, MIT licence, changeset-based versioning, npm publish for `@murmur/protocol` and the widget.
- ✅ Done when: a developer who has never seen the project can go from clone to a working widget on their own site in under 15 minutes following the README.

---

## 13. Instructions for Claude Code

- Read this whole document before writing code. Build milestones in order; don't start M(n+1) until M(n)'s done criteria pass.
- TypeScript `strict: true` everywhere. No `any` in protocol or connector interfaces.
- The `protocol` package is the single source of truth. The widget and server import from it; never redeclare message types.
- Dependency budget for the widget: `preact` only (plus `preact/hooks`). No state library, CSS framework, markdown library, icon library, or animation library. Ask before adding any runtime dependency to the widget.
- Server dependencies: `hono`, `zod`. Ask before adding others.
- No `console.log` in shipped bundles; the server uses the injected `log`.
- Never `dangerouslySetInnerHTML` except in the markdown renderer, whose output is built from escaped text and allowlisted tags only, and is covered by XSS tests.
- For the Retell connector, fetch and read the current Retell API documentation first; do not invent endpoint or field names. Same for Turnstile siteverify.
- After each milestone, run the full test suite and the size check, and update `docs/` for anything user-visible that changed.
- When a design detail here conflicts with accessibility, accessibility wins.
- §8.3 outranks every other section. Build the fail-safe layer as part of the widget's skeleton in M2, not as a later hardening pass — retrofitting try/catch boundaries and an error boundary onto a finished widget never catches everything.
- Prefer a missing feature over a thrown exception. When a value is absent or malformed anywhere in the widget, apply the documented default and carry on; only genuinely unrecoverable conditions hide the widget.
