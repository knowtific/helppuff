# Using with AI agents

HelpPuff is **AI-agent first**: it is made to be set up, changed and looked
after by your coding agent (Claude Code, Codex, Cursor, OpenCode and others).
You don't have to configure anything by hand, though you can. Every setting
has a command that answers in JSON, so the agent can read what is there,
change it and check the result.

## Set it up: one folder, one prompt

Make a folder for your assistant and open your agent in it:

```bash
mkdir my-assistant && cd my-assistant
claude        # or codex, cursor ., opencode…
```

Then paste this prompt:

> Follow the HelpPuff instructions at https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md and set up HelpPuff in this folder. Complete setup automatically with the recommended free defaults. Ask me only for information you cannot determine safely or authorization I must complete. Continue until it is deployed, added to the website when possible, tested with real questions, and you have given me the dashboard, embed and preview links.

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

(Running it in your website's own repository works too: the agent finds the
address there and adds the script to your pages.)

## Change anything by asking

Open your agent in the project folder and say what you want, in your own
words:

- *"Make the chat button orange and call the assistant Sam."*
- *"Don't ask for details before the chat starts."*
- *"Never quote prices; offer a callback instead."*
- *"Turn on live chat so my team can answer."*
- *"When someone asks where their order is, check our order API."*
- *"Send hot leads to our Slack."*
- *"Upgrade HelpPuff to the latest version."*

It reads the current settings first (including what was changed in the
dashboard), changes only what you asked, deploys when needed, tests it with
a real question and tells you what changed.

Or let it walk you through everything: it reads what is there, explains it
in plain words, asks only what changes the result, then applies it. Ask it,
in the project folder:

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
