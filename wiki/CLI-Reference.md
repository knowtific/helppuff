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
helppuff knowledge status | sync [--wait] | add (--file f.md | --title t --text …) | upload <file…> [--wait] | files [remove <id>] | list | remove <id> | pages [--status s] | facts [set k=v …] | suggest [--apply] | gaps [--status open|answered|dismissed|all] | answer <id> --text … | dismiss <id>
```

workers-ai: the knowledge base on your Worker. `sync` re-crawls the selected pages (same as `helppuff crawl`); `add` indexes hand-written knowledge at once; `upload` sends PDF, Word (.docx), Markdown or text files (up to 10 MB) that the Worker reads, cleans and learns in the background — `files` shows their progress, and `--wait` follows them to the end. Files listed in `knowledge.files` in helppuff.json are synced on every deploy (new and changed ones uploaded, removed ones deleted); `facts` are the business details (phone, hours…) answers always see — yours are never overwritten by a crawl. `gaps` lists the questions to answer: what visitors asked about the business that the assistant could not answer and the knowledge base does not cover (found after each conversation; off-topic questions and ones the instructions say not to answer are left out), most asked first; `answer <id> --text …` saves the owner's answer as hand-written knowledge, live at once (no `--text`: needs_input, the answer is the owner's to give); `dismiss <id>` takes one off the list. Other backends: `sync` uploads the website and knowledge.files to AI Search, an OpenAI vector store or a Gemini File Search store.

```bash
helppuff knowledge status --json
helppuff knowledge add --file faq.md
helppuff knowledge upload price-list.pdf brochure.docx --wait --json
helppuff knowledge add --title "Warranty" --text "All installs carry a 5 year warranty."
helppuff knowledge facts set phone="03 9876 5432" hours="Mon-Fri 7am-5pm"
helppuff knowledge pages --status error
helppuff knowledge gaps --json
helppuff knowledge answer gap_4f3e2d1c0b9a --text "No: natural gas only. For LPG, call a licensed gas fitter."
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

Delete everything this project created on Cloudflare: the Worker and its Workflow, KV, the D1 database (conversations, leads, knowledge), the Vectorize index, an AI Search instance helppuff made, and the R2 bucket of photos and files (emptied first). Without --yes you type the site name, and it asks before deleting the files. helppuff.json, prompt.md and .env stay, so `helppuff deploy` rebuilds it. Irreversible.

| Option | |
| --- | --- |
| `--keep-data` | Keep the D1 database, the Vectorize index and the files bucket |

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

### `helppuff logs`

```
helppuff logs [--method POST] [--search text] [--json --seconds 15]
```

Tail the deployed Worker's Cloudflare logs in this terminal until Ctrl-C. Uses the existing wrangler login or CLOUDFLARE_API_TOKEN from .env. --json collects a bounded snapshot (15 seconds by default) as one JSON result.

| Option | |
| --- | --- |
| `--method <method>` | Only requests with this HTTP method (for example POST) |
| `--search <text>` | Filter console log messages by text |
| `--seconds <1–300>` | With --json, how long to collect events (default 15) |
| `--cf-account, --account-id <id>` | Cloudflare account, if the token can access several |
| `--cf-token <token>` | Cloudflare API token; prefer CLOUDFLARE_API_TOKEN in .env to avoid shell history |
| `--json` | Return one JSON object with events collected for the chosen duration |

```bash
helppuff logs
helppuff logs --method POST
helppuff logs --json --seconds 10
```

A Cloudflare API token needs Workers Tail Read (or Workers Scripts Write) on the Worker. The tail shows new requests only; older stored logs are in Cloudflare Workers Observability. The audit API records successful changes, not failed sign-ins or rejected API keys.

### `helppuff domain`

```
helppuff domain [status] | add <hostname> [--wait <seconds>] | remove [<hostname>] [--yes]
```

