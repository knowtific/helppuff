/**
 * Help, written for two readers: a person skimming for the next command, and
 * an AI agent that will follow it literally. The agent section is not an
 * afterthought — it is the contract (JSON shape, exit codes, the
 * needs_input loop) an agent needs to drive setup without guessing.
 */

export { VERSION } from './engine/version.js';

export const MAIN_HELP = `helppuff — an AI chat assistant for your website, on your own Cloudflare account.

USAGE
  helppuff <command> [options]
  helppuff <command> --help        details and examples for one command

QUICK START (people)
  npx @knowtific/helppuff                asks for your website, deploys, and prints one link: the setup page

QUICK START (AI agents: Claude Code, Codex, Cursor…)
  1. helppuff init --url <site> --deploy --yes --onboarding defaults --json
       → {"ok":false,"status":"needs_input","questions":[…]}   ask the user exactly these,
         then re-run with each question's "flag". Repeat until {"ok":true,"status":"created"}.
     This starts learning suggested pages and reads business details automatically. Only when
     explicitly requested, use --onboarding dashboard to leave those choices to the setup page.
  2. helppuff knowledge status --json            follow learning progress
  3. helppuff ask "a real visitor question" --json   → read "reply" and "sources"; if it is wrong, fix
     prompt.md, add knowledge (helppuff knowledge upload price-list.pdf) or facts, and ask again
  4. Give the user three things: deploy.setupUrl (the dashboard — a one-time link, 24h, where they
     create their sign-in; defaults opens Home, dashboard continues web onboarding), deploy.embed
     (the script) and deploy.preview (the demo). Lost it? \`helppuff dashboard\` mints a new link.
  5. Settings: everything in the dashboard can be changed from here (config set, prompt, tools, jobs,
     live, webhooks, or \`helppuff api\` for any route). Asked to go through them with the user? Read
     them first (config get, prompt pull, tools list --json), ask only what changes the result, apply.
  Rules: never invent a URL, key or account id; ask. Never print or commit .env or ADMIN_API_KEY.
  Secrets: prefer asking the user to run \`helppuff secret set NAME\`; pass --api-key only if they gave it to you.

COMMANDS
  Setup
    init                 Create helppuff.json, prompt.md and .env by asking only what it cannot detect
    deploy               Create or update everything on Cloudflare; content changes go live in seconds
    upgrade              Move a deployed assistant to this release: shows the plan, keeps a restore point
    dev                  Run the assistant locally at http://localhost:8787 (uses your .env)
    destroy --yes        Delete everything this project created on Cloudflare (local files stay)

  Knowledge (workers-ai)
    discover             List the site's pages by category, with which are selected
    crawl [--wait]       Crawl the selected pages (or --all, --urls, --file, --include) in the background
    knowledge status     Crawl progress, passages, and today's usage against the free budget
    knowledge add        Add hand-written knowledge: --file faq.md, or --title … --text …
    knowledge upload     Upload PDF, Word, Markdown or text files; read and learned in the background
    knowledge list|remove <id>|files [remove <id>]|pages [--status error]|facts [set key=value …]|suggest [--apply]

  Use and check
    ask "<question>"     The answer, plus the passages it came from and their scores
    eval <golden.json>   Score a set of real questions: right source, key facts, refusals (--min 0.8)
    chat [message]       Talk to the deployed assistant through the real API (--local for dev)
    status               What is deployed, where, the embed snippet, and the knowledge base
    doctor               Check every piece (config, secrets, token, index, knowledge, Worker) with fixes
    embed                Print the <script> snippet for the site

  Change
    config get [path]    Read helppuff.json, e.g. \`config get backend.model\`
    config set <path> <value>   Change helppuff.json, validated; \`helppuff deploy\` publishes it
    config pull          Bring settings changed in the dashboard into helppuff.json
    config export [--live] | import <file> | schema
    secret set <NAME>    Store a secret in .env and on the Worker (prompted, piped, or --value)
    secret list          Which secrets are set, locally and on the Worker (never the values)
    prompt [status]      Is prompt.md the live prompt, ahead of it, or behind a dashboard edit?
    prompt pull          Bring the live prompt (or --version N, to restore it) into prompt.md
    prompt history       Every published prompt version: who, from where, when
    users list|add|role|remove|reset Who can sign in to the dashboard, as admin or member
    live on|off|status   Live chat: visitors talk to a person on your team
    telegram connect|status|test|disconnect  Answer live chats from Telegram
    webhooks             Send chats, messages, leads and callbacks to other tools (signed JSON)
    tools                Your APIs the assistant calls before, during and after a chat ({{name}} in the prompt)
    agent                The whole setup as one file: export it, import it, or start from a template
    identity             The secret your server signs logged-in visitors with (rotate: a new one)
    keys list|create|revoke  API keys for the public API (/api/v1): scoped, one site each, shown once
    api <METHOD> <path>  Call any public API endpoint with this project's admin key (--data '{…}')
    callbacks            Visitors waiting to be called back: list them, mark them done
    jobs                 Requests, quotes and work on the pipeline: list, create, move, set up
    model [set|test]     Who writes the answers: Workers AI (default), any OpenAI-compatible API, Claude, or your own
    rag [set|test]       What answers come from: HelpPuff's knowledge base (default), AI Search, your own, or none
    scaffold model|rag   A typed starter file for your own model or knowledge base
    dashboard            A one-time sign-in link to the dashboard (or the setup link, before setup)
    validate             Check helppuff.json and prompt.md without deploying
    schema               Print the JSON Schema of helppuff.json (every field, with descriptions)

BACKENDS (--backend; default: workers-ai)
  workers-ai   Workers AI + HelpPuff's own knowledge base (Vectorize + D1). Free plan. (default)
  cloudflare   Cloudflare AI Search: Cloudflare manages crawling and retrieval
  openai       OpenAI Responses + File Search                        needs OPENAI_API_KEY
  gemini       Gemini + File Search                                  needs GEMINI_API_KEY
  anthropic    Claude, with knowledge from Cloudflare AI Search      needs ANTHROPIC_API_KEY
  http         Your own API: HelpPuff protocol or OpenAI-compatible, JSON or SSE streaming
  retell       A Retell chat agent                                   needs RETELL_API_KEY

FREE BY DEFAULT
  workers-ai runs on the Workers Free plan: ~300 answers a day within the 10,000 free neurons
  (GLM-4.7 Flash). Past 80% of backend.budget.dailyNeurons (default 9000) answers get shorter; at 100%
  the widget offers contact buttons and a lead form until 00:00 UTC. Leads always work.

FILES
  helppuff.json  what the assistant is — backend, prompt path, knowledge, widget, origins (commit it)
  prompt.md    how it behaves (commit it). Every deploy or dashboard edit publishes a numbered version;
               deploy refuses to overwrite a version prompt.md is not based on (\`helppuff prompt pull\`)
  .env         secrets: HELPPUFF_SECRET, ADMIN_API_KEY, provider keys (never commit; gitignored)
  .helppuff/     generated Worker, schema and deploy state (gitignored)

CLOUDFLARE ACCESS
  Easiest: \`npx wrangler login\` once (opens a browser) — helppuff reuses that login.
  Or an API token (https://dash.cloudflare.com/profile/api-tokens → Custom Token) with: Workers Scripts:Edit,
  Workers KV Storage:Edit, D1:Edit, Vectorize:Edit, Account Settings:Read (+ AI Search:Edit and :Run for the
  cloudflare backend) — as CLOUDFLARE_API_TOKEN (env or .env) or --cf-token. CLOUDFLARE_ACCOUNT_ID or
  --account-id picks the account when the token sees several.

DASHBOARD
  Every deploy includes a dashboard at <worker>/admin: setup, knowledge, settings, conversations with
  transcripts and ratings, leads with a pipeline, usage. Stored in D1 on your account. With workers-ai the
  first account is made from the setup link; otherwise the owner is dashboard.adminEmail.

OUTPUT AND EXIT CODES
  --json        stdout is exactly one JSON object: {"ok":true,…} or {"ok":false,"error":{code,message,hint}}.
                Progress goes to stderr. Without --json, output is for people.
  0 success · 1 error (see error.code / error.hint) · 2 bad usage or missing input · 3 auth or permission
  · 4 Cloudflare quota or limit · 10 needs_input (answer the questions and re-run)

GLOBAL OPTIONS
  --json              machine-readable output        --cwd <dir>        run as if in <dir>
  --config <file>     the helppuff.json to use         --non-interactive  never prompt (also: no TTY, CI=1)
  --help, -h          help                           --version          print the version
`;

