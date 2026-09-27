/**
 * Help, written for two readers: a person skimming for the next command, and
 * an AI agent that will follow it literally. The agent section is not an
 * afterthought — it is the contract (JSON shape, exit codes, the
 * needs_input loop) an agent needs to drive setup without guessing.
 */

export const VERSION = '0.1.0';

export const MAIN_HELP = `murmur — an AI chat assistant for your website, on your own Cloudflare account.

USAGE
  murmur <command> [options]
  murmur <command> --help        details and examples for one command

QUICK START (people)
  npx @knowtific/murmur init           answer 2–3 questions; it deploys and prints the embed snippet

QUICK START (AI agents: Claude Code, Codex, Cursor…)
  1. murmur init --json [--url <site>] [--backend <type>] …
       → {"ok":false,"status":"needs_input","questions":[…]}   ask the user exactly these,
         then re-run with each question's "flag". Repeat until {"ok":true,"status":"created"}.
  2. murmur deploy --json                      → { url, preview, embed, … }
  3. murmur chat "a real visitor question" --json   → read "reply"; fix prompt.md if it is wrong
     (prompt_behind / prompt_diverged from deploy: the prompt was changed in the dashboard —
      run \`murmur prompt pull\`, merge any prompt.mine.md into prompt.md, deploy again)
  4. Give the user "preview", "embed" and "dashboard" (plus dashboardLogin.password from init, if generated).
  Rules: never invent a URL, key or account id; ask. Secrets: prefer asking the user to run
  \`murmur secret set NAME\` in their terminal; pass --api-key only if they gave it to you.

COMMANDS
  Setup
    init                 Create murmur.json, prompt.md and .env by asking only what it cannot detect
    deploy               Create or update everything on Cloudflare; content changes go live in seconds
    dev                  Run the assistant locally at http://localhost:8787 (uses your .env)

  Use and check
    chat [message]       Talk to the deployed assistant through the real API (--local for dev)
    status               What is deployed, where, and the embed snippet
    doctor               Check every piece (config, secrets, token, keys, knowledge, Worker) with fixes

  Change
    knowledge sync       Re-read the website and files and upload them to the backend
    knowledge status     How far indexing has got (deploys never wait for it)
    secret set <NAME>    Store a secret in .env and on the Worker (prompted, piped, or --value)
    secret list          Which secrets are set, locally and on the Worker (never the values)
    prompt [status]      Is prompt.md the live prompt, ahead of it, or behind a dashboard edit?
    prompt pull          Bring the live prompt (or --version N, to restore it) into prompt.md
    prompt history       Every published prompt version: who, from where, when
    config get [path]    Read murmur.json, e.g. \`config get backend.model\`
    config set <path> <value>   Change murmur.json, validated, e.g. \`config set widget.brand.accent "#0EA5E9"\`
    users list|add|remove|reset Who can sign in to the leads dashboard
    dashboard            Print the dashboard URL (conversations, leads, analytics, AI summaries)
    validate             Check murmur.json and prompt.md without deploying
    schema               Print the JSON Schema of murmur.json (every field, with descriptions)
    embed                Print the <script> snippet for the site

  Agents
    skill install        Teach Claude Code (and with --codex, Codex) about murmur on this machine
    mcp                  Run as an MCP server over stdio (tools: setup, deploy, chat, status, …)

BACKENDS (--backend)
  cloudflare   Cloudflare AI Search + Workers AI. Free tier; needs only a Cloudflare token. (default)
  openai       OpenAI Responses + File Search                        needs OPENAI_API_KEY
  gemini       Gemini + File Search                                  needs GEMINI_API_KEY
  anthropic    Claude, with knowledge from Cloudflare AI Search      needs ANTHROPIC_API_KEY
  http         Your own API: Murmur protocol or OpenAI-compatible, JSON or SSE streaming
  retell       A Retell chat agent                                   needs RETELL_API_KEY

FILES
  murmur.json  what the assistant is — backend, prompt path, knowledge, widget, origins (commit it)
  prompt.md    how it behaves (commit it). Every deploy or dashboard edit publishes a numbered version;
               deploy refuses to overwrite a version prompt.md is not based on (\`murmur prompt pull\`)
  .env         secrets: provider keys, MURMUR_SECRET, ADMIN_PASSWORD_HASH (never commit; gitignored)
  .murmur/     generated Worker, schema and deploy state (gitignored)

CLOUDFLARE ACCESS
  Easiest: \`npx wrangler login\` once (opens a browser) — murmur reuses that login.
  Or an API token (https://dash.cloudflare.com/profile/api-tokens → Custom Token) with: Workers Scripts:Edit,
  Workers KV Storage:Edit, D1:Edit, AI Search:Edit, AI Search:Run, Account Settings:Read —
  as CLOUDFLARE_API_TOKEN (env or .env) or --cf-token.

DASHBOARD
  Every deploy includes a CRM at <worker>/admin: conversations with transcripts, leads with a pipeline,
  analytics and AI summaries, stored in a D1 database on your account. Owner = dashboard.adminEmail.
  Turn off with \`init --no-dashboard\` or \`config set dashboard.enabled false\`.

OUTPUT AND EXIT CODES
  --json        stdout is exactly one JSON object: {"ok":true,…} or {"ok":false,"error":{code,message,hint}}.
                Progress goes to stderr. Without --json, output is for people.
  0 success · 1 error (see error.code / error.hint) · 2 bad usage · 10 needs_input (answer and re-run)

GLOBAL OPTIONS
  --json        machine-readable output          --cwd <dir>   run as if in <dir>
  --help, -h    help                             --version     print the version
`;