A custom domain for the assistant, e.g. chat.acme.com, through Cloudflare Workers Custom Domains: Cloudflare makes the DNS record and the certificate. The domain must be a zone (Active) on the same Cloudflare account, and the hostname must not have a DNS record of its own. `add` attaches it, saves it as cloudflare.domain in helppuff.json and waits up to --wait seconds (60; 0 with --json) for it to answer; the embed snippet, preview and dashboard links then use it, and `helppuff deploy` attaches it again if it went missing. workers.dev keeps working, so pages with the old script are fine. `remove` detaches it (asks first; --yes for scripts). `status` says whether it is attached and answering.

| Option | |
| --- | --- |
| `--wait <seconds>` | With add: how long to wait for the domain to answer (default 60, 0 with --json) |
| `--yes` | With remove: do not ask |
| `--cf-account, --account-id <id>` | Cloudflare account, if the token can access several |
| `--cf-token <token>` | Cloudflare API token; prefer CLOUDFLARE_API_TOKEN in .env |

```bash
helppuff domain add chat.acme.com
helppuff domain --json
helppuff domain remove chat.acme.com --yes --json
```

A Cloudflare API token needs Workers Scripts › Edit (and Zone › Read to find the zone); `wrangler login` has both. A domain whose DNS is elsewhere must be added to Cloudflare first (nameservers changed at the registrar). Removing the domain leaves its certificate in Cloudflare (SSL/TLS → Edge Certificates).

### `helppuff embed`

```
helppuff embed
```

Print the <script> tag to paste into the site.

### `helppuff users`

```
helppuff users list | add <email> [--role admin|member] | role <email> admin|member | remove <email> | reset <email> [--password <p>]
```

