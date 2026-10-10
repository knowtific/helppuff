# Agent files

An agent file is your assistant's setup in one JSON file: the **prompt**,
the **tools**, and the **behaviour** and **lead form** settings. Export one
to keep in your project or share, import one to set an assistant up the same
way, or start from a [[tutorial's template|Tutorials]].

It does not hold the branding (colours, name), the knowledge base, the team,
webhooks or keys.

## Export and import

| | Export | Import |
| --- | --- | --- |
| Dashboard | Settings → **Import & export** → **Download agent.json** | **Choose file**, or **Use this** on a template |
| CLI | `helppuff agent export agent.json` | `helppuff agent import agent.json` (or a template's id) |
| API | `GET /api/v1/agent/export` | `POST /api/v1/agent/import` |

Importing **checks everything first**, then applies it in this order:

1. **Settings**: the behaviour (goal, tone, length, prices) and the lead form,
   merged into yours.
2. **Tools**, matched by name: a new name is created, an existing one is
   replaced. Your other tools stay.
3. **The prompt**, published as a new version. Yours stays in the history,
   and **Restore** brings it back.

Nothing changes until every part is valid. The dashboard shows what will
change before you import; in the terminal, `--dry-run` does.

With the CLI, `prompt.md` and `helppuff.json` are updated after an import,
so the next `helppuff deploy` builds on it instead of refusing.

## Secrets

Secrets are never in the file. A tool's key is a placeholder, and `needs`
lists each one:

```json
"headers": [{ "name": "Authorization", "value": "ShippoToken ${SHIPPO_TOKEN}", "secret": true }],
…
"needs": [{ "name": "SHIPPO_TOKEN", "description": "Your Shippo API token" }]
```

When you import, the dashboard asks for each value. The CLI reads it from
`.env` (set it with `helppuff secret set SHIPPO_TOKEN`), and answers
`needs_input` when one is missing. Values are stored encrypted, as a tool
saved by hand is. Importing the same file again keeps the stored keys.

An export writes each stored secret as a placeholder named after the tool and
header (`${ORDER_LOOKUP_AUTHORIZATION}`), standing for the whole header value.

## The format

```json
{
  "helppuff": "agent",
  "version": 1,
  "name": "Order tracking",
  "description": "What it is for, shown before importing.",
  "prompt": "## Order questions\n1. Ask for their order number…",
  "settings": {
    "behaviour": { "goal": "answers" },
    "leads": { "enabled": true, "fields": [{ "name": "email", "label": "Email", "type": "email", "required": true }] }
  },
  "tools": [
    { "name": "order_number", "kind": "extract", "description": "…", "fields": [{ "name": "order_number", "description": "…", "required": true }] },
    { "name": "order_lookup", "description": "…", "method": "GET", "url": "https://shop.example.com/orders/{{args.order_number}}", "headers": [], "parameters": [], "pick": ["status"] }
  ],
  "needs": []
}
```

- `prompt`, `settings` and `tools` are each optional: a file with only tools
  adds tools.
- A tool has the same fields as `POST /tools` ([[Tools API|API-Reference-Tools]]).
- `settings` takes the same `behaviour` and `leads` as `PUT /settings`.

Through the API, a key needs `prompt:write`, and `settings:write` too when the
file has settings.
