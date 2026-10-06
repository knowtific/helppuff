<!-- Generated from packages/cli/src/help.ts by `pnpm sync:plugin`. Edit that file, not this page. -->

# CLI reference

Run any command with `npx @knowtific/murmur <command>` (or `murmur <command>` once installed).
`murmur <command> --help` prints the same in a terminal.

**Every command** takes `--json` (stdout is one JSON object: `{"ok":true,…}` or
`{"ok":false,"error":{code,message,hint}}`; progress goes to stderr), `--non-interactive`,
`--cwd <dir>` and `--yes`. **Exit codes:** `0` ok · `1` error · `2` bad usage or missing
input · `3` auth or permission · `4` Cloudflare quota or limit · `10` needs_input.

### `murmur init`

```
murmur init [options]
```

Set up a new assistant in this folder. In a terminal it asks only for the website, deploys, and prints the setup link; everything else is a flag, or Settings in the dashboard. With --json (or no terminal) it never prompts and returns anything still needed as {"status":"needs_input"}.

| Option | |
| --- | --- |
| `--url <site>` | Your website, e.g. acme.com — or "none" if there is no site yet |
| `--name <text>` | Business name (read from the site when omitted) |
| `--backend <type>` | workers-ai (default) \| cloudflare \| openai \| gemini \| anthropic \| http \| retell |
| `--no-defaults` | In a terminal: choose another backend instead of the free default |
| `--model <id>` | Model for the backend (a sensible default is picked) |
| `--api-key <key>` | Provider key for openai/gemini/anthropic/retell (or set it in the environment) |
| `--ai-search <name>` | cloudflare/anthropic: "new" (default), an existing instance name, or "endpoint" |
| `--ai-search-endpoint <url>` | A public AI Search endpoint to use instead of an instance |
| `--http-url <url>` | http backend: your API base URL |
| `--http-mode <mode>` | http backend: murmur \| openai |
| `--http-token <token>` | http backend: Bearer token for your API |
| `--retell-agent <id>` | retell backend: the agent id |
| `--docs <paths>` | Files or folders to learn from, comma separated |
| `--cf-token <token>` | Cloudflare API token (or CLOUDFLARE_API_TOKEN) |
| `--cf-account, --account-id <id>` | Cloudflare account id, when the token sees several |
| `--admin-email <email>` | Dashboard owner (other backends; workers-ai makes the account from the setup link) |
| `--admin-password <p>` | Dashboard password (default: generated and shown once) |
| `--no-dashboard` | Skip the leads/conversations dashboard |
| `--agent-name <name>` | What visitors see the assistant called (default: Assistant) |
| `--goal <goal>` | leads \| answer \| book \| sell — what it steers visitors towards (default: leads) |
| `--notes <text>` | Must-know / never-say instructions, woven into prompt.md |
| `--lead-form <fields>` | Pre-chat form fields from name,email,phone,message, or none (default: all four; phone optional) |
| `--yes, -y` | Accept the recommended answer wherever there is one |
| `--deploy / --no-deploy` | Deploy right after setup (default: yes in a terminal, no in --json) |
| `--crawl <which>` | workers-ai, with --deploy: suggested \| all \| none \| globs like "**/services/**,**/faq/**" |
| `--crawl-file <file>` | workers-ai, with --deploy: crawl exactly the URLs in this file |
| `--no-browser` | Do not open the setup page; continue in the terminal |
| `--force` | Overwrite an existing murmur.json |
| `--no-agent-files` | Do not write AGENTS.md and the Claude Code skill |

```bash
murmur init
murmur init --url acme.com.au --deploy --crawl suggested --yes --json
murmur init --url acme.com.au --deploy --crawl "**/services/**,**/faq/**" --yes --json
murmur init --url acme.com --backend cloudflare --yes --json
murmur init --url acme.com --backend openai --api-key "$OPENAI_API_KEY" --deploy --json
murmur init --url acme.com --backend http --http-url https://api.acme.com/chat --http-mode murmur --json
```

### `murmur upgrade`

```
npx @knowtific/murmur@latest upgrade [--check] [--yes] [--allow-downgrade]
```

