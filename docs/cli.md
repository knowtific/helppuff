# The `murmur` CLI

`@knowtific/murmur` sets up, deploys and manages a Murmur assistant on **your own
Cloudflare account**. Install nothing, clone nothing:

```bash
npx @knowtific/murmur init
```

It is built for two kinds of user at once: a person at a terminal, who gets a
short wizard, and an AI agent (Claude Code, Codex, Cursor…), which gets flags,
JSON output and a documented question loop. Both drive the same engine, so
anything one can do the other can too.

---

## What `init` asks

Only what it cannot work out. The website answers most of it:

| From your website | Becomes |
| --- | --- |
| Name, description | `name`, the start of `prompt.md` |
| `theme-color`, icon | brand accent and avatar |
| Phone, email in links | `chat.fallbackContact`, and the prompt's hand-off line |
| Pricing / contact / FAQ links | home-screen links, labelled with the site's own words |
| The domain | `site` id, `origins` (with and without `www`) |

What remains:

| Question | Default | Asked when |
| --- | --- | --- |
| Website | — | always (answer `none` if there is no site yet) |
| Backend | `cloudflare` | always |
| Model | a sensible one per backend | wizard only; agents get it as an assumption |
| API key | — | only for openai / gemini / anthropic / retell, and only if not already in the environment |
| AI Search instance | an existing instance that already crawls your site, else a new one | cloudflare / anthropic, when you have instances |
| Files to learn from | `./knowledge` if it exists | knowledge-capable backends |
| Cloudflare access | your `wrangler login` | only if there is neither a login nor a token |
| Dashboard email | your `git config user.email` | unless `--no-dashboard` |
| Dashboard password | generated, shown once | wizard only |
| Assistant name | `Assistant` | wizard only (`--agent-name`) |
| Main goal | turn visitors into enquiries | wizard only (`--goal leads\|answer\|book\|sell`) |
| Must-know / never-say | — | wizard only (`--notes "…"`) |
| Pre-chat form | none — visitors chat straight away | wizard only (`--lead-form name,email,phone`; phone is optional) |

Every new conversation opens with a greeting from the assistant
(`widget.chat.initialMessages`, e.g. `"Hi {{name}}! I'm Kai from Knowtific. How can I help you today?"`).
`{{name}}` is the visitor's first name when a pre-chat form asked for it, and
is dropped cleanly when not. With a form, `prompt.md` is told the details are
already known, so the assistant neither greets twice nor asks for them again,
and every form becomes a lead in the dashboard.

The last three shape `prompt.md`. They are asked *after* Cloudflare access
is known on purpose: by then the wizard has already started building the
knowledge base in the background — creating the AI Search instance, and
crawling and uploading — so the slow part runs while the owner answers.

On a machine that has run `npx wrangler login` once, setting up a Cloudflare
AI Search assistant for a live website is two answers: the URL, and Enter.

## Cloudflare access

Two ways, tried in this order:

1. **An API token** — `CLOUDFLARE_API_TOKEN` in the environment or `.env`, or
   `--cf-token`. Create a custom token with *Workers Scripts: Edit, Workers KV
   Storage: Edit, D1: Edit, AI Search: Edit, AI Search: Run, Account Settings:
   Read*.
2. **Your `wrangler login`** — its OAuth token already carries those scopes.
   murmur reads it from wrangler's config and lets wrangler refresh it. The
   wizard offers to open the browser login for you.

If the token sees several accounts, pass `--cf-account` or set
`CLOUDFLARE_ACCOUNT_ID`.

## Backends

| `--backend` | What answers | Knowledge | Needs |
| --- | --- | --- | --- |
| `cloudflare` *(default)* | Cloudflare AI Search + a Workers AI model | AI Search built-in storage, or an instance that crawls your site | only Cloudflare access |
| `openai` | OpenAI Responses | a vector store + the `file_search` tool | `OPENAI_API_KEY` |
| `gemini` | Gemini Interactions | a File Search store | `GEMINI_API_KEY` |
| `anthropic` | Claude (Messages API) | retrieved from Cloudflare AI Search | `ANTHROPIC_API_KEY` |
| `http` | your own API | yours | a URL |
| `retell` | a Retell chat agent | yours, in Retell | `RETELL_API_KEY` |

