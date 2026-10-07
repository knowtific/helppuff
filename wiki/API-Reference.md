<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# API reference

Every endpoint of the HelpPuff API, one page per area. Each has a curl command and a TypeScript `fetch` call you can paste, the parameters and body fields, an example response with its type, and the errors. For keys, scopes, conventions and a quickstart, see [[The API|API]]. The same description, as OpenAPI 3.1 (for Postman, Insomnia or a client generator), is at `/api/v1/openapi.json` on your Worker.

## Setup

The examples read two environment variables:

```bash
export HELPPUFF_URL="https://knowtific-helppuff-<site>.<you>.workers.dev"   # your Worker
export HELPPUFF_API_KEY="hp_live_…"                                         # from Settings → API keys
```

The TypeScript examples use `fetch` (Node 18+, Deno, Bun, Workers) and these shared types:

```ts
/** A message, as the widget's protocol defines it (see the Protocol page). */
type Message =
  | { id: string; ts: number; role: 'agent' | 'user' | 'system'; type: 'text'; text: string }
  | { id: string; ts: number; role: 'agent'; type: 'options'; text?: string; options: { label: string; value: string }[]; multi?: boolean }
  | { id: string; ts: number; role: 'agent'; type: 'card'; title: string; body?: string; image?: { src: string; alt: string }; actions?: unknown[] }
  | { id: string; ts: number; role: 'agent'; type: 'carousel'; cards: unknown[] }
  | { id: string; ts: number; role: 'agent'; type: 'links'; title?: string; links: { label: string; url: string; description?: string }[] }
  | { id: string; ts: number; role: 'agent'; type: 'form'; title?: string; fields: unknown[]; submitLabel?: string }
  | { id: string; ts: number; role: 'agent' | 'system'; type: 'notice'; text: string; tone?: 'info' | 'warning' | 'error' };

/** Every error has this shape, with the HTTP status. */
type ApiError = {
  error: {
    code: 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'quota_exceeded' | 'connector_error' | 'internal';
    /** Safe to show to a person. */
    message: string;
    /** Seconds to wait, on 429. */
    retryAfter?: number;
  };
};
```

## Errors every endpoint can return

Errors are JSON in the `ApiError` shape above. `message` is safe to show to a person.

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | The body or a parameter is invalid; `message` says which. |
| 401 | `unauthorized` | No key, or a key that is unknown, revoked or expired. |
| 403 | `forbidden` | The key lacks this route's scope, belongs to another site, or is used from an address it does not allow. |
| 404 | `not_found` | No such record (or it belongs to another site). |
| 429 | `rate_limited` | Over the key's requests a minute. Wait `retryAfter` seconds (also in `Retry-After`). |

## Areas

### [[Account|API-Reference-Account]]

Who the key is, and the API description itself.