Bring the deployed assistant to this release. Shows what is live, what will change (murmur.json format, D1 migrations), notes a restore point (D1 Time Travel: the database can be put back to just before, for 7 days on the Free plan), then deploys. Data, settings, prompt versions and the knowledge base are kept. Run it with @latest so npx fetches the newest CLI.

| Option | |
| --- | --- |
| `--check` | Only report: versions, pending migrations, murmur.json changes |
| `--yes` | Go ahead without asking (needed with --json or without a terminal) |
| `--allow-downgrade` | Go to this release although the Worker runs a newer one |

```bash
npx @knowtific/murmur@latest upgrade
npx -y @knowtific/murmur@latest upgrade --check --json
npx -y @knowtific/murmur@latest upgrade --yes --json
```

Rolling back: npx @knowtific/murmur@<previous version> deploy --allow-downgrade. Migrations only add tables and columns, so the previous release runs on the upgraded database. To also put the data back, use the restore command upgrade printed (wrangler d1 time-travel restore).

### `murmur deploy`

```
murmur deploy [options]
```

Create or update the Worker, storage, knowledge, secrets and config on Cloudflare. Idempotent. When only content changed (prompt, widget, model) it skips the Worker upload and is live in seconds.

| Option | |
| --- | --- |
| `--knowledge` | Re-sync the knowledge base as part of the deploy |
| `--skip-knowledge` | Never touch the knowledge base |
| `--force` | Upload the Worker even if nothing about it changed |
| `--dry-run` | Check credentials and secrets and show the URL, change nothing |
| `--crawl <which>` | workers-ai: also start a crawl — suggested \| all \| globs |
| `--crawl-file <file>` | workers-ai: crawl exactly the URLs in this file |
| `--overwrite-settings` | Publish murmur.json over settings changed in the dashboard (otherwise: config pull first) |
| `--allow-downgrade` | Deploy although the Worker runs a newer release: a deliberate rollback |
| `--account-id <id>` | The Cloudflare account, when the token sees several |

```bash
murmur deploy
murmur deploy --json
murmur deploy --crawl suggested --json
murmur deploy --knowledge
```

workers-ai: the first deploy creates a Vectorize index, a D1 database, a KV namespace and a Workflow, generates ADMIN_API_KEY into .env, and returns setupUrl — a one-time link (24h) to the setup page. Re-running never creates duplicates.

### `murmur dev`

```
murmur dev [--port 8787]
```

Run the assistant locally with wrangler, using secrets from .env. Open http://localhost:8787 to try it; `murmur chat --local` talks to it.

### `murmur chat`

```
murmur chat [message] [--session <token>] [--local] [--json]
```

Send a message through the real API, as a visitor would. Without a message in a terminal it opens an interactive chat. Pass the returned "session" back with --session to continue a conversation.

| Option | |
| --- | --- |
| `--session <token>` | Continue a conversation |
| `--local` | Talk to `murmur dev` on localhost:8787 instead of the deployed Worker |
| `--url <url>` | Talk to another deployment |

```bash
murmur chat "How much does a service cost?" --json
murmur chat "And on weekends?" --session <token> --json
murmur chat
```

### `murmur knowledge`

```
murmur knowledge status | sync [--wait] | add (--file f.md | --title t --text …) | upload <file…> [--wait] | files [remove <id>] | list | remove <id> | pages [--status s] | facts [set k=v …] | suggest [--apply]
```

workers-ai: the knowledge base on your Worker. `sync` re-crawls the selected pages (same as `murmur crawl`); `add` indexes hand-written knowledge at once; `upload` sends PDF, Word (.docx), Markdown or text files (up to 10 MB) that the Worker reads, cleans and learns in the background — `files` shows their progress, and `--wait` follows them to the end. Files listed in `knowledge.files` in murmur.json are synced on every deploy (new and changed ones uploaded, removed ones deleted); `facts` are the business details (phone, hours…) answers always see — yours are never overwritten by a crawl. Other backends: `sync` uploads the website and knowledge.files to AI Search, an OpenAI vector store or a Gemini File Search store.

```bash
murmur knowledge status --json
murmur knowledge add --file faq.md
murmur knowledge upload price-list.pdf brochure.docx --wait --json
murmur knowledge add --title "Warranty" --text "All installs carry a 5 year warranty."
murmur knowledge facts set phone="03 9876 5432" hours="Mon-Fri 7am-5pm"
murmur knowledge pages --status error
murmur knowledge suggest --apply   (starter questions written from the crawled pages)
```

