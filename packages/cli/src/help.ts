/**
 * Help, written for two readers: a person skimming for the next command, and
 * an AI agent that will follow it literally. The agent section is not an
 * afterthought — it is the contract (JSON shape, exit codes, the
 * needs_input loop) an agent needs to drive setup without guessing.
 */

export { VERSION } from './engine/version.js';

export const MAIN_HELP = `murmur — an AI chat assistant for your website, on your own Cloudflare account.

USAGE
  murmur <command> [options]
  murmur <command> --help        details and examples for one command

QUICK START (people)
  npx @knowtific/murmur                asks for your website, deploys, and prints one link: the setup page

QUICK START (AI agents: Claude Code, Codex, Cursor…)
  1. murmur init --url <site> --deploy --yes --json
       → {"ok":false,"status":"needs_input","questions":[…]}   ask the user exactly these,
         then re-run with each question's "flag". Repeat until {"ok":true,"status":"created"}.
     With no person at a browser, init does the onboarding itself: it starts learning the
     suggested pages (--crawl "<globs>" or knowledge.website.include/exclude in murmur.json
     to choose) and reads the business details. It all runs on Cloudflare; nothing to wait for.
  2. murmur knowledge status --json            progress (or: murmur crawl --wait --json to block)
  3. murmur ask "a real visitor question" --json   → read "reply" and "sources"; if it is wrong, fix
     prompt.md, add knowledge (murmur knowledge upload price-list.pdf) or facts, and ask again
  4. Give the user three things: deploy.setupUrl (the dashboard — a one-time link, 24h, where they
     create their sign-in; it opens on Home, no onboarding), deploy.embed (the script) and
     deploy.preview (the demo). Lost the link? \`murmur dashboard\` mints a sign-in link.
  Rules: never invent a URL, key or account id; ask. Never print or commit .env or ADMIN_API_KEY.
  Secrets: prefer asking the user to run \`murmur secret set NAME\`; pass --api-key only if they gave it to you.

COMMANDS
  Setup
    init                 Create murmur.json, prompt.md and .env by asking only what it cannot detect
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
    config get [path]    Read murmur.json, e.g. \`config get backend.model\`
    config set <path> <value>   Change murmur.json, validated; \`murmur deploy\` publishes it
    config pull          Bring settings changed in the dashboard into murmur.json
    config export [--live] | import <file> | schema
    secret set <NAME>    Store a secret in .env and on the Worker (prompted, piped, or --value)
    secret list          Which secrets are set, locally and on the Worker (never the values)
    prompt [status]      Is prompt.md the live prompt, ahead of it, or behind a dashboard edit?
    prompt pull          Bring the live prompt (or --version N, to restore it) into prompt.md
    prompt history       Every published prompt version: who, from where, when
    users list|add|remove|reset Who can sign in to the dashboard
    webhooks             Send chats, messages, leads and callbacks to other tools (signed JSON)
    dashboard            A one-time sign-in link to the dashboard (or the setup link, before setup)
    validate             Check murmur.json and prompt.md without deploying
    schema               Print the JSON Schema of murmur.json (every field, with descriptions)

  Agents
    skill install        Teach Claude Code (and with --codex, Codex) about murmur on this machine
    mcp                  Run as an MCP server over stdio (tools: setup, deploy, ask, crawl, status, …)

BACKENDS (--backend; default: workers-ai)
  workers-ai   Workers AI + Murmur's own knowledge base (Vectorize + D1). Free plan. (default)
  cloudflare   Cloudflare AI Search: Cloudflare manages crawling and retrieval
  openai       OpenAI Responses + File Search                        needs OPENAI_API_KEY
  gemini       Gemini + File Search                                  needs GEMINI_API_KEY
  anthropic    Claude, with knowledge from Cloudflare AI Search      needs ANTHROPIC_API_KEY
  http         Your own API: Murmur protocol or OpenAI-compatible, JSON or SSE streaming
  retell       A Retell chat agent                                   needs RETELL_API_KEY

FREE BY DEFAULT
  workers-ai runs on the Workers Free plan: ~300 answers a day within the 10,000 free neurons
  (GLM-4.7 Flash). Past 80% of backend.budget.dailyNeurons (default 9000) answers get shorter; at 100%
  the widget offers contact buttons and a lead form until 00:00 UTC. Leads always work.

FILES
  murmur.json  what the assistant is — backend, prompt path, knowledge, widget, origins (commit it)
  prompt.md    how it behaves (commit it). Every deploy or dashboard edit publishes a numbered version;
               deploy refuses to overwrite a version prompt.md is not based on (\`murmur prompt pull\`)
  .env         secrets: MURMUR_SECRET, ADMIN_API_KEY, provider keys (never commit; gitignored)
  .murmur/     generated Worker, schema and deploy state (gitignored)

CLOUDFLARE ACCESS
  Easiest: \`npx wrangler login\` once (opens a browser) — murmur reuses that login.
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
  --config <file>     the murmur.json to use         --non-interactive  never prompt (also: no TTY, CI=1)
  --help, -h          help                           --version          print the version
`;