### How the website gets indexed

| Your domain | What happens |
| --- | --- |
| A zone on the same Cloudflare account | AI Search **crawls it itself** — `sitemap` mode if the site publishes one, `discover` (link-following) if not, with a headless browser for JavaScript-rendered pages. It re-syncs every 6 hours. |
| Anywhere else | murmur crawls up to `knowledge.website.maxPages` pages (sitemap first, then links) and uploads them as Markdown. `murmur knowledge sync` refreshes them. |

`knowledge.files` (PDF, Word, Markdown, text, HTML, CSV) are uploaded
either way. **Nothing waits for indexing**: `deploy` goes live immediately
and reports progress; answers get better as pages finish. Check with
`murmur knowledge status`. On a newly created crawler instance, murmur
waits for Cloudflare's first crawl to finish before uploading files — that
first sync drops files uploaded while it runs — and then verifies every
file is listed.

### Using an AI Search instance you already have

`init` lists the instances on your account and pre-selects one that already
crawls your website — reusing it costs nothing and it is already indexed. You
can also point at an instance on another account through its **public
endpoint**:

```bash
murmur init --url acme.com --backend cloudflare --ai-search-endpoint https://search.acme.com
```

The same choices in `murmur.json`:

```jsonc
"backend": { "type": "cloudflare" }                                   // murmur-<site>, created for you
"backend": { "type": "cloudflare", "instance": "acme-website" }       // an existing instance
"backend": { "type": "cloudflare", "endpoint": "https://search.acme.com" } // a public endpoint
```

An instance that crawls the website itself is never sent murmur's own copy of
the site; `knowledge.files` are still uploaded to it.

### Your own backend (`http`)

Two shapes, picked with `--http-mode`:

**`murmur`** — your service owns everything AI-shaped. murmur POSTs:

```
POST {url}/start    { siteId, sessionId, lead?, context, firstMessage? }
POST {url}/message  { siteId, sessionId, state, input }
```

and accepts either JSON — `{ "text": "…" }`, or `{ "messages": [...], "state": … }`
with messages in the [protocol](protocol.md#messages) shape (`id`, `ts` and
`role` may be omitted) — or a stream:

```
event: delta   data: {"text":"Hel"}
event: delta   data: {"text":"lo"}
event: done    data: {"text":"Hello","state":{"conversation":"c-9"}}
```

`state` comes back to you on the next message and must stay under 1 kb.
With a token (`--http-token`, stored as `MURMUR_BACKEND_TOKEN`) requests carry
`Authorization: Bearer …`; with `signingSecret` they also carry
`X-Murmur-Timestamp` and `X-Murmur-Signature: sha256=<HMAC of "{timestamp}.{body}">`.

**`openai`** — any Chat Completions endpoint: vLLM, Ollama, LiteLLM,
OpenRouter, DeepSeek. murmur keeps the conversation history and sends
`prompt.md` as the system message.

## Names on your Cloudflare account

Everything murmur creates is named **`knowtific-murmur-<site>`** — the Worker
(`knowtific-murmur-<site>.<you>.workers.dev`), the KV namespace, the D1
database and the AI Search instance — so it is easy to find, and never
mistaken for anything else on the account. The setup menu never offers
another site's `knowtific-murmur-…` instance.

## The dashboard

Every deploy includes a CRM at `<worker>/admin` — conversations with full
transcripts, leads in a pipeline (new → contacted → qualified → won / lost)
with notes and CSV export, activity analytics, and one-click AI summaries
(intent, sentiment, next step) from Workers AI.

- **Data** lives in a D1 database on your account, `murmur-<site>`. Recording
  happens after each reply is sent, so a visitor never waits on it.
- **Leads** are created from the lead form, from an email or phone number a
  visitor types, or from a summary — which only keeps contact details that
  actually appear in the transcript.
- **Sign-in**: the owner is `dashboard.adminEmail`; the password's PBKDF2 hash
  is the `ADMIN_PASSWORD_HASH` secret. Teammates: `murmur users add <email>`.
  Forgotten password: `murmur users reset <email>`.
