<!-- Generated from packages/cli/src/help.ts by `pnpm sync:docs`. Edit that file, not this page. -->

# CLI reference

Run any command with `npx @knowtific/helppuff <command>` (or `helppuff <command>` once installed).
`helppuff <command> --help` prints the same in a terminal.

**Every command** takes `--json` (stdout is one JSON object: `{"ok":true,…}` or
`{"ok":false,"error":{code,message,hint}}`; progress goes to stderr), `--non-interactive`,
`--cwd <dir>` and `--yes`. **Exit codes:** `0` ok · `1` error · `2` bad usage or missing
input · `3` auth or permission · `4` Cloudflare quota or limit · `10` needs_input.

### `helppuff init`

```
helppuff init [options]
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
| `--http-mode <mode>` | http backend: helppuff \| openai |
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
| `--onboarding <mode>` | defaults: learn suggested pages automatically \| dashboard: let the user choose pages and details |
| `--no-browser` | Do not open the setup page; continue in the terminal |
| `--force` | Overwrite an existing helppuff.json |

```bash
helppuff init
helppuff init --url acme.com.au --deploy --onboarding defaults --yes --json
helppuff init --url acme.com.au --deploy --onboarding dashboard --yes --json
helppuff init --url acme.com.au --deploy --crawl "**/services/**,**/faq/**" --yes --json
helppuff init --url acme.com --backend cloudflare --yes --json
helppuff init --url acme.com --backend openai --api-key "$OPENAI_API_KEY" --deploy --json
helppuff init --url acme.com --backend http --http-url https://api.acme.com/chat --http-mode helppuff --json
```

### `helppuff upgrade`

```
npx @knowtific/helppuff@latest upgrade [--check] [--yes] [--allow-downgrade]
```

Bring the deployed assistant to this release. Shows what is live, what will change (helppuff.json format, D1 migrations), notes a restore point (D1 Time Travel: the database can be put back to just before, for 7 days on the Free plan), then deploys. Data, settings, prompt versions and the knowledge base are kept. Run it with @latest so npx fetches the newest CLI.

| Option | |
| --- | --- |
| `--check` | Only report: versions, pending migrations, helppuff.json changes |
| `--yes` | Go ahead without asking (needed with --json or without a terminal) |
| `--allow-downgrade` | Go to this release although the Worker runs a newer one |

```bash
npx @knowtific/helppuff@latest upgrade
npx -y @knowtific/helppuff@latest upgrade --check --json
npx -y @knowtific/helppuff@latest upgrade --yes --json
```

Rolling back: npx @knowtific/helppuff@<previous version> deploy --allow-downgrade. Migrations only add tables and columns, so the previous release runs on the upgraded database. To also put the data back, use the restore command upgrade printed (wrangler d1 time-travel restore).

### `helppuff deploy`

```
helppuff deploy [options]
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
| `--onboarding <mode>` | first deploy: defaults starts learning automatically; dashboard leaves page selection to the setup page. Remembered for later deploys |
| `--overwrite-settings` | Publish helppuff.json over settings changed in the dashboard (otherwise: config pull first) |
| `--allow-downgrade` | Deploy although the Worker runs a newer release: a deliberate rollback |
| `--account-id <id>` | The Cloudflare account, when the token sees several |

```bash
helppuff deploy
helppuff deploy --json
helppuff deploy --onboarding dashboard --json
helppuff deploy --crawl suggested --json
helppuff deploy --knowledge
```

workers-ai: the first deploy creates a Vectorize index, a D1 database, a KV namespace and a Workflow, generates ADMIN_API_KEY into .env, and returns setupUrl — a one-time link (24h) to the setup page. Re-running never creates duplicates.

### `helppuff dev`

```
helppuff dev [--port 8787]
```

Run the assistant locally with wrangler, using secrets from .env. Open http://localhost:8787 to try it; `helppuff chat --local` talks to it.

### `helppuff chat`

```
helppuff chat [message] [--session <token>] [--local] [--json]
```

