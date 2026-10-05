# Webhooks

Send what happens on the assistant to other tools as it happens: Zapier, Make,
n8n, a CRM, a Slack bot, your own server. Add endpoints in the dashboard
(**Settings → Webhooks**) or from the terminal:

```bash
murmur webhooks add https://hooks.zapier.com/hooks/catch/123/abc --events lead.captured,callback.requested
murmur webhooks test wh_1a2b3c      # sends a test.ping and prints what came back
murmur webhooks list --json         # includes each signing secret
murmur webhooks events              # every event type
```

Each endpoint gets every event, or only the ones you pick. Up to 10 per site,
`https://` only. They are stored on your Worker (D1 `webhooks`), not in
murmur.json. The older `leads.webhook` in murmur.json still works, for
leads only; see [[Leads]].

## Events

| Event | When | `data` |
| --- | --- | --- |
| `conversation.started` | A visitor opened a chat | `conversationId`, `page` `{url,title,referrer,utm}`, `locale`, `country`, `form` (pre-chat form fields or null), `firstMessage` |
| `message.received` | A visitor sent a message (including the pre-chat form's message) | `conversationId`, `kind` (`text` or `action`), `text`, `action` `{id,value}` for a button or form |
| `message.sent` | The assistant replied | `conversationId`, `text` (the reply as plain text), `messages` (the rich messages as the widget showed them) |
| `lead.captured` | Contact details arrived: the form, typed in the chat, or found by the assistant | `conversationId`, `source` (`form`, `chat`, `ai`), `name`, `email`, `phone`, `fields` (custom form fields), `message` |
| `callback.requested` | The visitor asked to be called back | `conversationId`, `name`, `email`, `phone`, `message` |
| `lead.updated` | A lead's status, notes or name changed in the dashboard | `leadId`, `conversationId`, `changed`, `lead` |
| `feedback.received` | A visitor rated a reply | `conversationId`, `messageId`, `rating` (`up`, `down`, `cleared`) |
| `conversation.summarized` | The dashboard summarised a chat | `conversationId`, `summary`, `intent`, `sentiment`, `followUp` |
| `conversation.ended` | The visitor ended the chat | `conversationId` |
| `knowledge.crawl.finished` | Learning the website finished | `runId`, `status`, `trigger`, `pages` `{learned,failed}`, `passages` |
| `knowledge.file.processed` | An uploaded file was learned, or failed | `fileId`, `name`, `status` (`indexed` or `error`), `passages`, `truncated`, `error` |
| `test.ping` | **Send test** in the dashboard, or `murmur webhooks test` | `message` |

A lead is a person keyed by email: `lead.captured` can arrive more than once
for the same person (the form, then a phone number typed later). Upsert on
`email` in your CRM.

## The request

```http
POST /your/endpoint
Content-Type: application/json
User-Agent: Murmur-Webhooks/1
X-Murmur-Event: lead.captured
X-Murmur-Delivery: evt_4f0c…
X-Murmur-Timestamp: 1791234567
X-Murmur-Signature: sha256=9a1b…

{
  "id": "evt_4f0c…",
  "type": "lead.captured",
  "createdAt": "2026-10-05T01:02:03.000Z",
  "site": "acme",
  "data": {
    "conversationId": "s_…",
    "source": "form",
    "name": "Ada",
    "email": "ada@example.com",
    "phone": "0412 345 678",
    "fields": { "suburb": "Lilydale" },
    "message": "Do you work weekends?"
  }
}
```

Answer with any 2xx. A timeout (8 seconds), 429 or 5xx is retried once after a
second and a half; anything else is not. The dashboard keeps the last 50
deliveries of each endpoint (**Recent deliveries**), with the status and how
long it took. Nothing about a delivery ever reaches the visitor: events are
sent after their reply.

## Checking a delivery came from us

The signature is the hex HMAC-SHA256, with the endpoint's signing secret, of
the timestamp, a dot, and the raw body. Check it against the raw bytes before
parsing, reject a timestamp more than five minutes old, and skip an `id` you
have already handled (a retry after a timeout can repeat one).

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, headers, rawBody) {
  const timestamp = headers['x-murmur-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const given = headers['x-murmur-signature'] ?? '';
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

```python
import hashlib, hmac, time

def verify(secret: str, headers, raw_body: bytes) -> bool:
    timestamp = headers["X-Murmur-Timestamp"]
    if abs(time.time() - int(timestamp)) > 300:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, headers.get("X-Murmur-Signature", ""))
```

**New secret** in the dashboard (or `PATCH /admin/api/webhooks/:id` with
`{"rotateSecret": true}`) replaces it at once.

## Privacy

Deliveries carry what visitors typed and their contact details, to endpoints
you chose. That is why only `https://` is accepted. Murmur's own logs record
only the event type and HTTP status of a failed delivery, never the payload.
