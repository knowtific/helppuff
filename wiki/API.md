# The API

Everything HelpPuff does is available over HTTPS, so you can use it as a
backend only, without the widget or the dashboard:

- **Chat**: start a conversation from your own server or app, send the
  visitor's messages, get the assistant's replies (as JSON or streamed). The
  same assistant, knowledge base, limits, lead capture, summaries and webhooks
  as the widget.
- **CRM**: leads (create, update, export, delete, "forget me"), callback
  requests, conversations.
- **Everything else**: the knowledge base, the prompt, settings, webhooks,
  analytics, the team, API keys and the audit log.

This page explains keys, conventions and the main flows. **[[API reference|API-Reference]]**
lists every endpoint with a curl command, the request, an example response and
its errors. The same description, as OpenAPI 3.1 (for Postman, Insomnia or a
client generator), is at `https://<your worker>/api/v1/openapi.json`.

## Quickstart

1. **Make a key.** Dashboard → Settings → **API keys** → New key, or:

   ```bash
   helppuff keys create "My backend" --preset chat
   ```

   Copy it: it is shown once.

2. **Start a conversation** (your Worker's address is in `helppuff status`, or
   Settings → API keys):

   ```bash
   export HELPPUFF_URL="https://knowtific-helppuff-acme.you.workers.dev"
   export HELPPUFF_API_KEY="hp_live_…"

   curl -X POST "$HELPPUFF_URL/api/v1/conversations" \
     -H "Authorization: Bearer $HELPPUFF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"message": "Do you work weekends?", "contact": {"name": "Ada", "email": "ada@example.com"}}'
   ```

   ```json
   {
     "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
     "messages": [{ "id": "m_mfx2k1", "ts": 1760000000000, "role": "agent", "type": "text", "text": "Yes, Saturdays 8am to noon…" }],
     "externalId": null,
     "metadata": null
   }
   ```

3. **Continue it** with the `id`:

   ```bash
   curl -X POST "$HELPPUFF_URL/api/v1/conversations/1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10/messages" \
     -H "Authorization: Bearer $HELPPUFF_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"text": "Great, can someone come this Saturday?"}'
   ```

The conversation, the lead (Ada) and any callback request appear in the
dashboard and go to your webhooks, as if Ada had used the widget.

### JavaScript

```js
const base = `${process.env.HELPPUFF_URL}/api/v1`;
const headers = { Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json;
}

const chat = await call('POST', '/conversations', { message: 'Do you work weekends?', externalId: 'user-123' });
const next = await call('POST', `/conversations/${chat.id}/messages`, { text: 'Can someone come Saturday?' });
console.log(next.messages.map((m) => m.text).join('\n'));
```

### Python

```python
import os, requests

base = os.environ["HELPPUFF_URL"] + "/api/v1"
headers = {"Authorization": f"Bearer {os.environ['HELPPUFF_API_KEY']}"}

chat = requests.post(f"{base}/conversations", json={"message": "Do you work weekends?"}, headers=headers).json()
reply = requests.post(f"{base}/conversations/{chat['id']}/messages", json={"text": "Can someone come Saturday?"}, headers=headers)
reply.raise_for_status()
print([m.get("text") for m in reply.json()["messages"]])
```

## Keys

Make keys in the dashboard (**Settings → API keys**) or with the CLI
(`helppuff keys create|list|revoke`). Each key:

- works on **one site** (a deployment made by the CLI has exactly one);
- has **scopes**: what it may do (below). Presets: **Chat only**, **CRM**,
  **Read-only**, **Full access**;
- may **expire** (30 days, 90 days, a year, or never), may be limited to
  **IP addresses or ranges**, and has its own **requests a minute** (default
  120, `security.limits.apiRequestsPerKeyPerMinute`);
- looks like `hp_live_k7m3p9q2r4s8_…`. The part up to the second `_` is its
  public id, shown in lists; the rest is the secret.

Send it on every request, in the header and nowhere else:

```
Authorization: Bearer hp_live_k7m3p9q2r4s8_…
```

A key in the URL (`?api_key=…`) is refused: URLs end up in logs.

### Scopes

| Scope | Lets the key |
| --- | --- |
| `chat` | Talk to the assistant as a visitor: start conversations, send messages, close them |
| `conversations:read` / `:write` | Read conversations and messages / summarise and delete them |
| `leads:read` / `:write` | Read and export leads / create, update and delete them |
| `callbacks:read` / `:write` | Read callback requests / mark them done or dismissed |
| `knowledge:read` / `:write` | Read pages, files, facts and search / crawl, upload, add knowledge, correct facts |
| `prompt:read` / `:write` | Read the prompt and its versions / publish and restore |
| `settings:read` / `:write` | Read / change the settings |
| `webhooks:read` / `:write` | Read / add, change, test and remove webhook endpoints |
| `analytics:read` | The overview, usage and the running version |
| `team:read` / `:write` | Read / add and remove dashboard accounts, make sign-in links |
| `keys:read` / `:write` | Read / create and revoke API keys |
| `audit:read` | Read the audit log |

`:write` includes `:read`. A key can never create a key with scopes it does
not have itself. `team:write` and `keys:write` can give access to others:
treat a key that has them like a password to the dashboard.

### Keeping keys safe

