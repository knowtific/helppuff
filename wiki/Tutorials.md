# Tutorials

Four real setups, each built from [[tools|Tools]] and a prompt, each with a
template you can import and change. Start with the one closest to what you
need: they also teach the patterns the others build on.

| Tutorial | What the visitor gets | What it teaches |
| --- | --- | --- |
| [[Order tracking|Tutorial-Order-Tracking]] | "Where is my order?" answered from your shop and the carrier | Asking for a value in the chat, saving it, one tool feeding another (`{{data.*}}`), picking fields from a big response |
| [[Send chats to your CRM|Tutorial-CRM-Sync]] | Their enquiry, with a summary, in HubSpot without anyone typing it | Extract tools, an after-chat tool, n8n or Zapier as the glue |
| [[Nearest store|Tutorial-Nearest-Store]] | Their nearest store in the first answer | A pre-chat form field, a before-chat tool, a tool's result in the prompt |
| [[Verified account changes|Tutorial-Verified-Account-Changes]] | Change their email or address after an SMS code | Several tools in one task, security your API enforces, answers that are not errors |
| [[Logged-in customer support|Tutorial-Logged-In-Support]] | Billing answers from their own account, without being asked who they are | [[Signed-in visitors|Signed-In-Visitors]], `{{user.id}}`, requests people decide on |
| [[Product and stock|Tutorial-Product-And-Stock]] | Live prices, and stock at their nearest store | What goes in the knowledge base and what comes from a tool |
| [[Hot leads to Slack|Tutorial-Hot-Leads-Slack]] | An alert in your sales channel for hot leads only | An after-chat tool with **Only when**, the AI's labels |

**Guides:** [[Knowledge base or tool?|Knowledge-Or-Tool]] (where each kind of
information belongs) and [[Testing and monitoring|Testing-And-Monitoring]]
(keeping a setup working as you change it).

## Use a template

Every tutorial's setup is a ready-made [[agent file|Agent-Files]]: the
prompt, the tools and any settings they need.

- **Dashboard:** Settings → **Import & export** → **Use this**. It shows
  what changes, asks for the keys the tools need, then imports.
- **Terminal or your coding agent:**

```bash
helppuff agent templates                      # the list
helppuff agent import order-tracking --dry-run   # what it would change
helppuff agent import order-tracking          # keys come from .env
```

Then change the addresses to your own APIs, reword the prompt for your
business, and test it like a visitor (`helppuff ask "Where is my order 1042?"`).
Or ask your coding agent: "Set up the order tracking template with me".

## Patterns that apply everywhere

- **Name each tool in the prompt** (`{{order_lookup}}`) at the step where
  the assistant should use it. A tool used during the chat is offered only
  when the prompt names it.
- **Write the prompt as steps and situations**: what to ask, which tool to
  call, what to say for each result. The assistant follows numbered steps
  well, and says things in its own words.
- **Describe every value the assistant fills in** (`{{args.order_number}}`:
  "The order number, like 1042 (without #)"). It reads the description to
  know what to ask the visitor for.
- **Answer 200 for expected outcomes.** "Not found", "wrong code" or "not
  verified yet" are answers, not failures: return them as
  `{ "found": false }` with HTTP 200. A 4xx or 5xx tells the assistant the
  check failed, and it says it could not check right now.
- **Pick what the assistant needs.** Tick (or `--pick`) only the fields it
  uses: a smaller response means faster, cheaper and more accurate answers.
- **Let your API enforce the rules.** The assistant follows the prompt, but
  security must not depend on it: your API decides who may see an order or
  change an account.
