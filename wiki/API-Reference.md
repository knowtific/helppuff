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
- [[Label a conversation, or set its attributes|API-Reference-Conversations#label-a-conversation-or-set-its-attributes]]: `PATCH /conversations/:id`
- [[Summarise a conversation|API-Reference-Conversations#summarise-a-conversation]]: `POST /conversations/:id/summary`
- [[Delete a conversation|API-Reference-Conversations#delete-a-conversation]]: `DELETE /conversations/:id`

### [[Live chat|API-Reference-Live-Chat]]

A person on the team answers instead of the assistant: reply, take, give, close and hand back a live chat, and see who is available.

- [[Live chat now|API-Reference-Live-Chat#live-chat-now]]: `GET /live/status`
- [[Reply in a live chat|API-Reference-Live-Chat#reply-in-a-live-chat]]: `POST /conversations/:id/reply`
- [[Take a conversation over|API-Reference-Live-Chat#take-a-conversation-over]]: `POST /conversations/:id/takeover`
- [[Take or give a conversation|API-Reference-Live-Chat#take-or-give-a-conversation]]: `POST /conversations/:id/assign`
- [[Close a conversation|API-Reference-Live-Chat#close-a-conversation]]: `POST /conversations/:id/close`
- [[Hand back to the assistant|API-Reference-Live-Chat#hand-back-to-the-assistant]]: `POST /conversations/:id/handback`
- [[Telegram|API-Reference-Live-Chat#telegram]]: `GET /live/telegram`
- [[Connect Telegram|API-Reference-Live-Chat#connect-telegram]]: `POST /live/telegram`
- [[Change Telegram options|API-Reference-Live-Chat#change-telegram-options]]: `PATCH /live/telegram`
- [[Send a Telegram test|API-Reference-Live-Chat#send-a-telegram-test]]: `POST /live/telegram/test`
- [[Disconnect Telegram|API-Reference-Live-Chat#disconnect-telegram]]: `DELETE /live/telegram`

### [[Labels and notes|API-Reference-Labels-And-Notes]]

Labels a site defines and puts on conversations (the AI can too), and the team's private notes on conversations and contacts.

- [[Add a note to a conversation|API-Reference-Labels-And-Notes#add-a-note-to-a-conversation]]: `POST /conversations/:id/notes`
- [[Edit a note|API-Reference-Labels-And-Notes#edit-a-note]]: `PATCH /notes/:id`
- [[Delete a note|API-Reference-Labels-And-Notes#delete-a-note]]: `DELETE /notes/:id`
- [[List labels|API-Reference-Labels-And-Notes#list-labels]]: `GET /labels`
- [[Create a label|API-Reference-Labels-And-Notes#create-a-label]]: `POST /labels`
- [[Change a label|API-Reference-Labels-And-Notes#change-a-label]]: `PATCH /labels/:id`
- [[Delete a label|API-Reference-Labels-And-Notes#delete-a-label]]: `DELETE /labels/:id`
- [[Add a note to a contact|API-Reference-Labels-And-Notes#add-a-note-to-a-contact]]: `POST /leads/:id/notes`

### [[Leads|API-Reference-Leads]]

The people who gave contact details: your CRM's contacts, with custom attributes. Keyed by email per site.

- [[List leads|API-Reference-Leads#list-leads]]: `GET /leads`
- [[Create a lead|API-Reference-Leads#create-a-lead]]: `POST /leads`
- [[Get a lead|API-Reference-Leads#get-a-lead]]: `GET /leads/:id`
- [[Update a lead|API-Reference-Leads#update-a-lead]]: `PATCH /leads/:id`
- [[Delete a lead|API-Reference-Leads#delete-a-lead]]: `DELETE /leads/:id`
- [[Export leads as CSV|API-Reference-Leads#export-leads-as-csv]]: `GET /leads.csv`

### [[Jobs|API-Reference-Jobs]]

Requests, quotes, projects or tickets on the site's pipeline: create them from your own forms and systems, move them through the stages, read their history.

- [[List jobs|API-Reference-Jobs#list-jobs]]: `GET /jobs`
- [[Create a job|API-Reference-Jobs#create-a-job]]: `POST /jobs`
- [[Get a job|API-Reference-Jobs#get-a-job]]: `GET /jobs/:id`
- [[Change a job|API-Reference-Jobs#change-a-job]]: `PATCH /jobs/:id`
- [[Move a job|API-Reference-Jobs#move-a-job]]: `POST /jobs/:id/move`
- [[Add an update|API-Reference-Jobs#add-an-update]]: `POST /jobs/:id/updates`
- [[Add a note to a job|API-Reference-Jobs#add-a-note-to-a-job]]: `POST /jobs/:id/notes`
- [[Delete a job|API-Reference-Jobs#delete-a-job]]: `DELETE /jobs/:id`
- [[The pipeline|API-Reference-Jobs#the-pipeline]]: `GET /jobs/pipeline`
- [[Change the pipeline|API-Reference-Jobs#change-the-pipeline]]: `PUT /jobs/pipeline`
- [[Use another template|API-Reference-Jobs#use-another-template]]: `POST /jobs/pipeline/template`
- [[Let the AI set the pipeline up|API-Reference-Jobs#let-the-ai-set-the-pipeline-up]]: `POST /jobs/setup`

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

### [[Tools|API-Reference-Tools]]

Your own APIs, called before, during and after a chat (`{{name}}` in the prompt), and extract tools that save what the assistant learns. What they return is kept on the conversation (`data`) and sent to webhooks.

- [[List tools|API-Reference-Tools#list-tools]]: `GET /tools`
- [[Add a tool|API-Reference-Tools#add-a-tool]]: `POST /tools`
- [[Change a tool|API-Reference-Tools#change-a-tool]]: `PATCH /tools/:id`
- [[Remove a tool|API-Reference-Tools#remove-a-tool]]: `DELETE /tools/:id`
- [[Test a tool|API-Reference-Tools#test-a-tool]]: `POST /tools/test`

### [[Settings|API-Reference-Settings]]

The assistant, widget, lead form, limits and IP lists, as one object.

- [[Test the model or the knowledge base|API-Reference-Settings#test-the-model-or-the-knowledge-base]]: `POST /assistant/test`
- [[Suggest the home screen|API-Reference-Settings#suggest-the-home-screen]]: `POST /home/suggest`
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
- [[Change a role or name|API-Reference-Team#change-a-role-or-name]]: `PATCH /admins/:email`
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
