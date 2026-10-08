# Webhooks

Send what happens on the assistant to other tools as it happens: Zapier, Make,
n8n, a CRM, a Slack bot, your own server. Add endpoints in the dashboard
(**Settings → Webhooks**) or from the terminal:

```bash
helppuff webhooks add https://hooks.zapier.com/hooks/catch/123/abc --events lead.captured,callback.requested
helppuff webhooks test wh_1a2b3c      # sends a test.ping and prints what came back
helppuff webhooks list --json         # includes each signing secret
helppuff webhooks events              # every event type
```

Each endpoint gets every event, or only the ones you pick. Up to 10 per site,
`https://` only. They are stored on your Worker (D1 `webhooks`), not in
helppuff.json. The older `leads.webhook` in helppuff.json still works, for
leads only; see [[Leads]].

## Events

| Event | When | `data` |
| --- | --- | --- |
| `conversation.started` | A visitor opened a chat | `conversationId`, `page` `{url,title,referrer,utm}`, `locale`, `country`, `form` (pre-chat form fields or null), `firstMessage`, `data` (what [[tools|Tools]] returned before the chat, or null) |
| `message.received` | A visitor sent a message (including the pre-chat form's message) | `conversationId`, `kind` (`text` or `action`), `text`, `action` `{id,value}` for a button or form |
| `message.sent` | The assistant replied, or a person on the team did (live chat) | `conversationId`, `text` (the reply as plain text), `messages` (the rich messages as the widget showed them), `author` `{kind: "human", id, name}` for a person's reply |
| `lead.captured` | Contact details arrived: the form, typed in the chat, or found by the assistant | `conversationId`, `source` (`form`, `chat`, `ai`), `name`, `email`, `phone`, `fields` (custom form fields), `message` |
| `callback.requested` | The visitor asked to be called back: the assistant requested it with the details it had, or the visitor sent the callback form. Sent with `lead.captured`; see [Callbacks](#callbacks) | `callbackId`, `conversationId`, `name`, `email`, `phone`, `message`, `requestedAt` |
| `callback.updated` | A callback request was marked done or dismissed, reopened, or its note changed (dashboard or `helppuff callbacks`) | `callback` (`id`, `conversationId`, `status`, `note`, `name`, `phone`, `email`, `reason`, `closedBy`…), `previousStatus` |
| `lead.updated` | A lead's status, details, notes or attributes changed | `leadId`, `conversationId`, `changed`, `lead` |
| `feedback.received` | A visitor rated a reply | `conversationId`, `messageId`, `rating` (`up`, `down`, `cleared`) |
| `conversation.completed` | A conversation went quiet: **5 minutes after its last message** (a live chat: when it closes). Sent once (again if the visitor comes back later) | `conversationId`, `startedAt`, `lastMessageAt`, `messageCount`, `page`, `country`, `summary`, `labels` `{intent, sentiment, leadQuality, outcome, topics}`, `tags` (the site's own labels on it), `attributes`, `assignedTo`, `unanswered` (questions it could not answer), `followUp`, `lead`, `data` (what the site's [[tools|Tools]] returned or saved, by tool name), `transcript` `[{role, text, at}]` (`role`: `visitor`, `assistant` or `team`) |
| `handover.requested` | A visitor asked for a person ([[Live chat|Live-Chat]]): the team was notified | `conversationId`, `reason`, `page` |
| `handover.missed` | Nobody took a live chat within `live.waitSeconds`: the visitor was offered the callback form | `conversationId` |
| `handover.ended` | A person handed the chat back to the assistant | `conversationId`, `by`, `outcome` |
| `conversation.assigned` | A conversation was taken, given to someone, or unassigned | `conversationId`, `assignedTo` (an email, `telegram:<id>`, or null), `name`, `by` |
| `conversation.closed` | A conversation was closed by the team, or a live chat went quiet for `live.closeAfterMinutes` | `conversationId`, `by`, `reason` (`team` or `idle`), `wasLive` |
| `conversation.summarized` | Someone pressed **Summarise** in the dashboard | `conversationId`, `summary`, `intent`, `sentiment`, `leadQuality`, `outcome`, `topics`, `unanswered`, `followUp` |
| `conversation.ended` | The visitor started a new chat, or the page called `HelpPuff.reset()`. Most visitors just leave, so prefer `conversation.completed` | `conversationId` |
| `job.created` | A [[job|Jobs]] was created: by the assistant, the quote questions, the API or the dashboard | `job` (`id`, `number`, `title`, `stage`, `status`, `fields`, `contact`, `conversationId`, `source`, `value`, `currency`, `dueAt`, `assignedTo`…) |
| `job.updated` | A job's title, details, fields, value, due date or assignee changed (also when a visitor fills in what the assistant asked for) | `job` |
| `job.stage_changed` | A job moved to another stage | `job`, `from`, `to` (stage names) |
| `job.won` | A job moved to a won stage. Sent with `job.stage_changed` | `job` |
| `job.lost` | A job moved to a lost stage. Sent with `job.stage_changed` | `job`, `reason` |
| `budget.warning` | Today's AI budget is 80% used; answers are kept shorter. Once a day | `day`, `neuronsUsed`, `dailyBudget`, `resetsAt` |
| `budget.exhausted` | Today's AI budget is used up; visitors get your contact details and a callback form until `resetsAt`. Once a day | `day`, `neuronsUsed`, `dailyBudget`, `resetsAt` |
| `knowledge.crawl.finished` | Learning the website finished | `runId`, `status`, `trigger`, `pages` `{learned,failed}`, `passages` |
| `knowledge.file.processed` | An uploaded file was learned, or failed | `fileId`, `name`, `status` (`indexed` or `error`), `passages`, `truncated`, `error` |
| `test.ping` | **Send test** in the dashboard, or `helppuff webhooks test` | `message` |

**Which to pick.** For a CRM, a spreadsheet or a team chat, three cover most
needs: `conversation.started` (who, from which page, the pre-chat form),
`callback.requested` (act now) and `conversation.completed` (the summary,
labels and transcript, once the chat is over). The per-message events are
high-volume and mainly for mirroring chats live.

A lead is a person keyed by email: `lead.captured` can arrive more than once
for the same person (the form, then a phone number typed later). Upsert on
`email` in your CRM.

## Callbacks

A callback request is a task with an id: `callback.requested` when it is
made, `callback.updated` when the team works it (see [[Leads|Leads#callbacks]]).
Match the two on **`callbackId`** = **`callback.id`**.

```json
{
  "type": "callback.requested",
  "data": {
    "callbackId": "cb_mfx2k9a1b2c3",
    "conversationId": "s_…",
    "name": "Ada",
    "email": "ada@example.com",
    "phone": "0412 345 678",
    "message": "A quote for two rooms",
    "requestedAt": "2026-10-05T01:02:03.000Z"
  }
}
```

```json
{
  "type": "callback.updated",
  "data": {
    "previousStatus": "open",
    "callback": {
      "id": "cb_mfx2k9a1b2c3",
      "conversationId": "s_…",
      "leadId": "lead_s_…",
      "name": "Ada",
      "phone": "0412 345 678",
      "email": "ada@example.com",
      "reason": "A quote for two rooms",
      "status": "done",
      "note": "Booked a measure for Tuesday",
      "requestedAt": 1791234567000,
      "closedAt": 1791241767000,
      "closedBy": "owner@acme.com",
      "pageUrl": "https://acme.com/flooring"
    }
  }
}
```

- **Asking again in the same chat** while the request is still waiting sends
  `callback.requested` again with the **same `callbackId`** and the latest
  details: update the task, do not create a second one.
- **A new request after one was closed** has a new `callbackId`.
- `status` is `open`, `done` or `dismissed`; `previousStatus` says what it was
  (`open` → `done` is "called back"; `done` → `open` is reopened). A note
  change alone sends `callback.updated` with the same status.
- `message` in `callback.requested` is the same text as `reason` in
  `callback.updated`: what the visitor wants.
- `closedBy` is the dashboard user's email, or `cli` for `helppuff callbacks`.

In Zapier, Make or n8n: create a task (or a CRM activity) on
`callback.requested`, keyed by `callbackId`, and complete it on
`callback.updated` when `callback.status` is `done`.

## The request

```http
POST /your/endpoint
Content-Type: application/json
User-Agent: HelpPuff-Webhooks/1
X-HelpPuff-Event: lead.captured
X-HelpPuff-Delivery: evt_4f0c…
X-HelpPuff-Timestamp: 1791234567
X-HelpPuff-Signature: sha256=9a1b…

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

Answer with any 2xx within 8 seconds. A delivery that fails in a way a retry
could fix (a timeout, a network error, 429 or 5xx) is tried again in the
background, after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, so an
endpoint that is down for a while still gets everything. A 4xx is taken as
the endpoint saying no, and is not retried. The dashboard keeps the last 50
deliveries of each endpoint (**Recent deliveries**: every try, with its status
and timing) and shows "trying again later" while a retry is pending. Nothing
about a delivery ever reaches the visitor: events are sent after their reply.

## Checking a delivery came from us

The signature is the hex HMAC-SHA256, with the endpoint's signing secret, of
the timestamp, a dot, and the raw body. Check it against the raw bytes before
parsing, reject a timestamp more than five minutes old, and skip an `id` you
have already handled (a retry after a timeout can repeat one).

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, headers, rawBody) {
  const timestamp = headers['x-helppuff-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const given = headers['x-helppuff-signature'] ?? '';
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

```python
import hashlib, hmac, time

def verify(secret: str, headers, raw_body: bytes) -> bool:
    timestamp = headers["X-HelpPuff-Timestamp"]
    if abs(time.time() - int(timestamp)) > 300:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, headers.get("X-HelpPuff-Signature", ""))
```

**New secret** in the dashboard (or `PATCH /admin/api/webhooks/:id` with
`{"rotateSecret": true}`) replaces it at once.

## Privacy

Deliveries carry what visitors typed and their contact details, to endpoints
you chose. That is why only `https://` is accepted. HelpPuff's own logs record
only the event type and HTTP status of a failed delivery, never the payload.
