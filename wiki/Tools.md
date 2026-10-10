# Tools

Tools connect the assistant to your own systems. A tool is an HTTP request
to one of your APIs, or an **extract** tool that saves something the visitor
says. Tools run at three points in a chat, and each has its own section on
the dashboard's **Prompt** page:

| When | What happens | Typical use |
| --- | --- | --- |
| **1. Before the chat** | Called when a chat starts, with the pre-chat form's answers. The first answer can already use what it returned. | Look the visitor up in your CRM or shop by their email |
| **2. During the chat** | Name a tool in the prompt as `{{order_status}}`. The assistant calls it when it needs to, filling in what the request asks for, and answers from the result. | Check an order, a booking, stock, a delivery date |
| **3. After the chat** | Called when the conversation ends, with the transcript, the summary, the contact and every tool's data. | Send the conversation to your CRM, help desk or a sheet |

Everything a tool returns or saves is kept on the conversation under the
tool's name:

```json
{ "crm_lookup": { "tier": "gold", "id": 7 }, "order_number": { "order_number": "A-1042" }, "order_status": { "status": "shipped", "eta": "2026-10-12" } }
```

This data shows on the conversation in the dashboard (**Data from tools**). It
goes to [[webhooks|Webhooks]] as `data` (in `conversation.started` and
`conversation.completed`), and to your after-chat tools. The assistant also
sees it on every answer, so it can use a value again later in the chat.

**Learn by example:** four [[tutorials|Tutorials]] (order tracking, sending
chats to a CRM, the nearest store, verified account changes), each with a
template to import.

Tools work with HelpPuff's assistant, whichever model writes the answers
([[Models and providers|Models-and-Providers]]). With a backend that runs the
whole conversation itself (Retell, or your own API), only after-chat tools run.

## Add a tool

On the **Prompt & tools** page (Settings → Prompt & tools), use **+ Add** on
**Before the chat** or **After the chat**, or **+ Add** in the prompt (click
**Prompt** in the diagram) for a tool the assistant calls during the chat;
each menu lists the tools you already have, then **New tool**. Then either:

- **Paste a curl** copied from your API's docs or from Postman
  (Code → cURL). The method, URL, headers and body are filled in.
- **Fill it in** by hand: method, URL, headers and body.

Give the tool a **name** (`order_status`: lowercase letters, digits and `_`)
and a **description**. The assistant reads the description to decide when to
call the tool, so say what it does and when to use it.

**Test** calls the tool now with sample values and shows the response. Tick
the keys to keep (for example `status` and `eta`): only those are stored and
shown to the assistant. With nothing ticked, the whole response is kept, cut
to about 4 KB. The keys from a test also feed the prompt's autocomplete.

In the terminal, `helppuff tools` does the same:

```bash
helppuff tools add order_status \
  --curl 'curl https://api.acme.com/orders/{{args.order_number}} -H "Authorization: Bearer ${ACME_API_KEY}"' \
  --description 'Look up an order by its number: status and delivery date' \
  --param order_number='The order number, like A-1042' --pick status,eta
helppuff tools test order_status --arg order_number=A-1042
```

### Values in the request

Use these anywhere in the URL's path and query, a header, or the body:

| Value | What it is |
| --- | --- |
| `{{args.order_number}}` | Filled in by the assistant when it calls the tool. It asks the visitor first if it does not know the value yet. Describe each one in the dialog (or with `--param`) |
| `{{prechat.email}}` | An answer from the pre-chat form (any field: `{{prechat.name}}`, `{{prechat.company}}`…) |
| `{{data.crm_lookup.id}}` | What another tool returned in this chat |
| `{{page.url}}`, `{{page.title}}` | The page the visitor is chatting from |
| `{{conversation.id}}`, `{{site.id}}` | The conversation and the site |
| After the chat: `{{conversation}}`, `{{transcript}}`, `{{summary}}`, `{{lead}}`, `{{attributes}}`, `{{data}}` | The whole conversation as `conversation.completed` sends it, or one part of it |

Each value is encoded for its place: URL-encoded in the URL, a single line in
a header, and JSON in a JSON body. What a visitor types cannot break out of
its field. A JSON value that is only a placeholder (`"{{data}}"`) is
replaced by the value itself, so it can be an object or a list. An
after-chat `POST` with no body sends the whole conversation as JSON.