type CommandHelp = { usage: string; summary: string; options?: [string, string][]; examples?: string[]; notes?: string };

export const COMMAND_HELP: Record<string, CommandHelp> = {
  init: {
    usage: 'murmur init [options]',
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
      ['--http-mode <mode>', 'http backend: murmur | openai'],
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
      ['--no-browser', 'Do not open the setup page; continue in the terminal'],
      ['--force', 'Overwrite an existing murmur.json'],
      ['--no-agent-files', 'Do not write AGENTS.md and the Claude Code skill'],
    ],
    examples: [
      'murmur init',
      'murmur init --url acme.com.au --deploy --crawl suggested --yes --json',
      'murmur init --url acme.com.au --deploy --crawl "**/services/**,**/faq/**" --yes --json',
      'murmur init --url acme.com --backend cloudflare --yes --json',
      'murmur init --url acme.com --backend openai --api-key "$OPENAI_API_KEY" --deploy --json',
      'murmur init --url acme.com --backend http --http-url https://api.acme.com/chat --http-mode murmur --json',
    ],
  },
  upgrade: {
    usage: 'npx @knowtific/murmur@latest upgrade [--check] [--yes] [--allow-downgrade]',
    summary:
      'Bring the deployed assistant to this release. Shows what is live, what will change (murmur.json format, D1 migrations), notes a restore point (D1 Time Travel: the database can be put back to just before, for 7 days on the Free plan), then deploys. Data, settings, prompt versions and the knowledge base are kept. Run it with @latest so npx fetches the newest CLI.',
    options: [
      ['--check', 'Only report: versions, pending migrations, murmur.json changes'],
      ['--yes', 'Go ahead without asking (needed with --json or without a terminal)'],
      ['--allow-downgrade', 'Go to this release although the Worker runs a newer one'],
    ],
    examples: ['npx @knowtific/murmur@latest upgrade', 'npx -y @knowtific/murmur@latest upgrade --check --json', 'npx -y @knowtific/murmur@latest upgrade --yes --json'],
    notes:
      'Rolling back: npx @knowtific/murmur@<previous version> deploy --allow-downgrade. Migrations only add tables and columns, so the previous release runs on the upgraded database. To also put the data back, use the restore command upgrade printed (wrangler d1 time-travel restore).',
  },
  deploy: {
    usage: 'murmur deploy [options]',
    summary:
      'Create or update the Worker, storage, knowledge, secrets and config on Cloudflare. Idempotent. When only content changed (prompt, widget, model) it skips the Worker upload and is live in seconds.',
    options: [
      ['--knowledge', 'Re-sync the knowledge base as part of the deploy'],
      ['--skip-knowledge', 'Never touch the knowledge base'],
      ['--force', 'Upload the Worker even if nothing about it changed'],
      ['--dry-run', 'Check credentials and secrets and show the URL, change nothing'],
      ['--crawl <which>', 'workers-ai: also start a crawl — suggested | all | globs'],
      ['--crawl-file <file>', 'workers-ai: crawl exactly the URLs in this file'],
      ['--overwrite-settings', 'Publish murmur.json over settings changed in the dashboard (otherwise: config pull first)'],
      ['--allow-downgrade', 'Deploy although the Worker runs a newer release: a deliberate rollback'],
      ['--account-id <id>', 'The Cloudflare account, when the token sees several'],
    ],
    examples: ['murmur deploy', 'murmur deploy --json', 'murmur deploy --crawl suggested --json', 'murmur deploy --knowledge'],
    notes:
      'workers-ai: the first deploy creates a Vectorize index, a D1 database, a KV namespace and a Workflow, generates ADMIN_API_KEY into .env, and returns setupUrl — a one-time link (24h) to the setup page. Re-running never creates duplicates.',
  },
  dev: {
    usage: 'murmur dev [--port 8787]',
    summary: 'Run the assistant locally with wrangler, using secrets from .env. Open http://localhost:8787 to try it; `murmur chat --local` talks to it.',
  },
  chat: {
    usage: 'murmur chat [message] [--session <token>] [--local] [--json]',
    summary:
      'Send a message through the real API, as a visitor would. Without a message in a terminal it opens an interactive chat. Pass the returned "session" back with --session to continue a conversation.',
    options: [
      ['--session <token>', 'Continue a conversation'],
      ['--local', 'Talk to `murmur dev` on localhost:8787 instead of the deployed Worker'],
      ['--url <url>', 'Talk to another deployment'],
    ],
    examples: ['murmur chat "How much does a service cost?" --json', 'murmur chat "And on weekends?" --session <token> --json', 'murmur chat'],
  },
  knowledge: {
    usage: 'murmur knowledge status | sync [--wait] | add (--file f.md | --title t --text …) | upload <file…> [--wait] | files [remove <id>] | list | remove <id> | pages [--status s] | facts [set k=v …] | suggest [--apply]',
    summary:
      'workers-ai: the knowledge base on your Worker. `sync` re-crawls the selected pages (same as `murmur crawl`); `add` indexes hand-written knowledge at once; `upload` sends PDF, Word (.docx), Markdown or text files (up to 10 MB) that the Worker reads, cleans and learns in the background — `files` shows their progress, and `--wait` follows them to the end. Files listed in `knowledge.files` in murmur.json are synced on every deploy (new and changed ones uploaded, removed ones deleted); `facts` are the business details (phone, hours…) answers always see — yours are never overwritten by a crawl. Other backends: `sync` uploads the website and knowledge.files to AI Search, an OpenAI vector store or a Gemini File Search store.',
    examples: [
      'murmur knowledge status --json',
      'murmur knowledge add --file faq.md',
      'murmur knowledge upload price-list.pdf brochure.docx --wait --json',
      'murmur knowledge add --title "Warranty" --text "All installs carry a 5 year warranty."',
      'murmur knowledge facts set phone="03 9876 5432" hours="Mon-Fri 7am-5pm"',
      'murmur knowledge pages --status error',
      'murmur knowledge suggest --apply   (starter questions written from the crawled pages)',
    ],
  },
  discover: {
    usage: 'murmur discover [--json]',
    summary:
      'workers-ai: find the pages of the site — home page links, robots.txt sitemaps and sitemap indexes — each with a category (service, faq, contact, pricing, legal…) and whether it is selected. Legal pages, archives and old blog posts start unselected.',
  },
  crawl: {
    usage: 'murmur crawl [--all | --urls a,b | --file urls.txt | --include globs] [--wait] [--json]',
    summary:
      'workers-ai: crawl pages into the knowledge base. It runs in a Cloudflare Workflow on your account, so it carries on if you close the terminal; --wait follows it to the end. With no choice given it crawls the selected pages (the first time: the suggested ones). Pages that are unchanged since the last crawl are not re-embedded.',
    options: [
      ['--all', 'Every discovered page except legal ones'],
      ['--urls <a,b>', 'Exactly these pages (selected from now on)'],
      ['--file <file>', 'Exactly the URLs in this file, one per line'],
      ['--include <globs>', 'Discovered pages matching e.g. "**/services/**,**/faq/**"'],
      ['--wait', 'Block until the crawl finishes, printing progress'],
    ],
    examples: ['murmur crawl --wait', 'murmur crawl --include "**/services/**,**/faq/**" --json', 'murmur crawl --urls https://acme.com.au/pricing'],
  },
  ask: {
    usage: 'murmur ask "<question>" [--session <token>] [--timing] [--json]',
    summary:
      'Ask the deployed assistant as a visitor would, and show the passages retrieval found for it with their scores. When nothing passes the relevance threshold the assistant should say it is not sure — if it answers anyway, tighten prompt.md.',
    examples: ['murmur ask "Do you service Lilydale?"', 'murmur ask "How much is a hot water service?" --timing'],
    notes: '--timing prints where the time went, stage by stage (auth, limits, context, rag.embed / vector / keyword / rerank, llm.first_token, llm.round1…), from the Worker\'s Server-Timing header.',
  },
  eval: {
    usage: 'murmur eval <golden.json> [--min 0.8] [--json]',
    summary:
      'Ask the deployed assistant a set of real visitor questions, each in a fresh conversation, and score them: retrieval found the expected page (`source`, a URL substring), the reply mentions every `contains`, and `refuse` questions get "not sure" rather than a guess. Exit code 1 when the share passing is below --min.',
    examples: ['murmur eval golden.json', 'murmur eval golden.json --min 0.9 --json'],
    notes:
      'golden.json: [{ "question": "What\'s your phone number?", "source": "/contact", "contains": ["9876 5432"] }, { "question": "Can you fix my car?", "refuse": true }]',
  },
  destroy: {
    usage: 'murmur destroy --yes [--keep-data]',
    summary:
      'Delete everything this project created on Cloudflare: the Worker and its Workflow, KV, the D1 database (conversations, leads, knowledge), the Vectorize index, and an AI Search instance murmur made. murmur.json, prompt.md and .env stay, so `murmur deploy` rebuilds it. Irreversible.',
    options: [['--keep-data', 'Keep the D1 database and the Vectorize index']],
  },
  secret: {
    usage: 'murmur secret set <NAME> [--value <v>]   |   murmur secret list',
    summary:
      'Store a secret in .env and, if deployed, on the Worker. The value is read from --value, from stdin when piped, or prompted (hidden) in a terminal. Values are never printed.',
    examples: ['murmur secret set OPENAI_API_KEY', 'echo "$KEY" | murmur secret set OPENAI_API_KEY', 'murmur secret list --json'],
  },
  config: {
    usage: 'murmur config get [path] | set <path> <value> | pull | export [--live] | import <file> | schema',
    summary:
      'Read or change murmur.json by dotted path; values are parsed as JSON when they look like JSON, else as text, and the result is validated before it is saved. `pull` brings settings changed in the dashboard into murmur.json (deploy refuses to overwrite them otherwise). `export --live` prints the live settings; `import` takes a murmur.json, or a settings object (published live, then pulled).',
    examples: [
      'murmur config pull && murmur deploy',
      'murmur config set backend.model @cf/openai/gpt-oss-120b',
      'murmur config set backend.timezone Australia/Melbourne',
      'murmur config get backend',
      'murmur config set backend.model gpt-5',
      'murmur config set widget.brand.accent "#0EA5E9"',
      "murmur config set knowledge.files '[\"./docs\"]'",
    ],
  },
  prompt: {
    usage: 'murmur prompt [status | pull [--version N] | history [--limit N] | show [N]] [--json]',
    summary:
      'The prompt is versioned: every `murmur deploy` that changes prompt.md, and every edit or restore in the dashboard, publishes a new version (history in the dashboard database). `status` compares prompt.md with the live version: in_sync, ahead (deploy publishes it), behind or diverged (pull first). Deploy refuses behind and diverged, so a dashboard edit is never overwritten unseen.',
    options: [
      ['--version <N>', 'pull: write version N into prompt.md; deploying it then restores it as a new version'],
      ['--limit <N>', 'history: how many versions to list (default 20)'],
    ],
    examples: ['murmur prompt', 'murmur prompt pull', 'murmur prompt pull --version 3 && murmur deploy', 'murmur prompt history --json', 'murmur prompt show 2'],
    notes:
      'When pull finds unpublished edits in prompt.md it keeps them as prompt.mine.md instead of discarding them: merge what you need into prompt.md, delete prompt.mine.md, and deploy.',
  },
  validate: { usage: 'murmur validate [--json]', summary: 'Validate murmur.json and prompt.md and compile the Worker config, without touching Cloudflare.' },
  schema: { usage: 'murmur schema', summary: 'Print the JSON Schema for murmur.json.' },
  status: { usage: 'murmur status [--json]', summary: 'Show the site, backend, deployment URL, preview and embed snippet; for workers-ai also the crawl, the passages and today\'s usage against the free budget.' },
  doctor: { usage: 'murmur doctor [--json]', summary: 'Run every check and print a fix for each failure. Exit code 1 if any check fails.' },
  embed: { usage: 'murmur embed', summary: 'Print the <script> tag to paste into the site.' },
  users: {
    usage: 'murmur users list | add <email> | remove <email> | reset <email> [--password <p>]',
    summary:
      'Manage who can sign in to the dashboard. The owner is dashboard.adminEmail; others are stored in the D1 database. A password is generated and shown once when --password is omitted.',
    examples: ['murmur users add sam@acme.com', 'murmur users reset owner@acme.com --json', 'murmur users list'],
  },
  webhooks: {
    usage: 'murmur webhooks list | add <url> [--events a,b] [--description …] | remove <id> | test <id> | enable <id> | disable <id> | events',
    summary:
      'Endpoints that receive what happens, as signed JSON: conversation.started, message.received, message.sent, lead.captured, callback.requested, lead.updated, feedback.received, conversation.summarized, conversation.ended, knowledge.crawl.finished, knowledge.file.processed (`events` lists them). The same as Settings → Webhooks in the dashboard; stored on the Worker. Each has a signing secret: X-Murmur-Signature is sha256= + hex HMAC-SHA256 of "<X-Murmur-Timestamp>.<body>". https only; up to 10 per site.',
    examples: ['murmur webhooks add https://hooks.zapier.com/hooks/catch/123/abc --events lead.captured,callback.requested --json', 'murmur webhooks test wh_1a2b3c', 'murmur webhooks list --json'],
  },
  dashboard: {
    usage: 'murmur dashboard [--email <e>] [--no-browser]',
    summary:
      'Mint a one-time sign-in link to the dashboard (15 minutes), or the setup link if nobody has an account yet, and open it. The recovery path for a lost password.',
  },
  skill: {
    usage: 'murmur skill install [--project] [--codex]  |  murmur skill print',
    summary:
      'Install the "website-chatbot" agent skill so a fresh Claude Code session knows how to set up, test and deploy an assistant: into ~/.claude/skills (default) or this repository (--project); --codex also adds it to ~/.codex/AGENTS.md. Or install the Claude Code plugin, which bundles the skill and the MCP server.',
    examples: ['npx -y @knowtific/murmur skill install', 'npx -y @knowtific/murmur skill install --codex'],
  },
  mcp: {
    usage: 'murmur mcp',
    summary:
      'Serve the murmur tools over MCP (stdio). Add to Claude Code with: claude mcp add murmur -- npx -y @knowtific/murmur mcp',
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
  lines.push('Add --json for machine-readable output. See `murmur --help` for the agent workflow.');
  return lines.join('\n');
}

