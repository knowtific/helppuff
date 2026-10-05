/**
 * The agent skill: how an AI coding agent (Claude Code, Codex, Cursor…) sets
 * up and runs a Murmur assistant for its user. One text, three homes:
 *
 *  - the Claude Code plugin (`plugin/skills/website-chatbot/SKILL.md`),
 *    installed before any project exists, so "add a chatbot to my site"
 *    finds it;
 *  - `murmur skill install`, which writes it to ~/.claude/skills;
 *  - every project `murmur init` creates.
 *
 * A test keeps the plugin's copy identical to this one.
 */

export const SKILL_NAME = 'website-chatbot';

const CLI = 'npx -y @knowtific/murmur';

export const SKILL_MD = `---
name: ${SKILL_NAME}
description: Add, change, test or deploy an AI chat assistant (chatbot, chat widget, support or sales bot, lead capture) on a website — answering from the site's own pages and documents, with a leads dashboard — on the user's own Cloudflare account, using the Knowtific Murmur CLI (${CLI}). Use when the user wants a chatbot or AI assistant on their website, or wants to change what an existing one (murmur.json) says, knows or looks like.
---

# Website chat assistant (Knowtific Murmur)

Everything runs through one CLI: \`${CLI} <command> --json\`. Its \`--help\` is written
for you; read it once. Every command with \`--json\` prints one JSON object:
\`{"ok":true,…}\`, or \`{"ok":false,"error":{code,message,hint}}\` — follow \`hint\`.
(If \`murmur_*\` MCP tools are available you may use them instead; the steps are the same.)

## Setting one up

1. **Where.** If there is a \`murmur.json\` here, it is already set up — go to *Changing it*.
   If this repository is the user's website, set up here (murmur.json sits beside their
   code). Otherwise make a folder such as \`chat-assistant/\` and work in it.

2. **Ask once, briefly.** The only thing you must have is the **website URL** — never guess
   it. The default setup is free and needs nothing else: Workers AI answering from the
   site's own pages, crawled into a knowledge base on the user's Cloudflare account. Offer
   the rest in one message (each has a default; "just do it" means the defaults):
   - nothing else is needed: the setup page reads the business details from the site
     and asks for the main goal; tone, must-know and never-say are in Settings later.
   - another backend only if they ask for one: OpenAI, Gemini, Claude, Retell, or their own API.

3. **Create and deploy.**
   \`${CLI} init --json --url <site> --deploy --yes\`
   - \`"status":"needs_input"\` (exit code 10) is not a failure: ask the user exactly those
     \`questions\` (use \`ask\`, \`options\`, \`default\`), then re-run with each \`flag\` added.
   - You are the onboarding: init starts learning the suggested pages and reads the business
     details itself, in the background on Cloudflare (a Workflow) — nothing waits for it.
     \`--crawl "**/services/**,**/faq/**"\` (or \`knowledge.website.include\` in murmur.json)
     chooses pages; \`murmur discover\` lists what it found. Documents the user gives you:
     \`${CLI} knowledge upload <file…> --json\`.

4. **Cloudflare access** — the one real prerequisite. If init asks for \`cfToken\`, this
   machine is not connected to Cloudflare. Tell the user, and offer:
   - **Easiest:** ask them to run \`! npx wrangler login\` here (the \`!\` runs it in their
     terminal and opens a browser). Then re-run init — no token needed.
   - **Or an API token:** created at https://dash.cloudflare.com/profile/api-tokens with the
     permissions listed in \`${CLI} --help\`. Best if they store it themselves with
     \`! ${CLI} secret set CLOUDFLARE_API_TOKEN\` (hidden prompt). If they paste it to you
     instead, pass it once as \`--cf-token\`; it goes to \`.env\` and is never printed.
   Provider keys work the same way (\`secret set OPENAI_API_KEY\`, or \`--api-key\`).

5. **Test it like a visitor.** Check \`${CLI} knowledge status --json\` until the crawl is
   \`done\` (or \`${CLI} crawl --wait --json\`), then \`${CLI} ask "<a real question about their
   business>" --json\` two or three times. Read \`reply\` and \`sources\`: a right answer cites the
   right page; a question the site does not cover should get "not sure", not a guess. Wrong?
   Add knowledge (\`knowledge add --file faq.md\`), fix facts (\`knowledge facts set phone=…\`),
   or tighten \`prompt.md\` and deploy.

6. **Put it on their site.** If their website's code is here, add the \`embed\` script before
   \`</body>\` in the layout every page shares — Next.js App Router: \`app/layout.tsx\` with
   \`<Script src="…/loader.js" data-site="…" strategy="afterInteractive" />\`; plain HTML: the
   shared template or every page. Otherwise give them the snippet to paste.

7. **Hand over.** Give the user three things, nothing more: the dashboard
   (\`deploy.setupUrl\` — a one-time link, 24 hours, where they create their sign-in; it opens
   on Home with the test chat, since you did the onboarding), the script (\`deploy.embed\`)
   and the demo (\`deploy.preview\`). Lost or expired: \`${CLI} dashboard --json\` mints a
   sign-in link. (Other backends: the dashboard email, and \`dashboardLogin.password\` from
   init if one was generated.)

## Changing it

- What it says → \`${CLI} prompt pull --json\` first (the owner may have edited it in the
  dashboard since), then edit \`prompt.md\`. Every deploy that changes it publishes a new
  version; the owner sees the history in the dashboard and can restore any of them.
- Deploy fails with \`prompt_behind\` / \`prompt_diverged\` → the live prompt changed elsewhere.
  Run \`${CLI} prompt pull --json\`. If it returns a \`backup\` (prompt.mine.md), those are the
  unpublished edits: merge them into \`prompt.md\`, delete the backup, deploy again. Never
  work around it by overwriting — that would silently undo the owner's change.
- Undo a prompt change → \`${CLI} prompt history --json\`, then
  \`${CLI} prompt pull --version <n> --json\` and deploy (or restore it in the dashboard).
- Look, greeting, pre-chat form, backend →
  \`murmur.json\` (\`${CLI} schema\` lists every field) or \`${CLI} config set <path> <value>\`.
  Then \`${CLI} deploy --json\` — content changes are live in seconds.
- Deploy fails with \`settings_changed\` → the owner changed settings in the dashboard. Run
  \`${CLI} config pull --json\`, review the murmur.json diff, deploy again.
- New pages or site changes → \`${CLI} crawl --json\` (re-crawls the selected pages; unchanged
  pages cost nothing). New documents → \`${CLI} knowledge upload <file…> --wait --json\`
  (PDF, Word, Markdown or text, read on the Worker), or list them in \`knowledge.files\`
  and deploy. Other backends: \`knowledge sync\`.
- Team access → \`users add <email>\`; forgotten password → \`users reset <email>\`.
- Something wrong → \`${CLI} doctor --json\`: every failing check has a \`fix\`.

## Rules

- Never print, log or commit \`.env\`; never repeat a secret back to the user.
- Never guess a website, token, key, email or account id — ask.
- Keep questions few and together; don't make the user wait for crawling.
- Stay on the free plan unless the user asks: the default model and budget fit it.
`;

/** The section `init` appends to a project's AGENTS.md (read by Codex and others). */
export const AGENTS_MARKER = '<!-- murmur:agents -->';
export const AGENTS_SECTION = `${AGENTS_MARKER}
## Website chat assistant (Knowtific Murmur)

${SKILL_MD.replace(/^---[\s\S]*?---\n+/, '').replace(/^# .*\n+/, '')}`;
