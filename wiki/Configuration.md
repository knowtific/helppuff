# Configuration

An assistant is described by three files in its project folder, and can also
be changed live in the dashboard.

| | Holds | Changed by |
| --- | --- | --- |
| `murmur.json` | What the assistant is: website, backend and model, knowledge, widget, limits, dashboard, and where it is deployed | you, an agent, `murmur config set`, `murmur config pull` |
| `prompt.md` | How it talks: the system prompt | you, an agent, `murmur prompt pull`; the dashboard's Instructions write it too |
| `.env` | Secrets: provider keys, `MURMUR_SECRET`, `ADMIN_API_KEY`, an optional Cloudflare token | `murmur secret set`, `murmur deploy` (generates the Murmur secrets) |

Every option, with its type, default and limits, is in the
**[[Configuration reference|Configuration-Reference]]**, generated from the
same schema `murmur` validates against. `murmur schema` prints it as JSON
Schema, and `murmur.json` points at a copy (`$schema`), so editors complete and
check fields as you type.

## A minimal `murmur.json`

```json
{
  "$schema": "./.murmur/murmur.schema.json",
  "site": "acme",
  "name": "Acme Plumbing",
  "website": "https://acme.com.au",
  "origins": ["https://acme.com.au", "https://www.acme.com.au"],
  "backend": { "type": "workers-ai" }
}
```

Everything else has a default. A fuller example:

```json
{
  "site": "acme",
  "name": "Acme Plumbing",
  "website": "https://acme.com.au",
  "origins": ["https://acme.com.au", "https://www.acme.com.au", "https://staging.acme.com.au"],
  "backend": {
    "type": "workers-ai",
    "model": "@cf/zai-org/glm-4.7-flash",
    "timezone": "Australia/Melbourne",
    "locale": "en-AU",
    "retrieval": { "rerankerModel": "@cf/baai/bge-reranker-base" }
  },
  "knowledge": {
    "website": { "include": ["**/services/**", "**/faq**"], "schedule": "weekly" },
    "files": ["./docs/price-list.pdf", "./docs/faq.md"]
  },
  "widget": {
    "brand": { "agentName": "Ava", "accent": "#0F766E" },
    "launcher": { "label": "Chat with us", "shape": "pill" },
    "leadForm": {
      "fields": [
        { "name": "name", "label": "Name", "type": "text", "required": true },
        { "name": "email", "label": "Email", "type": "email", "required": true },
        { "name": "phone", "label": "Phone (optional)", "type": "tel" },
        { "name": "suburb", "label": "Suburb", "type": "text" },
        { "name": "message", "label": "How can we help?", "type": "textarea", "required": true }
      ]
    },
    "chat": { "fallbackContact": { "phone": "03 9000 0000", "email": "hello@acme.com.au" } }
  },
  "security": { "limits": { "messagesPerSitePerDay": 500 } }
}
```

## Changing it

```bash
murmur config get backend                               # read by dotted path
murmur config set widget.brand.accent "#0EA5E9"          # validated before it is saved
murmur config set knowledge.files '["./docs"]'           # JSON values are parsed
murmur deploy                                            # publish
```

`deploy` only uploads the Worker when its code or bindings changed. Content
changes (prompt, widget, model, limits) are published to KV and are live in
seconds.

## The dashboard and `murmur.json`

The dashboard's Settings and Instructions change the **live** config
directly. If you also keep the project in git, the two can drift, so each
side checks before it overwrites the other:

- `murmur config pull` brings dashboard settings into `murmur.json`.
- `murmur prompt pull` brings the live prompt into `prompt.md`, keeping any
  unpublished local edits as `prompt.mine.md`.
- `deploy` refuses (`settings_changed`, `prompt_behind`) when the dashboard
  changed something this folder has not pulled. `--overwrite-settings` publishes
  over dashboard settings on purpose.

See [[Prompt and instructions|Prompts-and-Instructions]] for how prompt versions work.

## Secrets

Secrets are never written into `murmur.json`. A field that needs one names
the environment variable instead:

```json
"backend": { "type": "openai", "apiKey": { "env": "OPENAI_API_KEY" } }
```

```bash
murmur secret set OPENAI_API_KEY              # prompts (hidden); or pipe it in, or --value
murmur secret list
```

`secret set` writes `.env` and, once deployed, sets the Worker secret too.
`deploy` generates `MURMUR_SECRET` (signs sessions, never leaves your account)
and `ADMIN_API_KEY` (what the CLI and agents use for the dashboard's API) the
first time. Values in the environment win over `.env`.

| Variable | Used for |
| --- | --- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Cloudflare access, instead of `wrangler login` |
| `MURMUR_SECRET` | Signing sessions and dashboard cookies (generated) |
| `ADMIN_API_KEY` (or `MURMUR_ADMIN_API_KEY`) | The admin API, for the CLI and agents (generated) |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `RETELL_API_KEY` | The provider you chose |
| `MURMUR_BACKEND_TOKEN` | Your own API's bearer token (`http` backend) |
| any name you choose, e.g. `TURNSTILE_SECRET` | Turnstile's secret key, named in `security.captcha.secret` |

## Cloudflare access

Tried in this order:

1. **An API token**: `CLOUDFLARE_API_TOKEN` in the environment or `.env`, or
   `--cf-token`. Create a custom token at
   <https://dash.cloudflare.com/profile/api-tokens> with:
   - Account › Workers Scripts › Edit
   - Account › Workers KV Storage › Edit
   - Account › D1 › Edit
   - Account › Vectorize › Edit
   - Account › Account Settings › Read
   - Account › AI Search › Edit and Run (only for the Cloudflare AI Search backend)
2. **Your `wrangler login`**: its OAuth token already carries these scopes.
   Murmur reads it and lets wrangler refresh it.

If the token can see several accounts, pass `--account-id` or set
`CLOUDFLARE_ACCOUNT_ID`.

## Allowed origins

`origins` lists every site the widget may be embedded on, with scheme and
host (`https://acme.com.au`, `https://www.acme.com.au`). Requests from other
pages are refused, so another site cannot embed your assistant and spend your
budget. The Worker's own preview page is always allowed. Changing `origins`
needs a deploy; it deliberately cannot be changed from the dashboard or the
live config.

## Several sites

One project folder is one site (one `site` id, one Worker). For several
sites, use one folder each; their Cloudflare resources are named by site id,
so they never collide.