Manage who can sign in to the dashboard. The owner is dashboard.adminEmail; others are stored in the D1 database. Admins (the default) can do everything; members see only conversations, jobs, contacts, callbacks and live chat, and their own notifications. A password is generated and shown once when --password is omitted.

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
helppuff webhooks list | add <url> [--events a,b] [--description …] [--method POST] [--header 'Name: value'] [--body '…'] | set <id> [--url …] [the same flags] [--format helppuff|custom] | remove <id> | test <id> | enable <id> | disable <id> | events
```

Endpoints that receive what happens, as signed JSON: conversations, messages, leads, callback requests and their updates, summaries, budget alerts, learning (`helppuff webhooks events` lists every type). The same as Settings → Webhooks in the dashboard; stored on the Worker. Each has a signing secret: X-HelpPuff-Signature is sha256= + hex HMAC-SHA256 of "<X-HelpPuff-Timestamp>.<body>". `--method`, `--header` or `--body` make it a custom webhook: your own request, for a service with its own format (Slack, a CRM, an SMS API), with `{{event.type}}`, `{{data.name}}`… in the body (and the address's path); credential headers are stored encrypted, `${NAME}` comes from .env. `--format helppuff` goes back to the envelope. https only; up to 10 per site.

```bash
helppuff webhooks add https://hooks.zapier.com/hooks/catch/123/abc --events lead.captured,callback.requested --json
helppuff webhooks add https://slack.com/api/chat.postMessage --events callback.requested --header 'Authorization: Bearer ${SLACK_BOT_TOKEN}' --body '{"channel": "#sales", "text": "Call {{data.name}} on {{data.phone}}"}'
helppuff webhooks test wh_1a2b3c
helppuff webhooks list --json
```

### `helppuff email`

```
helppuff email show | set --preset resend|postmark|sendgrid|brevo --from <address> --key '${NAME}' | set --url <https://…> [--method POST] [--header 'Name: value'] [--body '…'] | set --cloudflare --from <address> | test --to <address> | pause | resume | remove | replies on <subdomain> [--enable] | replies status | replies test [--enable] | replies off
```

The email service that sends the team's notifications, the same as Settings → Notifications in the dashboard (stored on the Worker). One request for any service with a send API: HelpPuff writes each email and fills in {{email.to}} (one person per request), {{email.subject}}, {{email.text}} and {{email.html}} (the text, escaped). `--preset` fills the request in for Resend, Postmark, SendGrid or Brevo; `--url`, `--header` and `--body` write or change it for any other service. The key is stored encrypted; write `${NAME}` to take it from .env (a missing one answers needs_input). Who gets which email (new contacts, hot leads, callbacks, live chats, jobs, bookings) is each person's choice in the dashboard. `--cloudflare --from` sends with Cloudflare Email Service instead (no key: the Worker's binding; it onboards the domain for sending and deploys; emailing customers needs Workers Paid). `replies` sets up answers by email (Customer emails): `on <subdomain>` turns Cloudflare Email Routing on for a subdomain of a domain on this Cloudflare account (never the domain itself, nor one that receives mail elsewhere), adds the rule that hands reply@<subdomain> to the Worker and sends a test; `--enable` turns answers by email on once the test arrives. `status` checks each part, `test` sends the test again, `off` deletes the rule.

```bash
helppuff email set --preset resend --from 'HelpPuff <assistant@yourdomain.com>' --key '${RESEND_API_KEY}' --json
helppuff email set --url https://api.example-mail.com/send --header 'X-Api-Key: ${MAIL_KEY}' --body '{"to": "{{email.to}}", "subject": "{{email.subject}}", "text": "{{email.text}}"}'
helppuff email test --to you@yourdomain.com
helppuff email show --json
helppuff email set --cloudflare --from hello@chat.yourdomain.com
helppuff email replies on chat.yourdomain.com --enable --json
helppuff email replies status
```

The address to send from must be on a domain verified in the email service. Links in emails go to the dashboard address the CLI saved it through. Sub-addressing (reply+…@) has no API: when it is off, `replies on` answers needs_input with the one dashboard click (Email → Email Routing → Settings → Subaddressing). The switches for customer emails are in the dashboard (Settings → Customer emails) or `customerEmails` in helppuff.json.

### `helppuff tools`

```
helppuff tools list | show <name> | add <name> (--curl '…' | --url <https://…> [--method POST] [--header "Name: value"] [--body …] | --extract --field name="what it is") --description "…" [--param name="what it is"] [--pick a,b] [--before] [--after [--when path=value,…]] [--timeout ms] | set <name> [the same flags, --no-before, --no-after] | test <name> [--arg name=value] [--prechat field=value] [--data tool.key=value] | enable <name> | disable <name> | remove <name>
```

The site's own tools, the same as on the dashboard's Prompt page (stored on the Worker). An http tool calls your API: `{{args.x}}` in its URL, headers or body is filled in by the assistant, `{{prechat.email}}` from the pre-chat form, `{{data.other_tool.key}}` from another tool. `--before` runs it when a chat starts, `--after` when the conversation ends (with the transcript, summary, contact and all the data; an empty body sends all of it as JSON); `--when labels.leadQuality=hot` runs an after-chat tool only for those conversations (`--when lead.email`: only with an email; `--when none`: always). An extract tool (`--extract`) reads the finished conversation and saves values the visitor stated as conversation attributes; new extract tools run after the chat by default. Name an HTTP tool in the prompt as {{name}} to let the assistant use it, and {{name.key}} to put in what it returned. What tools return or save is kept on the conversation, shown in the dashboard and sent to webhooks. Credential headers (Authorization, X-Api-Key…) are stored encrypted and never read back; write `${NAME}` in a header to take the value from .env (a missing one answers needs_input). Up to 30 per site; https only.

```bash
helppuff tools add order_status --curl 'curl https://api.acme.com/orders/{{args.order_number}} -H "Authorization: Bearer ${ACME_API_KEY}"' --description 'Look up an order by its number' --param order_number='Like A-1042' --json
helppuff tools add crm_lookup --url https://crm.acme.com/lookup --method POST --body '{"email":"{{prechat.email}}"}' --header 'X-Api-Key: ${CRM_KEY}' --before --description 'The customer in our CRM'
helppuff tools add order_number --extract --field order_number='Like A-1042' --description 'Find the order number the visitor gave during the chat'
helppuff tools test order_status --arg order_number=A-1042 --json
helppuff tools test track_shipment --data order_lookup.carrier=shippo --data order_lookup.tracking_number=SHIPPO_TRANSIT
```

Then reference the tool in prompt.md ({{order_status}}) and `helppuff deploy`, or edit the prompt in the dashboard. Tools apply to HelpPuff's assistant (any model); with a whole backend (Retell, your own API) only after-chat tools run.

### `helppuff agent`

```
helppuff agent templates | export [file.json] | import <file.json|template> [--dry-run]
```

The agent file: the assistant's setup in one JSON file, the same as the dashboard's Settings → Import & export. It holds the prompt, the tools, and the behaviour and lead form settings (not the branding, the knowledge or the team). `export` writes the live setup; secret headers become `${NAME}` placeholders, listed in `needs`. `import` takes a file or a template's id, checks it, then applies it: settings, tools (matched by name: created or replaced) and the prompt as a new version. Each `${NAME}` comes from .env (a missing one answers needs_input), and prompt.md and helppuff.json are brought up to date. `--dry-run` shows what would change. `templates` lists the ready-made ones, each with its tutorial.

```bash
helppuff agent templates
helppuff agent import order-tracking --dry-run
helppuff agent import order-tracking --json
helppuff agent export agent.json
helppuff agent import agent.json
```

Keep agent.json in your project to share or restore a setup. Secrets are never in it: set them with `helppuff secret set NAME`, then import.

### `helppuff bookings`

```
helppuff bookings [show] | mode <none|link|picker|auto> [--link url] | sync <none|calcom|calendly|google|outlook> [--event-type id] [--account id] [--calendar id] | set [--title …] [--duration 30] [--buffer 15] [--notice 120] [--days-ahead 30] [--timezone Area/City] [--phone off|optional|required] [--location …] [--label …] [--hours "mon=09:00-17:00;sat="] [--sync-minutes 15] | slots [--from YYYY-MM-DD] [--to YYYY-MM-DD] | test [calendar]
```

Appointments, the same as the dashboard's Settings → Bookings. `mode`: `none`, `link` (the chat offers your booking page; the booking happens there) or `picker` (a date picker in the chat: the visitor picks a free time and HelpPuff books it; the assistant suggests, never books). `auto` hands the choice back to the website: a booking link found on it (Calendly, Cal.com, Acuity…) is offered. With the picker, `sync` picks the calendar free time is read from and bookings are written to: `none` (HelpPuff keeps them, free time from `--hours`), `calcom` or `calendly` (their event type: `--event-type`; `test` lists them), `google` or `outlook` (through Composio). Keys: `helppuff integrations`. Appointments then belong to jobs, show on the dashboard's Calendar, and send the appointment.* webhooks.

```bash
helppuff bookings
helppuff bookings mode picker
helppuff bookings set --duration 45 --hours "mon=09:00-17:00;tue=09:00-17:00;fri=09:00-12:00;sat=" --timezone Australia/Melbourne
helppuff bookings sync calcom --event-type 1234567
helppuff bookings slots --json
```

Changes are live within a minute; run `helppuff config pull` to keep helppuff.json (`bookings`) in step. Why the AI never books: the wiki page AI-Booking-Tests.

### `helppuff appointments`

```
helppuff appointments list [--from …] [--to …] [--status active|all|confirmed|cancelled|completed|no_show|busy] [--job id] | add --start ISO [--duration 30 | --end ISO] [--name …] [--email …] [--phone …] [--title …] [--job id] [--location …] [--notes …] [--force] | move <id> --start ISO | cancel <id> [--reason …] | done <id> | no-show <id> | delete <id> | sync
```

The appointments, the same as the dashboard's Calendar page (on with the date picker). `add` books one by hand: written to the synced calendar first, then put on a job (`--job`, else the contact's open job, else a new one); a time that overlaps another is refused unless `--force`. `move` reschedules it there too; `cancel` cancels it there (the record stays); `delete` cancels and removes it. `sync` reads the synced calendar now (30 days back, 90 ahead): new events become appointments when an attendee is a contact, else busy time. Times are ISO 8601 with an offset, or milliseconds.

```bash
helppuff appointments list --json
helppuff appointments add --start 2026-10-15T09:00:00+11:00 --name "Ada Lovelace" --email ada@example.com --title "Site visit"
helppuff appointments move apt_4f1c2b9e --start 2026-10-16T10:00:00+11:00
helppuff appointments sync
```

### `helppuff integrations`

```
helppuff integrations [list] | add <composio|calcom|calendly> --key-env NAME [--base-url https://…] | test <kind> | remove <kind> | accounts [google|outlook] | connect <google|outlook> | calcom-webhook
```

Keys for other services, the same as the dashboard's Settings → Integrations: stored sealed on the Worker (live at once, never shown again) and reused by any feature. `add` reads the key from .env (a missing one answers needs_input; set it with `helppuff secret set NAME`) and checks it. Composio connects Google Calendar and Outlook without an OAuth app of your own: `connect google` prints a sign-in link, `accounts` lists what is connected. Cal.com self-hosted: `--base-url` is your API v2 address. `calcom-webhook` prints the address and secret for Cal.com's webhook, so changes there show at once.

```bash
helppuff secret set CALCOM_API_KEY && helppuff integrations add calcom --key-env CALCOM_API_KEY
helppuff integrations add composio --key-env COMPOSIO_API_KEY
helppuff integrations connect google
helppuff integrations accounts google --json
```

### `helppuff identity`

```
helppuff identity [rotate]
```

The site's identity secret, the same as the dashboard's Settings → Lead form → Signed-in visitors. Your server signs a short JWT (HS256) for whoever is logged in (`sub` = your user id, plus any claims such as email or plan; `exp` at most a week ahead), and the page passes it: `HelpPuff.identify({ name, email, token })`. The Worker checks it when a chat starts: the claims become `{{user.*}}` for tools and the prompt, override the lead's email and name, and are kept on the conversation. A bad or expired token is ignored. `rotate` makes a new secret: tokens signed with the old one stop working at once.

```bash
helppuff identity
helppuff identity rotate --json
```

From your own server, the API takes the user directly instead: POST /conversations with "user": { "id": … }.

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

### `helppuff jobs`

```
helppuff jobs list [--status open|won|lost|all] [--search …] | show <job> | create [--title …] [--fields '{…}'] [--name …] [--email …] [--phone …] [--details …] [--value N] | move <job> <stage> [--reason …] | update <job> <text> | files <job> | attach <job> <path…> | detach <job> <file> | pipeline | template <id> | setup
```

Requests, quotes and work on the site's pipeline, the same as the dashboard's Jobs page and Settings → Jobs. They come from the assistant (when a visitor asks for a quote or work done), the widget's quote questions, the API, and by hand. A job is named by its number (1042) or id; a stage by its name or id. `pipeline` shows the stages, fields and quote questions; `template` starts again from one (service-quote, projects, support, sales-demo, bookings, custom-orders, basic); `setup` lets the AI read the website and choose. `files` lists a job's photos and files (and the ones the visitor sent in its conversation) with links that work for 12 hours; `attach` uploads files (photos, PDF, Office documents, text, CSV, MP4/MOV, up to files.maxJobMb), `detach` removes one by id or name: files on jobs must be on (`helppuff files jobs on`). Each change sends the job.* webhooks.

```bash
helppuff jobs --json
helppuff jobs create --name "Ada Lovelace" --email ada@example.com --fields '{"service":"Hot water","address":"Glebe"}'
helppuff jobs move 1042 "Quote sent"
helppuff jobs move 1042 Lost --reason "Went with another quote"
helppuff jobs setup --json
helppuff jobs attach 1042 ./after-install.jpg ./compliance.pdf
```

### `helppuff files`

```
helppuff files status | chat live|always|off | jobs on|off | ai on|off [--model <id>] | limits [--max-chat-mb N] [--max-job-mb N] [--per-conversation N] [--keep-days N]
```

Photos and files, kept in the deployment's own R2 bucket (private; every link is signed and expires). Both off by default, turned on separately, the same as Settings → Advanced → Files. `chat live` lets visitors send photos and PDFs while a person has the chat (live chat must be on); `chat always` also to the assistant, which is told a file arrived but never opens it, unless `ai on`: then a vision model (Workers AI, `--model`, default Llama 4 Scout) describes each photo once and the assistant reads that (more AI usage per photo). `jobs on` lets the team attach files to jobs (`helppuff jobs attach`). `limits` sets the largest file from visitors and on jobs (MB), files per chat, and how many days chat files are kept (job files stay until removed). Needs R2 turned on once for the Cloudflare account (the dashboard asks a person to accept the plan; free up to 10 GB); `helppuff deploy` then makes the bucket. Saved live and in helppuff.json (`files`).

```bash
helppuff files status --json
helppuff files chat live
helppuff files jobs on
helppuff files ai on
helppuff files limits --max-chat-mb 5 --keep-days 30
```

### `helppuff model`

```
helppuff model | model set <workers-ai|openai-compatible|openai|gemini|anthropic|custom> [--model …] [--preset …] [--base-url …] [--key-env NAME] [--module ./llm.ts] [--secrets A,B] [--gateway …] [--gateway-id …] [--account-id …] [--yes] | model test ["question"]
```

Who writes the answers, chosen separately from the knowledge base (`helppuff rag`). Workers AI is the default (no key, on the Free plan). `openai-compatible` is any /chat/completions API with tools; presets fill the address and the key's name: deepinfra, openrouter, deepseek, groq, together, mistral, fireworks, vercel-ai-gateway, cloudflare-ai-gateway. `openai`, `gemini` and `anthropic` are those providers; `custom` is your own TypeScript file (`helppuff scaffold model`). HelpPuff's assistant (prompt, tools, citations, guardrails) stays the same whoever writes. A missing key answers needs_input: the user stores it with `helppuff secret set NAME`. Changed only here (never in the dashboard), then `helppuff deploy`; `model test` asks the deployed Worker.

```bash
helppuff model --json
helppuff model set openai-compatible --preset deepinfra --model deepseek-ai/DeepSeek-V3.1 --json
helppuff model set openai-compatible --preset openrouter --model anthropic/claude-sonnet-5 --json
helppuff model set anthropic --model claude-opus-5 --json
helppuff model set custom --module ./llm.ts --secrets MY_MODEL_KEY --json
helppuff model test "Do you do emergency callouts?" --json
```

### `helppuff rag`

```
helppuff rag | rag set <helppuff|none|ai-search|openai-vector-store|http|custom> [--url …] [--token-env NAME] [--module ./rag.ts] [--secrets A,B] [--vector-store vs_…] [--key-env NAME] [--instance …] [--endpoint …] | rag test ["question"]
```

What answers come from, chosen separately from the model. `helppuff` (the default): your site and files, learned by the Worker. `none`: the prompt and the business details only. `ai-search`: Cloudflare AI Search. `openai-vector-store`: a store you fill in OpenAI. `http`: your own search endpoint (`{ query, question, siteId, limit }` → `{ passages }`). `custom`: your own TypeScript file (`helppuff scaffold rag`); HelpPuff only calls its `search`. Changed only here, then `helppuff deploy`; `rag test` shows the passages the deployed Worker finds.

```bash
helppuff rag --json
helppuff rag set http --url https://search.example.com/query --token-env SEARCH_TOKEN --json
helppuff rag set custom --module ./rag.ts --secrets MY_SEARCH_KEY --json
helppuff rag set none --json
helppuff rag test "price of a blocked drain" --json
```

### `helppuff scaffold`

```
helppuff scaffold model|rag [--file ./llm.ts] [--use] [--force]
```

Write a starter TypeScript file for your own model (`defineModel`-shaped: one `chat` function) or knowledge base (one `search` function). It imports only types from `@knowtific/helppuff/sdk`, so it deploys without installing anything (install the package for editor types). `--use` also points helppuff.json at it. Then set its secret, deploy, and test.

```bash
helppuff scaffold model --use --json
helppuff scaffold rag --file ./search/rag.ts
```

### `helppuff dashboard`

```
helppuff dashboard [--email <e>] [--no-browser]
```

Mint a one-time sign-in link to the dashboard (15 minutes), or the setup link if nobody has an account yet, and open it. The recovery path for a lost password.