Send a message through the real API, as a visitor would. Without a message in a terminal it opens an interactive chat. Pass the returned "session" back with --session to continue a conversation.

| Option | |
| --- | --- |
| `--session <token>` | Continue a conversation |
| `--local` | Talk to `helppuff dev` on localhost:8787 instead of the deployed Worker |
| `--url <url>` | Talk to another deployment |

```bash
helppuff chat "How much does a service cost?" --json
helppuff chat "And on weekends?" --session <token> --json
helppuff chat
```

### `helppuff knowledge`

```
helppuff knowledge status | sync [--wait] | add (--file f.md | --title t --text …) | upload <file…> [--wait] | files [remove <id>] | list | remove <id> | pages [--status s] | facts [set k=v …] | suggest [--apply]
```

workers-ai: the knowledge base on your Worker. `sync` re-crawls the selected pages (same as `helppuff crawl`); `add` indexes hand-written knowledge at once; `upload` sends PDF, Word (.docx), Markdown or text files (up to 10 MB) that the Worker reads, cleans and learns in the background — `files` shows their progress, and `--wait` follows them to the end. Files listed in `knowledge.files` in helppuff.json are synced on every deploy (new and changed ones uploaded, removed ones deleted); `facts` are the business details (phone, hours…) answers always see — yours are never overwritten by a crawl. Other backends: `sync` uploads the website and knowledge.files to AI Search, an OpenAI vector store or a Gemini File Search store.

```bash
helppuff knowledge status --json
helppuff knowledge add --file faq.md
helppuff knowledge upload price-list.pdf brochure.docx --wait --json
helppuff knowledge add --title "Warranty" --text "All installs carry a 5 year warranty."
helppuff knowledge facts set phone="03 9876 5432" hours="Mon-Fri 7am-5pm"
helppuff knowledge pages --status error
helppuff knowledge suggest --apply   (starter questions written from the crawled pages)
```

### `helppuff discover`

```
helppuff discover [--json]
```

workers-ai: find the pages of the site — home page links, robots.txt sitemaps and sitemap indexes — each with a category (service, faq, contact, pricing, legal…) and whether it is selected. Legal pages, archives and old blog posts start unselected.

### `helppuff crawl`

```
helppuff crawl [--all | --urls a,b | --file urls.txt | --include globs] [--wait] [--json]
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
helppuff crawl --wait
helppuff crawl --include "**/services/**,**/faq/**" --json
helppuff crawl --urls https://acme.com.au/pricing
```

### `helppuff ask`

```
helppuff ask "<question>" [--session <token>] [--timing] [--json]
```

Ask the deployed assistant as a visitor would, and show the passages retrieval found for it with their scores. When nothing passes the relevance threshold the assistant should say it is not sure — if it answers anyway, tighten prompt.md.

```bash
helppuff ask "Do you service Lilydale?"
helppuff ask "How much is a hot water service?" --timing
```

--timing prints where the time went, stage by stage (auth, limits, context, rag.embed / vector / keyword / rerank, llm.first_token, llm.round1…), from the Worker's Server-Timing header.

### `helppuff eval`

```
helppuff eval <golden.json> [--min 0.8] [--json]
```

Ask the deployed assistant a set of real visitor questions, each in a fresh conversation, and score them: retrieval found the expected page (`source`, a URL substring), the reply mentions every `contains`, and `refuse` questions get "not sure" rather than a guess. Exit code 1 when the share passing is below --min.

```bash
helppuff eval golden.json
helppuff eval golden.json --min 0.9 --json
```

golden.json: [{ "question": "What's your phone number?", "source": "/contact", "contains": ["9876 5432"] }, { "question": "Can you fix my car?", "refuse": true }]

### `helppuff destroy`

```
helppuff destroy --yes [--keep-data]
```

Delete everything this project created on Cloudflare: the Worker and its Workflow, KV, the D1 database (conversations, leads, knowledge), the Vectorize index, and an AI Search instance helppuff made. helppuff.json, prompt.md and .env stay, so `helppuff deploy` rebuilds it. Irreversible.

| Option | |
| --- | --- |
| `--keep-data` | Keep the D1 database and the Vectorize index |