type CommandHelp = { usage: string; summary: string; options?: [string, string][]; examples?: string[]; notes?: string };

export const COMMAND_HELP: Record<string, CommandHelp> = {
  init: {
    usage: 'murmur init [options]',
    summary:
      'Set up a new assistant in this folder. Interactive in a terminal; with --json (or no terminal) it never prompts and returns the questions it still needs as {"status":"needs_input"}.',
    options: [
      ['--url <site>', 'Your website, e.g. acme.com — or "none" if there is no site yet'],
      ['--name <text>', 'Business name (read from the site when omitted)'],
      ['--backend <type>', 'cloudflare | openai | gemini | anthropic | http | retell (default: cloudflare)'],
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
      ['--cf-account <id>', 'Cloudflare account id, when the token sees several'],
      ['--admin-email <email>', 'Dashboard owner (default: your git user.email)'],
      ['--admin-password <p>', 'Dashboard password (default: generated and shown once)'],
      ['--no-dashboard', 'Skip the leads/conversations dashboard'],
      ['--agent-name <name>', 'What visitors see the assistant called (default: Assistant)'],
      ['--goal <goal>', 'leads | answer | book | sell — what it steers visitors towards (default: leads)'],
      ['--notes <text>', 'Must-know / never-say instructions, woven into prompt.md'],
      ['--lead-form <fields>', 'Pre-chat form: none (default) or fields from name,email,phone'],
      ['--yes, -y', 'Accept the recommended answer wherever there is one'],
      ['--deploy / --no-deploy', 'Deploy right after setup (default: ask in a terminal, no in --json)'],
      ['--force', 'Overwrite an existing murmur.json'],
      ['--no-agent-files', 'Do not write AGENTS.md and the Claude Code skill'],
    ],
    examples: [
      'murmur init',
      'murmur init --url acme.com --backend cloudflare --yes --json',
      'murmur init --url acme.com --backend openai --api-key "$OPENAI_API_KEY" --deploy --json',
      'murmur init --url acme.com --backend http --http-url https://api.acme.com/chat --http-mode murmur --json',
    ],
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
    ],
    examples: ['murmur deploy', 'murmur deploy --json', 'murmur deploy --knowledge'],
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
    usage: 'murmur knowledge sync | status [--json]',
    summary:
      'Crawl the website (knowledge.website) and read knowledge.files, then upload them: to AI Search for cloudflare/anthropic, a vector store for openai, a File Search store for gemini. Pages that disappeared are removed.',
  },
  secret: {
    usage: 'murmur secret set <NAME> [--value <v>]   |   murmur secret list',
    summary:
      'Store a secret in .env and, if deployed, on the Worker. The value is read from --value, from stdin when piped, or prompted (hidden) in a terminal. Values are never printed.',
    examples: ['murmur secret set OPENAI_API_KEY', 'echo "$KEY" | murmur secret set OPENAI_API_KEY', 'murmur secret list --json'],
  },
  config: {
    usage: 'murmur config get [path]   |   murmur config set <path> <value>',
    summary:
      'Read or change murmur.json by dotted path. Values are parsed as JSON when they look like JSON (numbers, true/false, arrays, objects), else as text. The result is validated before it is saved.',
    examples: [
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
  status: { usage: 'murmur status [--json]', summary: 'Show the site, backend, deployment URL, preview and embed snippet.' },
  doctor: { usage: 'murmur doctor [--json]', summary: 'Run every check and print a fix for each failure. Exit code 1 if any check fails.' },
  embed: { usage: 'murmur embed', summary: 'Print the <script> tag to paste into the site.' },
  users: {
    usage: 'murmur users list | add <email> | remove <email> | reset <email> [--password <p>]',
    summary:
      'Manage who can sign in to the dashboard. The owner is dashboard.adminEmail; others are stored in the D1 database. A password is generated and shown once when --password is omitted.',
    examples: ['murmur users add sam@acme.com', 'murmur users reset owner@acme.com --json', 'murmur users list'],
  },
  dashboard: { usage: 'murmur dashboard', summary: 'Print the dashboard URL and the owner email.' },
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
