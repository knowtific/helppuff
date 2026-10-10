# Using with AI agents

HelpPuff is built to be set up and looked after by coding agents (Claude Code,
Codex, Cursor, OpenCode and others) as much as by people. Give the agent the
shared instructions once; it can then set up, test and embed the assistant and
hand back the dashboard and preview links.

## The simplest path: give your agent the instructions

Copy this prompt into Claude Code, Codex, Cursor, OpenCode or another AI coding
agent:

> Follow the HelpPuff instructions at https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md and install it in this project. Complete setup automatically with the recommended free defaults. Ask me only for information you cannot determine safely or authorization I must complete. Continue until it is deployed, added to the website when possible, tested with real questions, and you have given me the dashboard, embed and preview links.

The instructions are plain Markdown. They work across agents and do not require
a plugin, skill or MCP server.

## What the agent does

1. Determines the website domain from the project, or asks if it cannot do so
   safely.
2. Runs `helppuff init --url <site> --deploy --yes --onboarding defaults --json`.
3. Starts learning the suggested pages and reads the business details in the
   background on Cloudflare.
4. After learning finishes, tests it like a visitor with
   `helppuff ask "<a real question>" --json`, including one the site does not
   answer (it should say it is not sure, not guess).
5. Adds the script to your site's shared layout, if your site's code is in the
   workspace.
6. Hands over the **dashboard** link (`deploy.setupUrl`), the **script**
   (`deploy.embed`) and the **preview** (`deploy.preview`). The setup link
   creates the user's sign-in and then opens Home because onboarding is done.

If you explicitly want to choose pages and confirm business details yourself,
ask the agent to use `--onboarding dashboard`. This is an optional handoff,
not a question agents ask during normal setup. The choice is remembered, so a
later `helppuff deploy` does not start learning pages behind your back.

If the machine is not connected to Cloudflare, the agent stops and asks you
to run `npx wrangler login` (a browser sign-in) or store an API token with
`npx -y @knowtific/helppuff secret set CLOUDFLARE_API_TOKEN`, run in the
project folder the agent names. It never asks you to paste credentials into
the chat.

## Let your agent set it up with you

You don't have to click through the dashboard's settings. Every setting has
a command, so your agent can go through them with you: it reads what is
there, explains it in plain words, asks only what changes the result, then
applies it and shows you what changed. Ask it, in the project folder:

> Go through my HelpPuff settings with me and set them up.

Every page in **Settings** (and **Prompt & tools**, **Knowledge**) has an
**Ask your AI agent** button with the request for that page to copy, for
example "Help me write my HelpPuff prompt and set up its tools".

## The contract

The shared instructions describe the workflow. Command details are also in
`helppuff --help` and the [[CLI reference|CLI-Reference]].

**Output.** With `--json`, stdout is exactly one JSON object:
`{"ok": true, …}`, or `{"ok": false, "error": {"code", "message", "hint"}}`.
Progress goes to stderr. Error `code`s are stable; `hint` says what to run next.

**Exit codes.** `0` ok · `1` error · `2` usage or a missing answer · `3` auth
or permission · `4` a Cloudflare quota or limit · `10` needs input.

**The question loop.** `init` never prompts without a terminal. When it is
missing something it needs, it exits `10` with the questions:

```json
{
  "ok": false,
  "status": "needs_input",
  "questions": [
    { "id": "website", "ask": "What is your website address?", "flag": "--url", "kind": "text", "required": true }
  ],
  "known": { "backend": "workers-ai" }
}
```

Ask the user exactly those, then re-run with each question's `flag`. `--yes`
accepts every recommended default. Secrets are never echoed back.

**Never prompts** with `--json`, `--non-interactive`, `CI=1`, or no terminal.

**Testing without tripping limits.** Visitors are limited per IP (five new
chats an hour by default). `helppuff chat` and `helppuff ask` send an owner header
derived from `HELPPUFF_SECRET`, which skips the per-IP limits (never the
per-conversation or daily caps), so an agent can test freely.

**Upgrades.** `npx -y @knowtific/helppuff@latest upgrade --check --json` reports
what would change; `… upgrade --yes --json` does it. See [[Upgrading]].

## Rules the instructions give agents

- Never print, log or commit `.env` or `ADMIN_API_KEY`; never repeat a secret.
- Never guess a website, token, key, email or account id; ask.
- Ask few questions, all together. Give the setup link immediately while
  learning continues, then finish testing when it completes.
- Stay on the free plan unless the user asks otherwise.
- Before editing `prompt.md`, run `helppuff prompt pull`: the owner may have
  changed it in the dashboard. Before deploying settings, `helppuff config pull`.
- Live chat only when asked (`helppuff live on`). For Telegram the person
  makes the bot with @BotFather and sends `/link <code>` in their chat; the
  agent runs `helppuff telegram connect --token …` with the token they give.
  See [[Live chat|Live-Chat]] and [[Telegram]].