### `helppuff secret`

```
helppuff secret set <NAME> [--value <v>]   |   helppuff secret list
```

Store a secret in .env, even before init, and, if deployed, on the Worker. The value is read from --value, from stdin when piped, or prompted (hidden) in a terminal. Values are never printed. Listing secrets requires an initialized project.

```bash
helppuff secret set OPENAI_API_KEY
echo "$KEY" | helppuff secret set OPENAI_API_KEY
helppuff secret list --json
```

### `helppuff config`

```
helppuff config get [path] | set <path> <value> | pull | export [--live] | import <file> | schema
```

Read or change helppuff.json by dotted path; values are parsed as JSON when they look like JSON, else as text, and the result is validated before it is saved. `pull` brings settings changed in the dashboard into helppuff.json (deploy refuses to overwrite them otherwise). `export --live` prints the live settings; `import` takes a helppuff.json, or a settings object (published live, then pulled).

```bash
helppuff config pull && helppuff deploy
helppuff config set backend.model @cf/qwen/qwen3-30b-a3b-fp8
helppuff config set backend.timezone Australia/Melbourne
helppuff config get backend
helppuff config set backend.model gpt-5
helppuff config set widget.brand.accent "#0EA5E9"
helppuff config set knowledge.files '["./docs"]'
```

### `helppuff prompt`

```
helppuff prompt [status | pull [--version N] | history [--limit N] | show [N]] [--json]
```

The prompt is versioned: every `helppuff deploy` that changes prompt.md, and every edit or restore in the dashboard, publishes a new version (history in the dashboard database). `status` compares prompt.md with the live version: in_sync, ahead (deploy publishes it), behind or diverged (pull first). Deploy refuses behind and diverged, so a dashboard edit is never overwritten unseen.

| Option | |
| --- | --- |
| `--version <N>` | pull: write version N into prompt.md; deploying it then restores it as a new version |
| `--limit <N>` | history: how many versions to list (default 20) |

```bash
helppuff prompt
helppuff prompt pull
helppuff prompt pull --version 3 && helppuff deploy
helppuff prompt history --json
helppuff prompt show 2
```

When pull finds unpublished edits in prompt.md it keeps them as prompt.mine.md instead of discarding them: merge what you need into prompt.md, delete prompt.mine.md, and deploy.

### `helppuff validate`

```
helppuff validate [--json]
```

Validate helppuff.json and prompt.md and compile the Worker config, without touching Cloudflare.

### `helppuff schema`

```
helppuff schema
```

Print the JSON Schema for helppuff.json.

### `helppuff status`

```
helppuff status [--json]
```

Show the site, backend, deployment URL, preview and embed snippet; for workers-ai also the crawl, the passages and today's usage against the free budget.

### `helppuff doctor`

```
helppuff doctor [--json]
```

Run every check and print a fix for each failure. Exit code 1 if any check fails.

### `helppuff embed`

```
helppuff embed
```

Print the <script> tag to paste into the site.

### `helppuff users`

```
helppuff users list | add <email> [--role admin|member] | role <email> admin|member | remove <email> | reset <email> [--password <p>]
```

Manage who can sign in to the dashboard. The owner is dashboard.adminEmail; others are stored in the D1 database. Admins (the default) can do everything; members see only conversations, contacts, callbacks and live chat, and their own notifications. A password is generated and shown once when --password is omitted.

```bash
helppuff users add sam@acme.com --role member
helppuff users role sam@acme.com admin
helppuff users reset owner@acme.com --json
helppuff users list
```

### `helppuff live`

```
helppuff live on [--wait <seconds>] [--close-after <minutes>] [--names|--no-names] | off | status
```

Live chat: a visitor who asks for a person is handed to your team, who answer from the dashboard (with a notification and a sound) or Telegram. When nobody is available, or nobody takes the chat in --wait seconds (default 120), the visitor gets the callback form. Conversations close after --close-after minutes without a message (default 60); a visitor who writes again is answered by the assistant. Off by default. Saved live and in helppuff.json (`live`).

