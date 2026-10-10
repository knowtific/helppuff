# Testing and monitoring

A prompt and tools that work today can break tomorrow: a page changes, an
API returns a new shape, someone rewords the prompt. These are the checks
that catch it, before visitors do.

## Before you change anything: a set of real questions

Keep a file of questions visitors really ask, with what a good answer must
contain, and run it after every change:

```json
[
  { "question": "What's your phone number?", "source": "/contact", "contains": ["9876 5432"] },
  { "question": "Where is order 1042? I ordered with ada@example.com", "contains": ["Thursday"] },
  { "question": "Do you have waterproof boots in a 10?", "contains": ["$"] },
  { "question": "Can you fix my car?", "refuse": true }
]
```

```bash
helppuff eval golden.json --min 0.9
```

Each question is asked in a fresh conversation, as a new visitor would. A
question passes when the knowledge base found the expected page (`source`, a
part of its address), the reply contains every `contains`, and a `refuse`
question gets "not sure" instead of a guess. The command fails (exit code 1)
below `--min`, so it can run in CI or before every `helppuff deploy`.

**For tool flows, put everything in one question** ("order 1042, with
ada@example.com"), so the assistant can call the tools straight away.
Use test values your API answers the same every time (like Shippo's
`SHIPPO_TRANSIT`).

Where to get the questions: the dashboard's **Analytics** → **Latest
questions**, and the **unanswered** questions on each conversation's summary.

## Testing one tool

```bash
helppuff tools test order_lookup --arg order_number=1042 --arg email=ada@example.com
helppuff tools test nearest_store --prechat postcode=3056
helppuff tools test track_shipment --data order_lookup.carrier=shippo --data order_lookup.tracking_number=SHIPPO_TRANSIT
```

It calls the API now and shows exactly what the assistant would get (after
the picked fields). On the dashboard, **Test** in the tool's window does the
same.

## Testing a whole conversation

```bash
helppuff ask "Where is order 1042? I ordered with ada@example.com"    # one answer, with its sources
helppuff chat                                                        # a conversation, in the terminal
```

And once on the real site, as a visitor, on a phone: the widget, the forms
and the tools together.

## Watching it in production

| Where | What it tells you |
| --- | --- |
| **Prompt & tools**, each tool (or `helppuff tools list`) | Its last status (`200`, `500`, `timeout`) and when |
| A conversation's **Data from tools** | What every tool returned in that chat; a failure is kept as `{ "error": "HTTP 503" }` |
| A conversation's summary | `unanswered` questions, `outcome`, `leadQuality` |
| **Analytics** | Conversations, leads, top pages, the questions visitors open with |
| `helppuff doctor` | Every piece of the deployment, with fixes |
| `GET /api/v1/tools` | Each tool's `lastStatus` and `lastAt`, for your own monitoring to poll |

**A habit that pays:** once a week, read five conversations end to end, and
add any question that went wrong to `golden.json`.

## Changing things safely

- **The prompt has versions.** **Prompt & tools** → the prompt → **History**
  compares any version with the live one, and **Restore** brings one back.
- **Export before a big change:** `helppuff agent export before.json` (or
  **Download agent.json**). Importing it puts the prompt and tools back.
- **Test a new tool before naming it in the prompt.** A tool the prompt does
  not name is never offered to the assistant.
- **Use a second site to experiment** (a `sites` entry of its own), then
  import the agent file into the real one.

See also: [[Tools]], [[Agent files|Agent-Files]].