The host is fixed: only the path and query may use `{{…}}`. Tools call
`https://` addresses only.

### Keys and secrets

Header values for credentials (`Authorization`, `X-API-Key`, cookies,
anything named like a token, secret or key) are marked **secret**. Secret
values are stored encrypted with your Worker's secret, are never shown again,
and are never returned by the API. To change one, type a new value; leave it
empty to keep the stored one.

In the terminal, write `${NAME}` in a header and the CLI reads the value from
`.env`, so the key is never typed on the command line. If the variable is
missing, the command answers `needs_input` with `helppuff secret set NAME`.

## 1. Before the chat

Add a tool to **Before the chat** (or `--before`) and it runs when a chat
starts, with the pre-chat form's answers. For example, a CRM lookup with the
body `{ "email": "{{prechat.email}}" }`. All before-chat tools run together,
each within its timeout (5 seconds by default, at most 10). The first answer
waits for them.

A tool that uses a `{{prechat.*}}` value the visitor left empty is skipped.
A tool that fails or times out is saved as `{ "error": "timeout" }`, and the
chat goes on.

## 2. In the prompt

In the prompt, `{{` opens a list of what you can use:

| You write | The assistant gets |
| --- | --- |
| `{{order_status}}` | The tool's name, and the tool to call. A tool is offered to the assistant only when the prompt names it this way |
| `{{crm_lookup.tier}}` | What that tool returned, quoted (`"gold"`), or `(not known yet)` |
| `{{order_number}}` (an extract tool) | The extract tool to save with |

For example:

```text
Gold customers ({{crm_lookup.tier}}) get free delivery.
If they ask about an order, ask for its number, save it with {{order_number}},
then look it up with {{order_status}}.
```

Below the prompt, the page lists the tools the prompt uses. It also flags a
`{{name}}` that is neither a tool nor a known value, which is usually a typo.

Answer **HTTP 200** for outcomes you expect, such as "not found" or "wrong
code" (`{ "found": false }`), and keep 4xx and 5xx for real failures: the
assistant treats an error as "could not check" and says so.

The assistant calls tools only when it needs them, at most five calls per
answer. Their results go to the assistant as data, not instructions: text in
an API's response cannot change the assistant's rules. When a tool fails, the
assistant tells the visitor it could not check right now. It never guesses
the result.

## Extract tools

An extract tool calls nothing. It names the fields the assistant should
collect, such as `order_number` ("The order number, like A-1042"). When the
visitor gives one, the assistant saves it:

- on the conversation's data, under the tool's name;
- as a **custom attribute** on the conversation (`order_number: A-1042`), so
  the team sees it, can filter by it, and webhooks and exports have it.

Name the extract tool in the prompt (`save it with {{order_number}}`). A
later tool can use the saved value as `{{data.order_number.order_number}}`.

## 3. After the chat

Add a tool to **After the chat** (or `--after`) and it runs when the
conversation ends: five quiet minutes after the last message, or when a live
chat closes. This is the same moment as the `conversation.completed`
webhook. It gets everything: `{{transcript}}`, `{{summary}}` (when summaries
are on), `{{lead}}`, `{{attributes}}` and `{{data}}`. A `POST` with no body
sends the whole conversation as JSON:

```json
{
  "conversationId": "c_…",
  "summary": "Ada asked where order A-1042 is.",
  "lead": { "name": "Ada", "email": "ada@example.com" },
  "attributes": { "order_number": "A-1042" },
  "data": { "crm_lookup": { "tier": "gold" }, "order_status": { "status": "shipped" } },
  "transcript": [{ "role": "visitor", "text": "Where is my order?", "at": "…" }]
}
```

A failing call (a 5xx, a 429, a timeout) is tried again, twice. What the API
answers is kept as data too, before `conversation.completed` is sent.

## Limits

- Up to 30 tools per site; https only; a fixed host.
- Timeout 1 to 10 seconds per call (5 by default).
- A kept response is about 4 KB at most (pick the keys you need).
- At most five tool calls per answer.
- The tool's last status shows in the Tools panel and in `helppuff tools list`.

## API

The routes are `GET/POST /tools`, `PATCH/DELETE /tools/:id` and
`POST /tools/test`, under the `prompt:read` and `prompt:write` scopes. See
the [[API reference|API-Reference-Tools]].