```bash
helppuff live on --json
helppuff live on --wait 180 --no-names
helppuff live status --json
helppuff live off
```

Someone has to be able to take chats: a dashboard open and set to Available, or Telegram linked (`helppuff telegram connect`).

### `helppuff telegram`

```
helppuff telegram connect [--token <bot token>] | status | test | disconnect
```

Answer live chats from Telegram: each chat is a thread in your team's group (Topics on, the bot an admin with "Manage topics") or in your own chat with the bot. connect takes the token @BotFather gives you (from --token, piped, or prompted; stored encrypted on the Worker), then send /link <code> in the chat to answer from. In a thread: write to answer, /take, /close, /ai (back to the assistant), /info.

```bash
helppuff telegram connect --token 7123456789:AA… --json
echo "$BOT_TOKEN" | helppuff telegram connect
helppuff telegram status --json
helppuff telegram test
```

Making the bot with @BotFather, and sending /link in the chat, are steps for the person: an agent can run everything else once it has the token.

### `helppuff webhooks`

```
helppuff webhooks list | add <url> [--events a,b] [--description …] | remove <id> | test <id> | enable <id> | disable <id> | events
```

Endpoints that receive what happens, as signed JSON: conversations, messages, leads, callback requests and their updates, summaries, budget alerts, learning (`helppuff webhooks events` lists every type). The same as Settings → Webhooks in the dashboard; stored on the Worker. Each has a signing secret: X-HelpPuff-Signature is sha256= + hex HMAC-SHA256 of "<X-HelpPuff-Timestamp>.<body>". https only; up to 10 per site.

```bash
helppuff webhooks add https://hooks.zapier.com/hooks/catch/123/abc --events lead.captured,callback.requested --json
helppuff webhooks test wh_1a2b3c
helppuff webhooks list --json
```

### `helppuff keys`

```
helppuff keys list | create <name> [--preset chat|crm|read|full | --scopes a,b] [--expires <days>] [--allow-ips a,b] [--rate <n>] [--save NAME] | revoke <id>
```

API keys for the public API at <worker>/api/v1, the same as Settings → API keys in the dashboard. A key works on one site, with the scopes you give it (presets: chat, crm, read, full), an optional expiry, IP allowlist and requests a minute. The full key is shown once (or, with --save NAME, written to .env instead of printed); only a keyed hash is stored. Revoked keys are refused everywhere within 30 seconds. See the wiki's API page.

```bash
helppuff keys create "Website backend" --preset chat --expires 365
helppuff keys create "CRM sync" --scopes leads:read,leads:write --save HELPPUFF_CRM_KEY --json
helppuff keys revoke k7m3p9q2r4s8
```

### `helppuff api`

```
helppuff api <GET|POST|PUT|PATCH|DELETE> <path> [--data '{…}' | --data @file.json]
```

Call any endpoint of the public API (/api/v1) with this project's admin key, and print the JSON answer. For agents and scripts: everything the dashboard can do, without a command for each. The wiki's API reference lists every endpoint.

```bash
helppuff api GET /leads
helppuff api POST /conversations --data '{"message":"Do you work weekends?"}' --json
helppuff api PATCH /leads/lead_123 --data @status.json
```

### `helppuff callbacks`

```
helppuff callbacks list [--status open|done|dismissed|all] | done <id> [--note …] | dismiss <id> [--note …] | reopen <id>
```

Visitors who asked to be called back, the same as the dashboard's Callbacks page: waiting ones oldest first, with how to reach them, why, and the conversation. Mark one done (with a note of what happened) or dismissed; each change sends the callback.updated webhook. A conversation has at most one waiting request; asking again updates it.

```bash
helppuff callbacks --json
helppuff callbacks done cb_k2x9 --note "Booked a measure for Tuesday"
helppuff callbacks list --status done
```

### `helppuff dashboard`

```
helppuff dashboard [--email <e>] [--no-browser]
```

Mint a one-time sign-in link to the dashboard (15 minutes), or the setup link if nobody has an account yet, and open it. The recovery path for a lost password.