type CommandHelp = { usage: string; summary: string; options?: [string, string][]; examples?: string[]; notes?: string };

export const COMMAND_HELP: Record<string, CommandHelp> = {
  init: {
    usage: 'helppuff init [options]',
    summary:
      'Set up a new assistant in this folder. In a terminal it asks only for the website, deploys, and prints the setup link; everything else is a flag, or Settings in the dashboard. With --json (or no terminal) it never prompts and returns anything still needed as {"status":"needs_input"}.',
    options: [
      ['--url <site>', 'Your website, e.g. acme.com — or "none" if there is no site yet'],
      ['--name <text>', 'Business name (read from the site when omitted)'],
      ['--backend <type>', 'workers-ai (default) | cloudflare | openai | gemini | anthropic | http | retell'],
      ['--no-defaults', 'In a terminal: choose another backend instead of the free default'],
      ['--model <id>', 'Model for the backend (a sensible default is picked)'],
      ['--api-key <key>', 'Provider key for openai/gemini/anthropic/retell (or set it in the environment)'],
      ['--ai-search <name>', 'cloudflare/anthropic: "new" (default), an existing instance name, or "endpoint"'],
      ['--ai-search-endpoint <url>', 'A public AI Search endpoint to use instead of an instance'],
      ['--http-url <url>', 'http backend: your API base URL'],
      ['--http-mode <mode>', 'http backend: helppuff | openai'],
      ['--http-token <token>', 'http backend: Bearer token for your API'],
      ['--retell-agent <id>', 'retell backend: the agent id'],
      ['--docs <paths>', 'Files or folders to learn from, comma separated'],
      ['--cf-token <token>', 'Cloudflare API token (or CLOUDFLARE_API_TOKEN)'],
      ['--cf-account, --account-id <id>', 'Cloudflare account id, when the token sees several'],
      ['--admin-email <email>', 'Dashboard owner (other backends; workers-ai makes the account from the setup link)'],
      ['--admin-password <p>', 'Dashboard password (default: generated and shown once)'],
      ['--no-dashboard', 'Skip the leads/conversations dashboard'],
      ['--agent-name <name>', 'What visitors see the assistant called (default: Assistant)'],
      ['--goal <goal>', 'leads | answer | book | sell — what it steers visitors towards (default: leads)'],
      ['--notes <text>', 'Must-know / never-say instructions, woven into prompt.md'],
      ['--lead-form <fields>', 'Pre-chat form fields from name,email,phone,message, or none (default: all four; phone optional)'],
      ['--yes, -y', 'Accept the recommended answer wherever there is one'],
      ['--deploy / --no-deploy', 'Deploy right after setup (default: yes in a terminal, no in --json)'],
      ['--crawl <which>', 'workers-ai, with --deploy: suggested | all | none | globs like "**/services/**,**/faq/**"'],
      ['--crawl-file <file>', 'workers-ai, with --deploy: crawl exactly the URLs in this file'],
      ['--onboarding <mode>', 'defaults: learn suggested pages automatically | dashboard: let the user choose pages and details'],
      ['--no-browser', 'Do not open the setup page; continue in the terminal'],
      ['--force', 'Overwrite an existing helppuff.json'],
    ],
    examples: [
      'helppuff init',
      'helppuff init --url acme.com.au --deploy --onboarding defaults --yes --json',
      'helppuff init --url acme.com.au --deploy --onboarding dashboard --yes --json',
      'helppuff init --url acme.com.au --deploy --crawl "**/services/**,**/faq/**" --yes --json',
      'helppuff init --url acme.com --backend cloudflare --yes --json',
      'helppuff init --url acme.com --backend openai --api-key "$OPENAI_API_KEY" --deploy --json',
      'helppuff init --url acme.com --backend http --http-url https://api.acme.com/chat --http-mode helppuff --json',
    ],
  },
  upgrade: {
    usage: 'npx @knowtific/helppuff@latest upgrade [--check] [--yes] [--allow-downgrade]',
    summary:
      'Bring the deployed assistant to this release. Shows what is live, what will change (helppuff.json format, D1 migrations), notes a restore point (D1 Time Travel: the database can be put back to just before, for 7 days on the Free plan), then deploys. Data, settings, prompt versions and the knowledge base are kept. Run it with @latest so npx fetches the newest CLI.',
    options: [
      ['--check', 'Only report: versions, pending migrations, helppuff.json changes'],
      ['--yes', 'Go ahead without asking (needed with --json or without a terminal)'],
      ['--allow-downgrade', 'Go to this release although the Worker runs a newer one'],
    ],
    examples: ['npx @knowtific/helppuff@latest upgrade', 'npx -y @knowtific/helppuff@latest upgrade --check --json', 'npx -y @knowtific/helppuff@latest upgrade --yes --json'],
    notes:
      'Rolling back: npx @knowtific/helppuff@<previous version> deploy --allow-downgrade. Migrations only add tables and columns, so the previous release runs on the upgraded database. To also put the data back, use the restore command upgrade printed (wrangler d1 time-travel restore).',
  },
  deploy: {
    usage: 'helppuff deploy [options]',
    summary:
      'Create or update the Worker, storage, knowledge, secrets and config on Cloudflare. Idempotent. When only content changed (prompt, widget, model) it skips the Worker upload and is live in seconds.',
    options: [
      ['--knowledge', 'Re-sync the knowledge base as part of the deploy'],
      ['--skip-knowledge', 'Never touch the knowledge base'],
      ['--force', 'Upload the Worker even if nothing about it changed'],
      ['--dry-run', 'Check credentials and secrets and show the URL, change nothing'],
      ['--crawl <which>', 'workers-ai: also start a crawl — suggested | all | globs'],
      ['--crawl-file <file>', 'workers-ai: crawl exactly the URLs in this file'],
      ['--onboarding <mode>', 'first deploy: defaults starts learning automatically; dashboard leaves page selection to the setup page. Remembered for later deploys'],
      ['--overwrite-settings', 'Publish helppuff.json over settings changed in the dashboard (otherwise: config pull first)'],
      ['--allow-downgrade', 'Deploy although the Worker runs a newer release: a deliberate rollback'],
      ['--account-id <id>', 'The Cloudflare account, when the token sees several'],
    ],
    examples: ['helppuff deploy', 'helppuff deploy --json', 'helppuff deploy --onboarding dashboard --json', 'helppuff deploy --crawl suggested --json', 'helppuff deploy --knowledge'],
    notes:
      'workers-ai: the first deploy creates a Vectorize index, a D1 database, a KV namespace and a Workflow, generates ADMIN_API_KEY into .env, and returns setupUrl — a one-time link (24h) to the setup page. Re-running never creates duplicates.',
  },
  dev: {
    usage: 'helppuff dev [--port 8787]',
    summary: 'Run the assistant locally with wrangler, using secrets from .env. Open http://localhost:8787 to try it; `helppuff chat --local` talks to it.',
  },
  chat: {
    usage: 'helppuff chat [message] [--session <token>] [--local] [--json]',
    summary:
      'Send a message through the real API, as a visitor would. Without a message in a terminal it opens an interactive chat. Pass the returned "session" back with --session to continue a conversation.',
    options: [
      ['--session <token>', 'Continue a conversation'],
      ['--local', 'Talk to `helppuff dev` on localhost:8787 instead of the deployed Worker'],
      ['--url <url>', 'Talk to another deployment'],
    ],
    examples: ['helppuff chat "How much does a service cost?" --json', 'helppuff chat "And on weekends?" --session <token> --json', 'helppuff chat'],
  },
  knowledge: {
    usage: 'helppuff knowledge status | sync [--wait] | add (--file f.md | --title t --text …) | upload <file…> [--wait] | files [remove <id>] | list | remove <id> | pages [--status s] | facts [set k=v …] | suggest [--apply]',
    summary:
      'workers-ai: the knowledge base on your Worker. `sync` re-crawls the selected pages (same as `helppuff crawl`); `add` indexes hand-written knowledge at once; `upload` sends PDF, Word (.docx), Markdown or text files (up to 10 MB) that the Worker reads, cleans and learns in the background — `files` shows their progress, and `--wait` follows them to the end. Files listed in `knowledge.files` in helppuff.json are synced on every deploy (new and changed ones uploaded, removed ones deleted); `facts` are the business details (phone, hours…) answers always see — yours are never overwritten by a crawl. Other backends: `sync` uploads the website and knowledge.files to AI Search, an OpenAI vector store or a Gemini File Search store.',
    examples: [
      'helppuff knowledge status --json',
      'helppuff knowledge add --file faq.md',
      'helppuff knowledge upload price-list.pdf brochure.docx --wait --json',
      'helppuff knowledge add --title "Warranty" --text "All installs carry a 5 year warranty."',
      'helppuff knowledge facts set phone="03 9876 5432" hours="Mon-Fri 7am-5pm"',
      'helppuff knowledge pages --status error',
      'helppuff knowledge suggest --apply   (starter questions written from the crawled pages)',
    ],
  },
  discover: {
    usage: 'helppuff discover [--json]',
    summary:
      'workers-ai: find the pages of the site — home page links, robots.txt sitemaps and sitemap indexes — each with a category (service, faq, contact, pricing, legal…) and whether it is selected. Legal pages, archives and old blog posts start unselected.',
  },
  crawl: {
    usage: 'helppuff crawl [--all | --urls a,b | --file urls.txt | --include globs] [--wait] [--json]',
    summary:
      'workers-ai: crawl pages into the knowledge base. It runs in a Cloudflare Workflow on your account, so it carries on if you close the terminal; --wait follows it to the end. With no choice given it crawls the selected pages (the first time: the suggested ones). Pages that are unchanged since the last crawl are not re-embedded.',
    options: [
      ['--all', 'Every discovered page except legal ones'],
      ['--urls <a,b>', 'Exactly these pages (selected from now on)'],
      ['--file <file>', 'Exactly the URLs in this file, one per line'],
      ['--include <globs>', 'Discovered pages matching e.g. "**/services/**,**/faq/**"'],
      ['--wait', 'Block until the crawl finishes, printing progress'],
    ],
    examples: ['helppuff crawl --wait', 'helppuff crawl --include "**/services/**,**/faq/**" --json', 'helppuff crawl --urls https://acme.com.au/pricing'],
  },
  ask: {
    usage: 'helppuff ask "<question>" [--session <token>] [--timing] [--json]',
    summary:
      'Ask the deployed assistant as a visitor would, and show the passages retrieval found for it with their scores. When nothing passes the relevance threshold the assistant should say it is not sure — if it answers anyway, tighten prompt.md.',
    examples: ['helppuff ask "Do you service Lilydale?"', 'helppuff ask "How much is a hot water service?" --timing'],
    notes: '--timing prints where the time went, stage by stage (auth, limits, context, rag.embed / vector / keyword / rerank, llm.first_token, llm.round1…), from the Worker\'s Server-Timing header.',
  },
  eval: {
    usage: 'helppuff eval <golden.json> [--min 0.8] [--json]',
    summary:
      'Ask the deployed assistant a set of real visitor questions, each in a fresh conversation, and score them: retrieval found the expected page (`source`, a URL substring), the reply mentions every `contains`, and `refuse` questions get "not sure" rather than a guess. Exit code 1 when the share passing is below --min.',
    examples: ['helppuff eval golden.json', 'helppuff eval golden.json --min 0.9 --json'],
    notes:
      'golden.json: [{ "question": "What\'s your phone number?", "source": "/contact", "contains": ["9876 5432"] }, { "question": "Can you fix my car?", "refuse": true }]',
  },
  destroy: {
    usage: 'helppuff destroy --yes [--keep-data]',
    summary:
      'Delete everything this project created on Cloudflare: the Worker and its Workflow, KV, the D1 database (conversations, leads, knowledge), the Vectorize index, and an AI Search instance helppuff made. helppuff.json, prompt.md and .env stay, so `helppuff deploy` rebuilds it. Irreversible.',
    options: [['--keep-data', 'Keep the D1 database and the Vectorize index']],
  },
  secret: {
    usage: 'helppuff secret set <NAME> [--value <v>]   |   helppuff secret list',
    summary:
      'Store a secret in .env, even before init, and, if deployed, on the Worker. The value is read from --value, from stdin when piped, or prompted (hidden) in a terminal. Values are never printed. Listing secrets requires an initialized project.',
    examples: ['helppuff secret set OPENAI_API_KEY', 'echo "$KEY" | helppuff secret set OPENAI_API_KEY', 'helppuff secret list --json'],
  },
  config: {
    usage: 'helppuff config get [path] | set <path> <value> | pull | export [--live] | import <file> | schema',
    summary:
      'Read or change helppuff.json by dotted path; values are parsed as JSON when they look like JSON, else as text, and the result is validated before it is saved. `pull` brings settings changed in the dashboard into helppuff.json (deploy refuses to overwrite them otherwise). `export --live` prints the live settings; `import` takes a helppuff.json, or a settings object (published live, then pulled).',
    examples: [
      'helppuff config pull && helppuff deploy',
      'helppuff config set backend.model @cf/qwen/qwen3-30b-a3b-fp8',
      'helppuff config set backend.timezone Australia/Melbourne',
      'helppuff config get backend',
      'helppuff config set backend.model gpt-5',
      'helppuff config set widget.brand.accent "#0EA5E9"',
      "helppuff config set knowledge.files '[\"./docs\"]'",
    ],
  },
  prompt: {
    usage: 'helppuff prompt [status | pull [--version N] | history [--limit N] | show [N]] [--json]',
    summary:
      'The prompt is versioned: every `helppuff deploy` that changes prompt.md, and every edit or restore in the dashboard, publishes a new version (history in the dashboard database). `status` compares prompt.md with the live version: in_sync, ahead (deploy publishes it), behind or diverged (pull first). Deploy refuses behind and diverged, so a dashboard edit is never overwritten unseen.',
    options: [
      ['--version <N>', 'pull: write version N into prompt.md; deploying it then restores it as a new version'],
      ['--limit <N>', 'history: how many versions to list (default 20)'],
    ],
    examples: ['helppuff prompt', 'helppuff prompt pull', 'helppuff prompt pull --version 3 && helppuff deploy', 'helppuff prompt history --json', 'helppuff prompt show 2'],
    notes:
      'When pull finds unpublished edits in prompt.md it keeps them as prompt.mine.md instead of discarding them: merge what you need into prompt.md, delete prompt.mine.md, and deploy.',
  },
  validate: { usage: 'helppuff validate [--json]', summary: 'Validate helppuff.json and prompt.md and compile the Worker config, without touching Cloudflare.' },
  schema: { usage: 'helppuff schema', summary: 'Print the JSON Schema for helppuff.json.' },
  status: { usage: 'helppuff status [--json]', summary: 'Show the site, backend, deployment URL, preview and embed snippet; for workers-ai also the crawl, the passages and today\'s usage against the free budget.' },
  doctor: { usage: 'helppuff doctor [--json]', summary: 'Run every check and print a fix for each failure. Exit code 1 if any check fails.' },
  embed: { usage: 'helppuff embed', summary: 'Print the <script> tag to paste into the site.' },
  users: {
    usage: 'helppuff users list | add <email> [--role admin|member] | role <email> admin|member | remove <email> | reset <email> [--password <p>]',
    summary:
      'Manage who can sign in to the dashboard. The owner is dashboard.adminEmail; others are stored in the D1 database. Admins (the default) can do everything; members see only conversations, jobs, contacts, callbacks and live chat, and their own notifications. A password is generated and shown once when --password is omitted.',
    examples: ['helppuff users add sam@acme.com --role member', 'helppuff users role sam@acme.com admin', 'helppuff users reset owner@acme.com --json', 'helppuff users list'],
  },
  live: {
    usage: 'helppuff live on [--wait <seconds>] [--close-after <minutes>] [--names|--no-names] | off | status',
    summary:
      'Live chat: a visitor who asks for a person is handed to your team, who answer from the dashboard (with a notification and a sound) or Telegram. When nobody is available, or nobody takes the chat in --wait seconds (default 120), the visitor gets the callback form. Conversations close after --close-after minutes without a message (default 60); a visitor who writes again is answered by the assistant. Off by default. Saved live and in helppuff.json (`live`).',
    examples: ['helppuff live on --json', 'helppuff live on --wait 180 --no-names', 'helppuff live status --json', 'helppuff live off'],
    notes: 'Someone has to be able to take chats: a dashboard open and set to Available, or Telegram linked (`helppuff telegram connect`).',
  },
  telegram: {
    usage: 'helppuff telegram connect [--token <bot token>] | status | test | disconnect',
    summary:
      'Answer live chats from Telegram: each chat is a thread in your team\'s group (Topics on, the bot an admin with "Manage topics") or in your own chat with the bot. connect takes the token @BotFather gives you (from --token, piped, or prompted; stored encrypted on the Worker), then send /link <code> in the chat to answer from. In a thread: write to answer, /take, /close, /ai (back to the assistant), /info.',
    examples: ['helppuff telegram connect --token 7123456789:AA… --json', 'echo "$BOT_TOKEN" | helppuff telegram connect', 'helppuff telegram status --json', 'helppuff telegram test'],
    notes: 'Making the bot with @BotFather, and sending /link in the chat, are steps for the person: an agent can run everything else once it has the token.',
  },
  webhooks: {
    usage: 'helppuff webhooks list | add <url> [--events a,b] [--description …] | remove <id> | test <id> | enable <id> | disable <id> | events',
    summary:
      'Endpoints that receive what happens, as signed JSON: conversations, messages, leads, callback requests and their updates, summaries, budget alerts, learning (`helppuff webhooks events` lists every type). The same as Settings → Webhooks in the dashboard; stored on the Worker. Each has a signing secret: X-HelpPuff-Signature is sha256= + hex HMAC-SHA256 of "<X-HelpPuff-Timestamp>.<body>". https only; up to 10 per site.',
    examples: ['helppuff webhooks add https://hooks.zapier.com/hooks/catch/123/abc --events lead.captured,callback.requested --json', 'helppuff webhooks test wh_1a2b3c', 'helppuff webhooks list --json'],
  },
  tools: {
    usage: 'helppuff tools list | show <name> | add <name> (--curl \'…\' | --url <https://…> [--method POST] [--header "Name: value"] [--body …] | --extract --field name="what it is") --description "…" [--param name="what it is"] [--pick a,b] [--before] [--after [--when path=value,…]] [--timeout ms] | set <name> [the same flags, --no-before, --no-after] | test <name> [--arg name=value] [--prechat field=value] [--data tool.key=value] | enable <name> | disable <name> | remove <name>',
    summary:
      'The site\'s own tools, the same as on the dashboard\'s Prompt page (stored on the Worker). An http tool calls your API: `{{args.x}}` in its URL, headers or body is filled in by the assistant, `{{prechat.email}}` from the pre-chat form, `{{data.other_tool.key}}` from another tool. `--before` runs it when a chat starts, `--after` when the conversation ends (with the transcript, summary, contact and all the data; an empty body sends all of it as JSON); `--when labels.leadQuality=hot` runs an after-chat tool only for those conversations (`--when lead.email`: only with an email; `--when none`: always). An extract tool (`--extract`) saves what the visitor says, like an order number, as conversation attributes. Name a tool in the prompt as {{name}} to let the assistant use it, and {{name.key}} to put in what it returned. What tools return is kept on the conversation, shown in the dashboard and sent to webhooks. Credential headers (Authorization, X-Api-Key…) are stored encrypted and never read back; write `${NAME}` in a header to take the value from .env (a missing one answers needs_input). Up to 30 per site; https only.',
    examples: [
      "helppuff tools add order_status --curl 'curl https://api.acme.com/orders/{{args.order_number}} -H \"Authorization: Bearer ${ACME_API_KEY}\"' --description 'Look up an order by its number' --param order_number='Like A-1042' --json",
      "helppuff tools add crm_lookup --url https://crm.acme.com/lookup --method POST --body '{\"email\":\"{{prechat.email}}\"}' --header 'X-Api-Key: ${CRM_KEY}' --before --description 'The customer in our CRM'",
      "helppuff tools add order_number --extract --field order_number='Like A-1042' --description 'Save the order number once the visitor gives it'",
      'helppuff tools test order_status --arg order_number=A-1042 --json',
      'helppuff tools test track_shipment --data order_lookup.carrier=shippo --data order_lookup.tracking_number=SHIPPO_TRANSIT',
    ],
    notes: 'Then reference the tool in prompt.md ({{order_status}}) and `helppuff deploy`, or edit the prompt in the dashboard. Tools apply to HelpPuff\'s assistant (any model); with a whole backend (Retell, your own API) only after-chat tools run.',
  },
  agent: {
    usage: 'helppuff agent templates | export [file.json] | import <file.json|template> [--dry-run]',
    summary:
      'The agent file: the assistant\'s setup in one JSON file, the same as the dashboard\'s Settings → Import & export. It holds the prompt, the tools, and the behaviour and lead form settings (not the branding, the knowledge or the team). `export` writes the live setup; secret headers become `${NAME}` placeholders, listed in `needs`. `import` takes a file or a template\'s id, checks it, then applies it: settings, tools (matched by name: created or replaced) and the prompt as a new version. Each `${NAME}` comes from .env (a missing one answers needs_input), and prompt.md and helppuff.json are brought up to date. `--dry-run` shows what would change. `templates` lists the ready-made ones, each with its tutorial.',
    examples: ['helppuff agent templates', 'helppuff agent import order-tracking --dry-run', 'helppuff agent import order-tracking --json', 'helppuff agent export agent.json', 'helppuff agent import agent.json'],
    notes: 'Keep agent.json in your project to share or restore a setup. Secrets are never in it: set them with `helppuff secret set NAME`, then import.',
  },
  identity: {
    usage: 'helppuff identity [rotate]',
    summary:
      'The site\'s identity secret, the same as the dashboard\'s Settings → Lead form → Signed-in visitors. Your server signs a short JWT (HS256) for whoever is logged in (`sub` = your user id, plus any claims such as email or plan; `exp` at most a week ahead), and the page passes it: `HelpPuff.identify({ name, email, token })`. The Worker checks it when a chat starts: the claims become `{{user.*}}` for tools and the prompt, override the lead\'s email and name, and are kept on the conversation. A bad or expired token is ignored. `rotate` makes a new secret: tokens signed with the old one stop working at once.',
    examples: ['helppuff identity', 'helppuff identity rotate --json'],
    notes: 'From your own server, the API takes the user directly instead: POST /conversations with "user": { "id": … }.',
  },
  keys: {
    usage: 'helppuff keys list | create <name> [--preset chat|crm|read|full | --scopes a,b] [--expires <days>] [--allow-ips a,b] [--rate <n>] [--save NAME] | revoke <id>',
    summary:
      'API keys for the public API at <worker>/api/v1, the same as Settings → API keys in the dashboard. A key works on one site, with the scopes you give it (presets: chat, crm, read, full), an optional expiry, IP allowlist and requests a minute. The full key is shown once (or, with --save NAME, written to .env instead of printed); only a keyed hash is stored. Revoked keys are refused everywhere within 30 seconds. See the wiki\'s API page.',
    examples: ['helppuff keys create "Website backend" --preset chat --expires 365', 'helppuff keys create "CRM sync" --scopes leads:read,leads:write --save HELPPUFF_CRM_KEY --json', 'helppuff keys revoke k7m3p9q2r4s8'],
  },
  api: {
    usage: "helppuff api <GET|POST|PUT|PATCH|DELETE> <path> [--data '{…}' | --data @file.json]",
    summary:
      'Call any endpoint of the public API (/api/v1) with this project\'s admin key, and print the JSON answer. For agents and scripts: everything the dashboard can do, without a command for each. The wiki\'s API reference lists every endpoint.',
    examples: ['helppuff api GET /leads', "helppuff api POST /conversations --data '{\"message\":\"Do you work weekends?\"}' --json", 'helppuff api PATCH /leads/lead_123 --data @status.json'],
  },
  callbacks: {
    usage: 'helppuff callbacks list [--status open|done|dismissed|all] | done <id> [--note …] | dismiss <id> [--note …] | reopen <id>',
    summary:
      'Visitors who asked to be called back, the same as the dashboard\'s Callbacks page: waiting ones oldest first, with how to reach them, why, and the conversation. Mark one done (with a note of what happened) or dismissed; each change sends the callback.updated webhook. A conversation has at most one waiting request; asking again updates it.',
    examples: ['helppuff callbacks --json', 'helppuff callbacks done cb_k2x9 --note "Booked a measure for Tuesday"', 'helppuff callbacks list --status done'],
  },
  jobs: {
    usage:
      "helppuff jobs list [--status open|won|lost|all] [--search …] | show <job> | create [--title …] [--fields '{…}'] [--name …] [--email …] [--phone …] [--details …] [--value N] | move <job> <stage> [--reason …] | update <job> <text> | pipeline | template <id> | setup",
    summary:
      'Requests, quotes and work on the site\'s pipeline, the same as the dashboard\'s Jobs page and Settings → Jobs. They come from the assistant (when a visitor asks for a quote or work done), the widget\'s quote questions, the API, and by hand. A job is named by its number (1042) or id; a stage by its name or id. `pipeline` shows the stages, fields and quote questions; `template` starts again from one (service-quote, projects, support, sales-demo, bookings, custom-orders, basic); `setup` lets the AI read the website and choose. Each change sends the job.* webhooks.',
    examples: ['helppuff jobs --json', 'helppuff jobs create --name "Ada Lovelace" --email ada@example.com --fields \'{"service":"Hot water","address":"Glebe"}\'', 'helppuff jobs move 1042 "Quote sent"', 'helppuff jobs move 1042 Lost --reason "Went with another quote"', 'helppuff jobs setup --json'],
  },
  model: {
    usage: 'helppuff model | model set <workers-ai|openai-compatible|openai|gemini|anthropic|custom> [--model …] [--preset …] [--base-url …] [--key-env NAME] [--module ./llm.ts] [--secrets A,B] [--gateway …] [--gateway-id …] [--account-id …] [--yes] | model test ["question"]',
    summary:
      'Who writes the answers, chosen separately from the knowledge base (`helppuff rag`). Workers AI is the default (no key, on the Free plan). `openai-compatible` is any /chat/completions API with tools; presets fill the address and the key\'s name: deepinfra, openrouter, deepseek, groq, together, mistral, fireworks, vercel-ai-gateway, cloudflare-ai-gateway. `openai`, `gemini` and `anthropic` are those providers; `custom` is your own TypeScript file (`helppuff scaffold model`). HelpPuff\'s assistant (prompt, tools, citations, guardrails) stays the same whoever writes. A missing key answers needs_input: the user stores it with `helppuff secret set NAME`. Changed only here (never in the dashboard), then `helppuff deploy`; `model test` asks the deployed Worker.',
    examples: [
      'helppuff model --json',
      'helppuff model set openai-compatible --preset deepinfra --model deepseek-ai/DeepSeek-V3.1 --json',
      'helppuff model set openai-compatible --preset openrouter --model anthropic/claude-sonnet-5 --json',
      'helppuff model set anthropic --model claude-opus-5 --json',
      'helppuff model set custom --module ./llm.ts --secrets MY_MODEL_KEY --json',
      'helppuff model test "Do you do emergency callouts?" --json',
    ],
  },
  rag: {
    usage: 'helppuff rag | rag set <helppuff|none|ai-search|openai-vector-store|http|custom> [--url …] [--token-env NAME] [--module ./rag.ts] [--secrets A,B] [--vector-store vs_…] [--key-env NAME] [--instance …] [--endpoint …] | rag test ["question"]',
    summary:
      'What answers come from, chosen separately from the model. `helppuff` (the default): your site and files, learned by the Worker. `none`: the prompt and the business details only. `ai-search`: Cloudflare AI Search. `openai-vector-store`: a store you fill in OpenAI. `http`: your own search endpoint (`{ query, question, siteId, limit }` → `{ passages }`). `custom`: your own TypeScript file (`helppuff scaffold rag`); HelpPuff only calls its `search`. Changed only here, then `helppuff deploy`; `rag test` shows the passages the deployed Worker finds.',
    examples: ['helppuff rag --json', 'helppuff rag set http --url https://search.example.com/query --token-env SEARCH_TOKEN --json', 'helppuff rag set custom --module ./rag.ts --secrets MY_SEARCH_KEY --json', 'helppuff rag set none --json', 'helppuff rag test "price of a blocked drain" --json'],
  },
  scaffold: {
    usage: 'helppuff scaffold model|rag [--file ./llm.ts] [--use] [--force]',
    summary:
      'Write a starter TypeScript file for your own model (`defineModel`-shaped: one `chat` function) or knowledge base (one `search` function). It imports only types from `@knowtific/helppuff/sdk`, so it deploys without installing anything (install the package for editor types). `--use` also points helppuff.json at it. Then set its secret, deploy, and test.',
    examples: ['helppuff scaffold model --use --json', 'helppuff scaffold rag --file ./search/rag.ts'],
  },
  dashboard: {
    usage: 'helppuff dashboard [--email <e>] [--no-browser]',
    summary:
      'Mint a one-time sign-in link to the dashboard (15 minutes), or the setup link if nobody has an account yet, and open it. The recovery path for a lost password.',
  },
};

