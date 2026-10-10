# Tutorial: send chats to your CRM

A renovation company's assistant collects what a visitor wants done during
the chat. When the chat ends, it sends the contact, the project details and
an AI summary to an [n8n](https://n8n.io) workflow (or a
[Zapier](https://zapier.com) Zap), which creates or updates the contact in
HubSpot and adds a note. Nobody types anything into the CRM.

```text
Visitor    We're thinking of redoing our kitchen.
Assistant  Lovely. Which suburb is the house in?
Visitor    Brunswick
Assistant  And do you have a budget range in mind?
Visitor    Around 40 to 50k
Assistant  When would you like to start?
Visitor    After Christmas
Assistant  A kitchen in Brunswick, $40–50k, starting after Christmas. Can we book a free
           measure and quote? The team can call you this week.
```

Five minutes after the last message, HubSpot has:

```text
Contact   Ada Lovelace · ada@example.com · 0400 111 222
Note      Kitchen renovation in Brunswick, budget $40–50k, start after Christmas.
          Summary: Ada wants a kitchen renovation and agreed to a free measure.
          Lead quality: hot · Follow-up: call this week to book the measure.
```

**What it teaches:** extract tools, an after-chat tool and its payload, and
n8n or Zapier as the glue to any CRM.

**Template:** `crm-sync` ([[import it|Tutorials#use-a-template]]). It also
sets the pre-chat form to name, email and phone, so every chat has a contact
to match in HubSpot.

## How it works

```text
During the chat                         When it ends (5 quiet minutes)
project_details (extract) ──saves──▶    crm_sync (after) ──POST──▶ n8n / Zapier ──▶ HubSpot
service, suburb, budget, start          contact + details + summary     contact + note
```

## 1. Collect the details: an extract tool

```bash
helppuff tools add project_details --extract \
  --field service='Kitchen, bathroom, laundry, extension or other.' \
  --field suburb='Where the work is.' \
  --field budget='Their budget range, as they said it.' \
  --field start='When they would like to start.' \
  --description 'Save the details of the renovation the visitor wants, as soon as they give each one.'
```

Each field is saved as the visitor gives it, on the conversation and as a
**custom attribute** (`service: kitchen`). Your team sees them on the
conversation, and they are in the after-chat payload as `attributes`.

Only `service` is required in the template: the assistant saves what it has
and asks for the rest, but a visitor who won't say a budget is still a lead.

## 2. The prompt

```text
## Project enquiries
When a visitor describes a renovation they want done, find out, one question at a time and only what you don't know yet:
- the service (kitchen, bathroom, laundry, extension or other);
- the suburb;
- their budget range;
- when they would like to start.
Save each answer with {{project_details}} as soon as they give it. Then sum it up in one sentence and offer a free measure and quote from the team.

If they ask for a price, say every renovation is quoted after a free measure, and offer to book one.
```

- **"One question at a time and only what you don't know yet"**: a visitor
  who opens with "a kitchen in Brunswick" is asked about the budget next,
  not the suburb again.
- **"As soon as they give it"**: details are saved even if the visitor leaves
  halfway.
- **Sum it up, then the next step**: the summary lets the visitor correct a
  detail before it reaches your CRM.

The after-chat tool is not named in the prompt: it runs by itself when the
chat ends.

## 3. Send it when the chat ends: an after-chat tool

```bash
helppuff tools add crm_sync --after --method POST \
  --url https://your-n8n.example.com/webhook/helppuff-chat \
  --header 'Content-Type: application/json' \
  --header 'X-HelpPuff-Token: ${CRM_WEBHOOK_TOKEN}' \
  --body '{
    "conversationId": "{{conversation.conversationId}}",
    "name": "{{lead.name}}",
    "email": "{{lead.email}}",
    "phone": "{{lead.phone}}",
    "summary": "{{summary}}",
    "leadQuality": "{{conversation.labels.leadQuality}}",
    "followUp": "{{conversation.followUp}}",
    "service": "{{attributes.service}}",
    "suburb": "{{attributes.suburb}}",
    "budget": "{{attributes.budget}}",
    "start": "{{attributes.start}}",
    "page": "{{conversation.page.url}}"
  }' \
  --timeout 10000 \
  --description 'Send the finished conversation to the CRM workflow.'
```

An after-chat tool runs five quiet minutes after the last message (or when
a live chat closes), the same moment as the `conversation.completed`
[[webhook|Webhooks]]. Everything about the conversation is available:

| In the body | What it is |
| --- | --- |
| `{{lead.name}}`, `{{lead.email}}`, `{{lead.phone}}` | The contact, from the pre-chat form or the chat |
| `{{summary}}` | The AI summary (when summaries are on) |
| `{{conversation.labels.leadQuality}}` | The AI's labels: `intent`, `sentiment`, `leadQuality`, `outcome`, `topics` |
| `{{conversation.followUp}}` | What the team should do next, from the summary |
| `{{attributes.service}}` | What the extract tool saved |
| `{{data}}`, `{{transcript}}` | Every tool's data, and the whole transcript (as a list) |

A value that is the whole JSON string (`"{{summary}}"`) is replaced by the
value itself, so an empty one becomes `null`, not `""`. A `POST` with no
body at all sends the whole conversation, if you would rather map it in n8n.

A failed call (a 5xx, a 429, a timeout) is tried again, twice. The token
header lets your workflow refuse anything that is not from HelpPuff.

## 4a. The n8n workflow

1. **Webhook** node: HTTP Method `POST`, Path `helppuff-chat`.
   Authentication **Header Auth**, with a credential whose Name is
   `X-HelpPuff-Token` and Value is your `CRM_WEBHOOK_TOKEN`. Use the
   **Production URL** in the tool (the test URL only listens while you click
   **Listen for test event**).
2. **HubSpot** node: Resource **Contact**, Operation **Create/Update a
   contact**, Email `{{ $json.body.email }}`. Add the first name, phone, and
   your own properties (service, suburb) from `$json.body`.
3. **HubSpot** node: Resource **Engagement**, Operation **Create**, a note on
   the contact from step 2, with a body such as:

```text
{{ $('Webhook').item.json.body.service }} in {{ $('Webhook').item.json.body.suburb }}, budget {{ $('Webhook').item.json.body.budget }}, start {{ $('Webhook').item.json.body.start }}.
Summary: {{ $('Webhook').item.json.body.summary }}
Lead quality: {{ $('Webhook').item.json.body.leadQuality }} · Follow-up: {{ $('Webhook').item.json.body.followUp }}
```

Publish the workflow (activate it) so the production URL listens.

## 4b. Or a Zap

1. Trigger: **Webhooks by Zapier → Catch Hook**. Copy its URL into the
   tool's address. (Zapier's catch hooks have no header check: keep the URL
   private, or add a **Filter** step on the token.)
2. Action: **HubSpot → Create or Update Contact**, mapping email, name and
   phone.
3. Action: **HubSpot → Create Engagement**, type note, on that contact, with
   the details and summary as its body.

## 5. Try it

Have a chat on your site, as a visitor, then wait five minutes.

- `helppuff tools list` shows `crm_sync`'s last status (`200`).
- The conversation in the dashboard shows **Data from tools**, including
  what your workflow answered under `crm_sync`.
- n8n's **Executions** (or Zapier's **Zap history**) shows the request.

To check the workflow is reachable without waiting, test the tool: it sends
the request now, with the conversation's values empty.

```bash
helppuff tools test crm_sync
```

## Webhook or after-chat tool?

Both fire at the same moment. A **webhook** on `conversation.completed`
sends a fixed, signed envelope of everything ([[Webhooks]]). An **after-chat
tool** sends the body you design, with the auth header your workflow
expects, and keeps the answer on the conversation. For one workflow fed by
one assistant, the tool is simpler; for several systems, a webhook each.

Next: [[Nearest store|Tutorial-Nearest-Store]], to use the pre-chat form
before the first answer.