- **Server only.** Never put a key in a web page or a mobile app: anyone can
  read it there. The API sends no CORS headers, so browsers cannot call it.
  For your own chat UI in a browser, see [[a custom frontend|API#a-custom-frontend]].
- **Shown once, stored hashed.** HelpPuff keeps only a keyed hash
  (HMAC-SHA-256, keyed from your Worker's `HELPPUFF_SECRET`, which is not in
  the database). A copy of the database cannot be used to call the API, and a
  lost key cannot be recovered: revoke it and make another.
- **Rotate** by making a new key, switching your server to it, then revoking
  the old one. A revoked key is refused everywhere within 30 seconds.
- **Least privilege**: give each integration its own key with only the scopes
  it needs, an expiry, and the IP addresses it calls from when you know them.
- **Audit**: every change made with a key (and in the dashboard) is in the
  audit log, with the key's id: `GET /audit`.
- Rotating `HELPPUFF_SECRET` invalidates every API key (and signs everyone
  out). Make new keys afterwards.

The CLI and agents can also use the deployment's own `ADMIN_API_KEY` (in your
project's `.env`), which has full access: `helppuff api GET /leads`.

## Chat as a backend

`POST /conversations` starts a conversation as a visitor would, and
`POST /conversations/{id}/messages` continues it. What is the same as the
widget: the assistant, its instructions and knowledge, rich messages, lead
capture (from `contact` and from what the visitor types), callback requests,
summaries, webhooks, the per-conversation and daily caps. What differs:
there is no Origin check or Turnstile (the key is the proof), and the key's
own rate replaces the per-visitor limits.

- **Who the visitor is**: `contact` (`name`, `email`, `phone`, any other
  fields) becomes a lead, or joins the existing lead with that email.
  `externalId` is your own id for the conversation or visitor
  (`GET /conversations?externalId=…` finds it again); `metadata` is stored and
  returned, never shown to the assistant.
- **Where they are**: `context` (`pageUrl`, `pageTitle`, `locale`,
  `timezone`, `utm`) is what the widget would send.
- **Rich replies**: messages are the widget's protocol objects (`text`,
  `options`, `card`, `carousel`, `links`, `form`, `notice`; see
  [[Protocol]]). Render what you support; show `text` otherwise.
- **Answering a rich message**: send `{"action": {"id": "<message or action id>", "value": "…"}}`.
  A form's answers go in `value` as a JSON object string, and are accepted
  only for a form this conversation was shown.
- **Streaming**: send `Accept: text/event-stream`. You get `delta` events
  (`{"text": "…"}`) as the reply is written, then one `done` event with the
  same body the JSON answer has (or an `error` event). Backends that cannot
  stream answer with plain JSON.
- **Ending**: `POST /conversations/{id}/end` (sends `conversation.ended`).
  Conversations also complete on their own 5 minutes after the last message
  (`conversation.completed`, with the summary).
- **Async work**: use [[Webhooks]] (`lead.captured`, `callback.requested`,
  `conversation.completed` …) instead of polling.

### A custom frontend

To build your own chat UI in a browser, keep the key on your server and let
your server make the calls: your frontend talks to your server, your server
to HelpPuff. (A short-lived browser token for your own frontend is planned.)

## Conventions

- **Base URL**: `https://<your worker>/api/v1`. JSON in, JSON out (UTF-8).
  Times are milliseconds since the epoch (UTC).
- **Site**: a key always works on its own site; `site` in a body or query is
  optional, and another site's value is refused (403).
- **Lists**: `GET /conversations` and `GET /audit` page with a cursor: pass
  the answer's `next` as `before`. Other lists return up to 500 items with
  counts.
- **Errors**: always `{"error": {"code", "message", "retryAfter?"}}` with the
  HTTP status. `message` is safe to show a person. Codes: `bad_request` 400,
  `unauthorized` 401, `forbidden` 403, `not_found` 404, `conflict` 409,
  `rate_limited` 429, `quota_exceeded` 429 (a cap, until midnight UTC or a new
  conversation), `connector_error` 502 (the AI backend failed: retry),
  `internal` 500.
- **Rate limits**: each response has `X-RateLimit-Limit` and
  `X-RateLimit-Remaining` (requests a minute for the key); a 429 has
  `Retry-After` in seconds. Refused requests count too.
- **Request ids**: every response has `X-Request-Id`; quote it when asking
  for help.
- **Size**: JSON bodies up to 1 MB; file uploads up to 10 MB.
- **Versioning**: `/api/v1` only grows: new endpoints, new fields, new enum
  values. Ignore fields you do not know. A breaking change would come as
  `/api/v2`, announced in the changelog.

## Limits

| Limit | Default | Setting |
| --- | --- | --- |
| Requests a minute, per key | 120 | per key, default `security.limits.apiRequestsPerKeyPerMinute` |
| Active keys per site | 50 | `security.limits.apiKeysPerSite` |
| Messages per conversation | 60 | `security.limits.messagesPerSession` |
| Messages a day, whole site | 500 | `security.limits.messagesPerSitePerDay` (shared with the widget) |
| Message length | 1000 | `security.limits.maxMessageLength` |

All are on Settings → Advanced; see [[Security|Security#every-limit]].

## From the command line

```bash
helppuff keys create "CRM sync" --scopes leads:read,leads:write --expires 90 --save HELPPUFF_CRM_KEY
helppuff keys list
helppuff keys revoke k7m3p9q2r4s8
helppuff api GET /leads
helppuff api POST /conversations --data '{"message": "Do you work weekends?"}'
```

`helppuff api` calls any endpoint with the project's admin key; see
[[CLI reference|CLI-Reference]].