### `murmur discover`

```
murmur discover [--json]
```

workers-ai: find the pages of the site — home page links, robots.txt sitemaps and sitemap indexes — each with a category (service, faq, contact, pricing, legal…) and whether it is selected. Legal pages, archives and old blog posts start unselected.

### `murmur crawl`

```
murmur crawl [--all | --urls a,b | --file urls.txt | --include globs] [--wait] [--json]
```

workers-ai: crawl pages into the knowledge base. It runs in a Cloudflare Workflow on your account, so it carries on if you close the terminal; --wait follows it to the end. With no choice given it crawls the selected pages (the first time: the suggested ones). Pages that are unchanged since the last crawl are not re-embedded.

| Option | |
| --- | --- |
| `--all` | Every discovered page except legal ones |
| `--urls <a,b>` | Exactly these pages (selected from now on) |
| `--file <file>` | Exactly the URLs in this file, one per line |
| `--include <globs>` | Discovered pages matching e.g. "**/services/**,**/faq/**" |
| `--wait` | Block until the crawl finishes, printing progress |

```bash
murmur crawl --wait
murmur crawl --include "**/services/**,**/faq/**" --json
murmur crawl --urls https://acme.com.au/pricing
```

### `murmur ask`

```
murmur ask "<question>" [--session <token>] [--timing] [--json]
```

Ask the deployed assistant as a visitor would, and show the passages retrieval found for it with their scores. When nothing passes the relevance threshold the assistant should say it is not sure — if it answers anyway, tighten prompt.md.

```bash
murmur ask "Do you service Lilydale?"
murmur ask "How much is a hot water service?" --timing
```

--timing prints where the time went, stage by stage (auth, limits, context, rag.embed / vector / keyword / rerank, llm.first_token, llm.round1…), from the Worker's Server-Timing header.

### `murmur eval`

```
murmur eval <golden.json> [--min 0.8] [--json]
```

Ask the deployed assistant a set of real visitor questions, each in a fresh conversation, and score them: retrieval found the expected page (`source`, a URL substring), the reply mentions every `contains`, and `refuse` questions get "not sure" rather than a guess. Exit code 1 when the share passing is below --min.

```bash
murmur eval golden.json
murmur eval golden.json --min 0.9 --json
```

golden.json: [{ "question": "What's your phone number?", "source": "/contact", "contains": ["9876 5432"] }, { "question": "Can you fix my car?", "refuse": true }]

### `murmur destroy`

```
murmur destroy --yes [--keep-data]
```

Delete everything this project created on Cloudflare: the Worker and its Workflow, KV, the D1 database (conversations, leads, knowledge), the Vectorize index, and an AI Search instance murmur made. murmur.json, prompt.md and .env stay, so `murmur deploy` rebuilds it. Irreversible.

| Option | |
| --- | --- |
| `--keep-data` | Keep the D1 database and the Vectorize index |

### `murmur secret`

```
murmur secret set <NAME> [--value <v>]   |   murmur secret list
```

Store a secret in .env and, if deployed, on the Worker. The value is read from --value, from stdin when piped, or prompted (hidden) in a terminal. Values are never printed.

```bash
murmur secret set OPENAI_API_KEY
echo "$KEY" | murmur secret set OPENAI_API_KEY
murmur secret list --json
```

### `murmur config`

```
murmur config get [path] | set <path> <value> | pull | export [--live] | import <file> | schema
```

Read or change murmur.json by dotted path; values are parsed as JSON when they look like JSON, else as text, and the result is validated before it is saved. `pull` brings settings changed in the dashboard into murmur.json (deploy refuses to overwrite them otherwise). `export --live` prints the live settings; `import` takes a murmur.json, or a settings object (published live, then pulled).

```bash
murmur config pull && murmur deploy
murmur config set backend.model @cf/qwen/qwen3-30b-a3b-fp8
murmur config set backend.timezone Australia/Melbourne
murmur config get backend
murmur config set backend.model gpt-5
murmur config set widget.brand.accent "#0EA5E9"
murmur config set knowledge.files '["./docs"]'
```

### `murmur prompt`