- [[Who is calling|API-Reference-Account#who-is-calling]]: `GET /me`

### [[Chat|API-Reference-Chat]]

Talk to the assistant as a visitor, from your own server: start a conversation, send messages (JSON or streamed), close it.

- [[Start a conversation|API-Reference-Chat#start-a-conversation]]: `POST /conversations`
- [[Send a message|API-Reference-Chat#send-a-message]]: `POST /conversations/:id/messages`
- [[Close a conversation|API-Reference-Chat#close-a-conversation]]: `POST /conversations/:id/end`

### [[Conversations|API-Reference-Conversations]]

Read, summarise and delete conversations, from the widget and the API alike.

- [[List conversations|API-Reference-Conversations#list-conversations]]: `GET /conversations`
- [[Get a conversation|API-Reference-Conversations#get-a-conversation]]: `GET /conversations/:id`
- [[Summarise a conversation|API-Reference-Conversations#summarise-a-conversation]]: `POST /conversations/:id/summary`
- [[Delete a conversation|API-Reference-Conversations#delete-a-conversation]]: `DELETE /conversations/:id`

### [[Leads|API-Reference-Leads]]

The people who gave contact details: your CRM. Keyed by email per site.

- [[List leads|API-Reference-Leads#list-leads]]: `GET /leads`
- [[Create a lead|API-Reference-Leads#create-a-lead]]: `POST /leads`
- [[Get a lead|API-Reference-Leads#get-a-lead]]: `GET /leads/:id`
- [[Update a lead|API-Reference-Leads#update-a-lead]]: `PATCH /leads/:id`
- [[Delete a lead|API-Reference-Leads#delete-a-lead]]: `DELETE /leads/:id`
- [[Export leads as CSV|API-Reference-Leads#export-leads-as-csv]]: `GET /leads.csv`

### [[Callbacks|API-Reference-Callbacks]]

Visitors who asked to be called back, as tasks.

- [[List callback requests|API-Reference-Callbacks#list-callback-requests]]: `GET /callbacks`
- [[Update a callback request|API-Reference-Callbacks#update-a-callback-request]]: `PATCH /callbacks/:id`

### [[Knowledge|API-Reference-Knowledge]]

What the assistant knows: the website it learned, uploaded files, hand-written knowledge and business details.

- [[Knowledge base status|API-Reference-Knowledge#knowledge-base-status]]: `GET /knowledge/status`
- [[Find the website pages|API-Reference-Knowledge#find-the-website-pages]]: `POST /knowledge/discover`
- [[Learn the website|API-Reference-Knowledge#learn-the-website]]: `POST /knowledge/crawl`
- [[Cancel a crawl|API-Reference-Knowledge#cancel-a-crawl]]: `POST /knowledge/runs/:id/cancel`
- [[List learned pages|API-Reference-Knowledge#list-learned-pages]]: `GET /knowledge/pages`
- [[Chunks of a page|API-Reference-Knowledge#chunks-of-a-page]]: `GET /knowledge/pages/:id/chunks`
- [[Search the knowledge base|API-Reference-Knowledge#search-the-knowledge-base]]: `POST /knowledge/search`
- [[Suggest starter questions|API-Reference-Knowledge#suggest-starter-questions]]: `POST /knowledge/suggest-questions`
- [[List hand-written knowledge|API-Reference-Knowledge#list-hand-written-knowledge]]: `GET /knowledge/manual`
- [[Add or replace hand-written knowledge|API-Reference-Knowledge#add-or-replace-hand-written-knowledge]]: `POST /knowledge/manual`
- [[Remove hand-written knowledge|API-Reference-Knowledge#remove-hand-written-knowledge]]: `DELETE /knowledge/manual/:id`
- [[List uploaded files|API-Reference-Knowledge#list-uploaded-files]]: `GET /knowledge/files`
- [[Upload a file|API-Reference-Knowledge#upload-a-file]]: `POST /knowledge/files`
- [[Remove an uploaded file|API-Reference-Knowledge#remove-an-uploaded-file]]: `DELETE /knowledge/files/:id`
- [[Business details|API-Reference-Knowledge#business-details]]: `GET /knowledge/facts`
- [[Set business details|API-Reference-Knowledge#set-business-details]]: `PUT /knowledge/facts`
- [[Read business details from the site|API-Reference-Knowledge#read-business-details-from-the-site]]: `POST /knowledge/facts/detect`

### [[Prompt|API-Reference-Prompt]]

The business-specific instructions, versioned.

- [[The prompt and its versions|API-Reference-Prompt#the-prompt-and-its-versions]]: `GET /prompt`
- [[One prompt version|API-Reference-Prompt#one-prompt-version]]: `GET /prompt/versions/:version`
- [[Publish a prompt version|API-Reference-Prompt#publish-a-prompt-version]]: `POST /prompt`
- [[Restore a prompt version|API-Reference-Prompt#restore-a-prompt-version]]: `POST /prompt/restore`

### [[Settings|API-Reference-Settings]]

The assistant, widget, lead form, limits and IP lists, as one object.

- [[The settings|API-Reference-Settings#the-settings]]: `GET /settings`
- [[Change settings|API-Reference-Settings#change-settings]]: `PUT /settings`

### [[Webhooks|API-Reference-Webhooks]]

Endpoints that receive events as signed JSON.

- [[List webhook endpoints|API-Reference-Webhooks#list-webhook-endpoints]]: `GET /webhooks`
- [[Add a webhook endpoint|API-Reference-Webhooks#add-a-webhook-endpoint]]: `POST /webhooks`
- [[Change a webhook endpoint|API-Reference-Webhooks#change-a-webhook-endpoint]]: `PATCH /webhooks/:id`
- [[Remove a webhook endpoint|API-Reference-Webhooks#remove-a-webhook-endpoint]]: `DELETE /webhooks/:id`
- [[Send a test event|API-Reference-Webhooks#send-a-test-event]]: `POST /webhooks/:id/test`
- [[Recent deliveries|API-Reference-Webhooks#recent-deliveries]]: `GET /webhooks/:id/deliveries`

### [[Analytics|API-Reference-Analytics]]

Totals, usage and the running version.

- [[Totals over a period|API-Reference-Analytics#totals-over-a-period]]: `GET /overview`
- [[AI usage by day|API-Reference-Analytics#ai-usage-by-day]]: `GET /usage`
- [[Running version|API-Reference-Analytics#running-version]]: `GET /version`
- [[Check the widget is on the website|API-Reference-Analytics#check-the-widget-is-on-the-website]]: `GET /install-check`

### [[Team|API-Reference-Team]]

Who can sign in to the dashboard.

- [[List dashboard accounts|API-Reference-Team#list-dashboard-accounts]]: `GET /admins`
- [[Add a dashboard account|API-Reference-Team#add-a-dashboard-account]]: `POST /admins`
- [[Remove a dashboard account|API-Reference-Team#remove-a-dashboard-account]]: `DELETE /admins/:email`
- [[Make a one-time sign-in link|API-Reference-Team#make-a-one-time-sign-in-link]]: `POST /admins/:email/sign-in-link`

### [[API keys|API-Reference-API-Keys]]

Keys for this API.

- [[List API keys|API-Reference-API-Keys#list-api-keys]]: `GET /keys`
- [[Create an API key|API-Reference-API-Keys#create-an-api-key]]: `POST /keys`
- [[Revoke an API key|API-Reference-API-Keys#revoke-an-api-key]]: `DELETE /keys/:id`

### [[Audit|API-Reference-Audit]]

What changed, when, and who (or which key) changed it.

- [[Audit log|API-Reference-Audit#audit-log]]: `GET /audit`