/**
 * AGENTS.md for the published package: the same help, as one Markdown
 * document an agent can read without running anything. Generated, so it
 * cannot drift from `--help`; `pnpm sync:plugin` writes it and a test checks it.
 */
/** Every command as Markdown: usage, summary, options, examples. Shared by the agent guide and the wiki. */
export function commandReference(): string {
  return Object.entries(COMMAND_HELP)
    .map(([name, help]) => {
      const lines = [`### \`murmur ${name}\``, '', '```', help.usage, '```', '', help.summary, ''];
      if (help.options?.length) {
        lines.push('| Option | |', '| --- | --- |', ...help.options.map(([flag, text]) => `| \`${flag.replace(/\|/g, '\\|')}\` | ${text.replace(/\|/g, '\\|')} |`), '');
      }
      if (help.examples?.length) lines.push('```bash', ...help.examples, '```', '');
      if (help.notes) lines.push(help.notes, '');
      return lines.join('\n');
    })
    .join('\n');
}

/** The wiki's CLI reference page. Generated by `pnpm sync:plugin`; edit help.ts, not the page. */
export function cliReferencePage(): string {
  return `<!-- Generated from packages/cli/src/help.ts by \`pnpm sync:plugin\`. Edit that file, not this page. -->

# CLI reference

Run any command with \`npx @knowtific/murmur <command>\` (or \`murmur <command>\` once installed).
\`murmur <command> --help\` prints the same in a terminal.

**Every command** takes \`--json\` (stdout is one JSON object: \`{"ok":true,…}\` or
\`{"ok":false,"error":{code,message,hint}}\`; progress goes to stderr), \`--non-interactive\`,
\`--cwd <dir>\` and \`--yes\`. **Exit codes:** \`0\` ok · \`1\` error · \`2\` bad usage or missing
input · \`3\` auth or permission · \`4\` Cloudflare quota or limit · \`10\` needs_input.

${commandReference()}`;
}