```
murmur prompt [status | pull [--version N] | history [--limit N] | show [N]] [--json]
```

The prompt is versioned: every `murmur deploy` that changes prompt.md, and every edit or restore in the dashboard, publishes a new version (history in the dashboard database). `status` compares prompt.md with the live version: in_sync, ahead (deploy publishes it), behind or diverged (pull first). Deploy refuses behind and diverged, so a dashboard edit is never overwritten unseen.

| Option | |
| --- | --- |
| `--version <N>` | pull: write version N into prompt.md; deploying it then restores it as a new version |
| `--limit <N>` | history: how many versions to list (default 20) |

```bash
murmur prompt
murmur prompt pull
murmur prompt pull --version 3 && murmur deploy
murmur prompt history --json
murmur prompt show 2
```

When pull finds unpublished edits in prompt.md it keeps them as prompt.mine.md instead of discarding them: merge what you need into prompt.md, delete prompt.mine.md, and deploy.

### `murmur validate`

```
murmur validate [--json]
```

Validate murmur.json and prompt.md and compile the Worker config, without touching Cloudflare.

### `murmur schema`

```
murmur schema
```

Print the JSON Schema for murmur.json.

### `murmur status`

```
murmur status [--json]
```

Show the site, backend, deployment URL, preview and embed snippet; for workers-ai also the crawl, the passages and today's usage against the free budget.

### `murmur doctor`

```
murmur doctor [--json]
```

Run every check and print a fix for each failure. Exit code 1 if any check fails.

### `murmur embed`

```
murmur embed
```

Print the <script> tag to paste into the site.

### `murmur users`

```
murmur users list | add <email> | remove <email> | reset <email> [--password <p>]
```

Manage who can sign in to the dashboard. The owner is dashboard.adminEmail; others are stored in the D1 database. A password is generated and shown once when --password is omitted.

```bash
murmur users add sam@acme.com
murmur users reset owner@acme.com --json
murmur users list
```

### `murmur webhooks`

```
murmur webhooks list | add <url> [--events a,b] [--description …] | remove <id> | test <id> | enable <id> | disable <id> | events
```

Endpoints that receive what happens, as signed JSON: conversations, messages, leads, callback requests and their updates, summaries, budget alerts, learning (`murmur webhooks events` lists every type). The same as Settings → Webhooks in the dashboard; stored on the Worker. Each has a signing secret: X-Murmur-Signature is sha256= + hex HMAC-SHA256 of "<X-Murmur-Timestamp>.<body>". https only; up to 10 per site.

```bash
murmur webhooks add https://hooks.zapier.com/hooks/catch/123/abc --events lead.captured,callback.requested --json
murmur webhooks test wh_1a2b3c
murmur webhooks list --json
```

### `murmur callbacks`

```
murmur callbacks list [--status open|done|dismissed|all] | done <id> [--note …] | dismiss <id> [--note …] | reopen <id>
```

Visitors who asked to be called back, the same as the dashboard's Callbacks page: waiting ones oldest first, with how to reach them, why, and the conversation. Mark one done (with a note of what happened) or dismissed; each change sends the callback.updated webhook. A conversation has at most one waiting request; asking again updates it.

```bash
murmur callbacks --json
murmur callbacks done cb_k2x9 --note "Booked a measure for Tuesday"
murmur callbacks list --status done
```

### `murmur dashboard`

```
murmur dashboard [--email <e>] [--no-browser]
```

Mint a one-time sign-in link to the dashboard (15 minutes), or the setup link if nobody has an account yet, and open it. The recovery path for a lost password.

### `murmur skill`

```
murmur skill install [--project] [--codex]  |  murmur skill print
```

Install the "website-chatbot" agent skill so a fresh Claude Code session knows how to set up, test and deploy an assistant: into ~/.claude/skills (default) or this repository (--project); --codex also adds it to ~/.codex/AGENTS.md. Or install the Claude Code plugin, which bundles the skill and the MCP server.

```bash
npx -y @knowtific/murmur skill install
npx -y @knowtific/murmur skill install --codex
```

### `murmur mcp`

```
murmur mcp
```

Serve the murmur tools over MCP (stdio). Add to Claude Code with: claude mcp add murmur -- npx -y @knowtific/murmur mcp