export function commandHelp(name: string): string | null {
  const help = COMMAND_HELP[name];
  if (!help) return null;
  const lines = [`USAGE\n  ${help.usage}\n`, `${help.summary}\n`];
  if (help.options?.length) {
    const width = Math.max(...help.options.map(([flag]) => flag.length));
    lines.push(`OPTIONS\n${help.options.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`).join('\n')}\n`);
  }
  if (help.examples?.length) lines.push(`EXAMPLES\n${help.examples.map((e) => `  ${e}`).join('\n')}\n`);
  if (help.notes) lines.push(help.notes);
  lines.push('Add --json for machine-readable output. See `helppuff --help` for the agent workflow.');
  return lines.join('\n');
}

/** Every command as Markdown: usage, summary, options and examples. */
export function commandReference(): string {
  return Object.entries(COMMAND_HELP)
    .map(([name, help]) => {
      const lines = [`### \`helppuff ${name}\``, '', '```', help.usage, '```', '', help.summary, ''];
      if (help.options?.length) {
        lines.push('| Option | |', '| --- | --- |', ...help.options.map(([flag, text]) => `| \`${flag.replace(/\|/g, '\\|')}\` | ${text.replace(/\|/g, '\\|')} |`), '');
      }
      if (help.examples?.length) lines.push('```bash', ...help.examples, '```', '');
      if (help.notes) lines.push(help.notes, '');
      return lines.join('\n');
    })
    .join('\n');
}

/** The wiki's CLI reference page. Generated by `pnpm sync:docs`; edit help.ts, not the page. */
export function cliReferencePage(): string {
  return `<!-- Generated from packages/cli/src/help.ts by \`pnpm sync:docs\`. Edit that file, not this page. -->

# CLI reference

Run any command with \`npx @knowtific/helppuff <command>\` (or \`helppuff <command>\` once installed).
\`helppuff <command> --help\` prints the same in a terminal.

**Every command** takes \`--json\` (stdout is one JSON object: \`{"ok":true,…}\` or
\`{"ok":false,"error":{code,message,hint}}\`; progress goes to stderr), \`--non-interactive\`,
\`--cwd <dir>\` and \`--yes\`. **Exit codes:** \`0\` ok · \`1\` error · \`2\` bad usage or missing
input · \`3\` auth or permission · \`4\` Cloudflare quota or limit · \`10\` needs_input.

${commandReference()}`;
}
