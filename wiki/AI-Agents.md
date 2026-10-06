# Using with AI agents

HelpPuff is built to be set up and looked after by coding agents (Claude Code,
Codex, Cursor and others) as much as by people. "Add an AI chatbot to my
website" is enough: the agent sets it up, tests it, adds the script to your
site and gives you three links.

## Teach your agent once

```bash
# Claude Code: the plugin bundles the skill and the MCP server
/plugin marketplace add <owner>/<repo>
/plugin install knowtific-helppuff@knowtific

# or just the skill (Claude Code; add --codex for Codex)
npx -y @knowtific/helppuff skill install

# or the MCP server, for any MCP client
claude mcp add helppuff -- npx -y @knowtific/helppuff mcp
```

Every project `init` creates also carries an `AGENTS.md` and a Claude Code
skill (`.claude/skills/helppuff/`), so the next agent that opens the folder
already knows how to change and test it.

## What the agent does

1. Runs `helppuff init --url <site> --deploy --yes --json`.
2. **Does the onboarding itself.** With no person at a browser (`--json`, no
   terminal, or `--no-browser`), `init` and the first `deploy` start learning
   the suggested pages and read the business details from the site, in the
   background on Cloudflare. Pages can be chosen with `--crawl "<globs>"` or
   `knowledge.website.include` / `exclude` in `helppuff.json`.
3. Tests it like a visitor: `helppuff ask "<a real question>" --json`, including
   one the site does not answer (it should say it is not sure, not guess).
4. Adds the script to your site's shared layout, if your site's code is in the
   workspace.
5. Hands over three things: the **dashboard** link (`deploy.setupUrl`, a
   one-time link where you create your sign-in; it opens on Home, since there
   is nothing left to onboard), the **script** (`deploy.embed`) and the
   **demo** (`deploy.preview`).

If the machine is not connected to Cloudflare, the agent stops and asks you
to run `! npx wrangler login` (a browser sign-in) or store an API token with
`! npx -y @knowtific/helppuff secret set CLOUDFLARE_API_TOKEN`. It never asks
you to paste credentials into the chat.

## The contract

Everything an agent needs is in `helppuff --help` (written to be followed
literally) and in [[CLI reference|CLI-Reference]].

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

## MCP tools

`helppuff mcp` serves the same engine over stdio: `helppuff_setup`,
`helppuff_deploy`, `helppuff_crawl`, `helppuff_knowledge_status`,
`helppuff_knowledge_add`, `helppuff_knowledge_sync`, `helppuff_ask`, `helppuff_chat`,
`helppuff_status`, `helppuff_doctor`, `helppuff_config`, `helppuff_prompt`,
`helppuff_secret`, `helppuff_schema`.

## Rules the skill gives agents

- Never print, log or commit `.env` or `ADMIN_API_KEY`; never repeat a secret.
- Never guess a website, token, key, email or account id; ask.
- Ask few questions, all together; do not make the user wait for learning.
- Stay on the free plan unless the user asks otherwise.
- Before editing `prompt.md`, run `helppuff prompt pull`: the owner may have
  changed it in the dashboard. Before deploying settings, `helppuff config pull`.