- **Prompt**: the owner can edit the system prompt on the *Prompt* page, see
  every version with who published it and from where, compare any version with
  the live one, and restore it. See [The prompt and its versions](#the-prompt-and-its-versions).
- **Off**: `murmur init --no-dashboard`, or `murmur config set dashboard.enabled false`.

## Commands

```
init                 set up (wizard in a terminal, flags + JSON for agents)
deploy               create or update everything; content-only changes skip the Worker upload
dev                  run locally (picks a free port; `chat --local` finds it)
chat [message]       talk to it through the real API; REPL without a message
status | doctor      what is deployed | every check, each with its fix
knowledge sync       re-crawl the site and re-upload files
secret set|list      store secrets in .env and on the Worker; values never printed
config get|set       read or change murmur.json by dotted path, validated
prompt [status]      prompt.md vs the live version: in_sync, ahead, behind, diverged
prompt pull          bring the live prompt (or --version N, to restore it) into prompt.md
prompt history|show  every published version; print one
users list|add|remove|reset    dashboard accounts
dashboard            print the dashboard URL
validate | schema | embed
mcp                  the same engine as MCP tools over stdio
```

`murmur <command> --help` has the options and examples for each.

## Using it from Claude Code, Codex or Cursor

The user only has to ask — "add an AI chatbot to my website" — if their
agent knows about murmur. Three ways to teach it, once per machine:

```bash
# Claude Code plugin: the skill plus the MCP server
/plugin marketplace add <github-owner>/knowtific-website-chat
/plugin install knowtific-murmur@knowtific

# or just the skill, for Claude Code (and Codex with --codex)
npx -y @knowtific/murmur skill install [--codex]
```

and every project `init` creates carries the skill and an `AGENTS.md`, so the
next agent to open it already knows how to change and test it.

What the agent then does, unprompted (verified with fresh Claude Code
sessions on 2026-09-25):

1. Loads the `website-chatbot` skill, reads `--help`, runs `init --json` with the URL.
2. If the machine has no Cloudflare access, **stops and asks** — suggesting
   `! npx wrangler login` (a browser sign-in, nothing pasted into the chat) or an
   API token the user stores themselves with `! npx -y @knowtific/murmur secret set
   CLOUDFLARE_API_TOKEN`. It never guesses credentials.
3. Otherwise deploys, asks the live assistant a few real visitor questions
   (including one it should *not* be able to answer), adds the `<script>` tag
   to the site's shared layout, and hands over the preview, the dashboard and
   the one-time password.

The whole run — install to live, tested and embedded — took under two minutes.

## For agents

Everything an agent needs is in `murmur --help`, which is written to be
followed literally. The contract:

**Output.** With `--json`, stdout is exactly one JSON object —
`{"ok": true, …}` or `{"ok": false, "error": {code, message, hint}}`. Progress
goes to stderr. Exit codes: `0` ok · `1` error · `2` usage · `10` needs input.

**The question loop.** `init` never prompts without a terminal. When it lacks
something required it exits `10` with:

```json
{
  "ok": false,
  "status": "needs_input",
  "questions": [
    { "id": "backend", "ask": "Which backend should answer your visitors?", "flag": "--backend",
      "kind": "select", "required": true, "default": "cloudflare", "options": [ … ] }
  ],
  "assumed": { … },
  "known": { "website": "acme.com" }
}
```

Ask the user those questions, then re-run with each `flag`. `--yes` accepts
every `default`. Secrets are never echoed back; `known` shows them as
`<provided>`.

**Testing without tripping the limits.** Visitor limits are per IP (five
new chats an hour by default). `murmur chat` sends a header derived from
`MURMUR_SECRET` that exempts the owner from the per-IP limits — never from
the per-conversation or daily caps — so an agent can test as much as it
needs.

**Loop to done:**

```bash
murmur init --url acme.com --backend cloudflare --json    # repeat until "status": "created"
murmur deploy --json                                      # → url, preview, embed, dashboard
murmur chat "How much is a service call?" --json          # → reply, session
murmur chat "And on Sundays?" --session <session> --json  # continues the conversation
```

`init` also writes **`AGENTS.md`** (read by Codex and others) and a **Claude
Code skill** at `.claude/skills/murmur/SKILL.md`, so the next agent to open
the project already knows how to change and test it.

**MCP.** `murmur mcp` serves the engine as tools — `murmur_setup`,
`murmur_deploy`, `murmur_chat`, `murmur_status`, `murmur_doctor`,
`murmur_knowledge_sync`, `murmur_config`, `murmur_prompt`, `murmur_secret`,
`murmur_schema`:

```bash
claude mcp add murmur -- npx -y @knowtific/murmur mcp
```

## The prompt and its versions

The prompt can change in two places: `prompt.md`, published by `murmur deploy`,
and the dashboard's *Prompt* page. So it is versioned, and each place checks
it is building on the latest version before it publishes.

- **Every publish is a version.** A deploy that changed `prompt.md`, an edit in
  the dashboard, and a restore each get the next number. The site's KV config
  carries the live text and its version; the history, with who published each
  version and from where, is in the dashboard's D1 database. A restore is a new
  version with the old text, so nothing in the history is ever lost.
- **`.murmur/state.json` remembers which version `prompt.md` is based on**, so
  `murmur prompt` can tell a local edit from a remote one:

  | Status | Meaning | `deploy` |
  | --- | --- | --- |
  | `in_sync` | `prompt.md` is the live text | leaves it alone |
  | `ahead` | only `prompt.md` changed | publishes it as the next version |
  | `behind` | only the live prompt changed (the dashboard) | **refuses** — `murmur prompt pull` |
  | `diverged` | both changed, or this folder never synced | **refuses** — `murmur prompt pull` |
  | `untracked` | deployed before versioning | keeps the old text as v1, publishes v2 |

- **Pull never loses work.** If `prompt.md` has edits that were never
  published, `pull` keeps them as `prompt.mine.md` before writing the live
  text. Merge what you need into `prompt.md`, delete the copy, deploy.
- **Restoring from the CLI**: `murmur prompt pull --version 3`, then
  `murmur deploy` publishes version 3's text as the next version.
- **The dashboard** refuses a publish that started from an older version in
  the same way (someone else published while you were editing), and keeps
  your draft so you can review what changed and publish again.
- Without the dashboard, versions are still numbered and checked through
  KV; only the history (and `pull --version`) needs D1.
- Backends that keep their own prompt — Retell, an OpenAI stored prompt
  (`promptId`), your own API in `murmur` mode — are not versioned here.

## Files

| File | Holds | Commit? |
| --- | --- | --- |
| `murmur.json` | what the assistant is: site, backend, prompt path, knowledge, widget, dashboard, deployment ids | yes |
| `prompt.md` | how it behaves; `murmur prompt pull` brings in dashboard edits | yes |
| `.env` | secrets: provider keys, `MURMUR_SECRET`, `ADMIN_PASSWORD_HASH`, optional Cloudflare token | **never** (gitignored) |
| `.murmur/` | the generated Worker, JSON Schema and deploy state | no (gitignored) |

`murmur.json` has a JSON Schema (`murmur schema`, also written to
`.murmur/murmur.schema.json` and referenced by `$schema`), so editors and
agents get every field with its description.

## How deploy works

1. Cloudflare session → your `workers.dev` subdomain → the Worker's URL
2. KV namespace, D1 database + schema, AI Search instance — found or created;
   then the prompt check: **stops here** if the live prompt has a version
   `prompt.md` is not based on (see above)
3. Knowledge, on the first deploy or with `--knowledge`
4. The Worker itself, built from the prebuilt runtime in the package —
   **skipped when only content changed** (prompt, widget, model, knowledge ids)
5. Secrets the config references, when missing on the Worker or changed locally
6. The site config into KV — which is what makes content changes live in seconds —
   with a new prompt version recorded first when `prompt.md` changed
7. A health check through the real config route

Every step finds what exists before creating anything, so `deploy` is safe to
run at any time.