export function agentsGuide(): string {
  const commands = commandReference();
  return `# @knowtific/murmur — guide for AI agents

Murmur puts an AI chat assistant on a website, entirely on the site owner's own
Cloudflare account: one Worker serves the widget, the chat API, a dashboard and a
knowledge base it builds by crawling the site (Workers AI + Vectorize + D1, crawled in
a Workflow). The default setup runs on the Workers Free plan. Everything a person
can do in the dashboard can be done here, non-interactively, with \`--json\`.

## Quick start (non-interactive)

\`\`\`bash
npx -y @knowtific/murmur init --url https://acme.com.au --deploy --yes --json
npx -y @knowtific/murmur knowledge status --json          # learning runs in the background
npx -y @knowtific/murmur ask "Do you service Lilydale?" --json
\`\`\`

Without a person at a browser (\`--json\`, no terminal, or \`--no-browser\`), \`init\` and
\`deploy\` do onboarding themselves the first time: they start learning the suggested pages
(shape them with \`--crawl "<globs>"\` or \`knowledge.website.include\`/\`exclude\` in
murmur.json) and read the business details from the site. Then give the user three things
from the result: \`deploy.setupUrl\` (the dashboard: a one-time link, 24 hours, where they
create their sign-in — it opens on Home, with nothing left to onboard), \`deploy.embed\`
(the script) and \`deploy.preview\` (the demo). \`murmur dashboard --json\` mints a fresh
sign-in link at any time.

## Output, exit codes and environment

- With \`--json\`, stdout is exactly one JSON object: \`{"ok":true,…}\` or
  \`{"ok":false,"error":{"code","message","hint"}}\`. Progress goes to stderr.
- Exit codes: \`0\` ok · \`1\` error · \`2\` bad usage or missing input · \`3\` auth or
  permission · \`4\` Cloudflare quota or limit · \`10\` needs_input (\`init\` returns the
  questions; ask the user, re-run with each question's \`flag\`).
- Never prompts when \`--json\`, \`--non-interactive\`, \`CI=1\` or there is no terminal.
- Global flags: \`--json\`, \`--non-interactive\`, \`--cwd <dir>\`, \`--config <murmur.json>\`,
  \`--yes\`, \`--account-id\` (where Cloudflare is used).
- Environment: \`CLOUDFLARE_API_TOKEN\`, \`CLOUDFLARE_ACCOUNT_ID\`, \`MURMUR_ADMIN_API_KEY\`
  (or \`ADMIN_API_KEY\` in \`.env\`), \`OPENAI_API_KEY\`, \`GEMINI_API_KEY\`,
  \`ANTHROPIC_API_KEY\`, \`RETELL_API_KEY\`. Values in the environment win over \`.env\`.

## Cloudflare token permissions

\`npx wrangler login\` needs none of this. An API token needs: ${TOKEN_PERMISSION_LIST}.

## Configuration

\`murmur.json\` (commit it) says what the assistant is; \`prompt.md\` how it behaves;
\`.env\` holds secrets (never commit, never print). \`murmur schema\` prints the JSON
Schema of every field. Settings changed in the dashboard are pulled with
\`murmur config pull\`; deploy refuses to overwrite them otherwise.

## Commands

${commands}
## Recipes

- **Install with defaults:** \`murmur init --url <site> --deploy --yes --json\`
- **Add documents:** \`murmur knowledge upload price-list.pdf brochure.docx --wait --json\`
- **Crawl only services and FAQ:** \`murmur crawl --include "**/services/**,**/faq/**" --wait --json\`
- **Switch to gpt-oss-120b:** \`murmur config set backend.model @cf/openai/gpt-oss-120b && murmur deploy --json\`
- **Add a manual FAQ:** \`murmur knowledge add --file faq.md --json\`
- **Correct a fact:** \`murmur knowledge facts set phone="03 9876 5432" --json\`
- **Get the embed snippet:** \`murmur embed\`
- **Check usage against the free budget:** \`murmur knowledge status --json\` → \`usage\`
- **Lost dashboard password:** \`murmur dashboard --json\` → a one-time sign-in link
- **Remove everything:** \`murmur destroy --yes --json\`

## Rules

- Never print, log or commit \`.env\`, \`ADMIN_API_KEY\` or any provider key.
- Never guess a website, token, key, email or account id — ask the user.
- Stay on the Workers Free plan unless the user asks otherwise.
`;
}

const TOKEN_PERMISSION_LIST = [
  'Account › Workers Scripts › Edit',
  'Workers KV Storage › Edit',
  'D1 › Edit',
  'Vectorize › Edit',
  'Account Settings › Read',
  'and, for the AI Search backend only, AI Search › Edit and Run',
].join(', ');
