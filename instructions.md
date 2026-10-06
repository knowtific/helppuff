# HelpPuff instructions for AI coding agents

You are responsible for installing, configuring, deploying and testing
Knowtific HelpPuff for the user. HelpPuff runs in the user's own Cloudflare
account and includes the website widget, chat API, knowledge base and CRM
dashboard.

Follow these instructions directly. A plugin, skill and MCP server are not
required. Use the CLI with `--json`, read every result, and continue until the
assistant is deployed and tested or you reach a step only the user can perform.

## 1. Establish where to work

- If the workspace contains `helppuff.json`, this is an existing HelpPuff
  project. Do not run `init`; follow **Existing projects** below.
- If the workspace is the website's source repository, work in its root so the
  HelpPuff project and embed change can be committed with the website.
- Otherwise, create a dedicated folder such as `chat-assistant/`. Do not put
  HelpPuff files into an unrelated repository.

Before changing files, inspect the repository's own agent instructions and
working tree. Preserve unrelated changes.

## 2. Use the defaults and ask only when blocked

For a new installation, determine the website domain from the repository only
when it is unambiguous. Never guess it; ask for the domain when it is not clear.

Complete onboarding automatically with the recommended setup: Cloudflare
Workers AI on the Workers Free plan, suggested website pages, dashboard and
lead capture. Do not ask whether the user wants manual onboarding, or ask about
models, crawl patterns, tone, forms or other settings unless they request
customisation. Only ask further questions when authorization is required or the
CLI returns `needs_input`.

## 3. Create and deploy

Run this from the chosen project folder:

```bash
npx -y @knowtific/helppuff init --url <website> --deploy --yes --onboarding defaults --json
```

Only when the user explicitly asks to choose pages and business details in the
web dashboard, run instead:

```bash
npx -y @knowtific/helppuff init --url <website> --deploy --yes --onboarding dashboard --json
```

If the user explicitly selected pages or URL patterns, pass them with
`--crawl`, for example:

```bash
npx -y @knowtific/helppuff init --url <website> --deploy --yes --onboarding defaults --crawl "**/services/**,**/faq/**" --json
```

Every JSON command returns one result. If it returns `status: "needs_input"`
or exits with code `10`, ask the user exactly the questions in `questions`,
using each question's `ask`, `options` and `default`. Rerun the command with
the corresponding `flag` values. This is expected control flow, not a failure.

Follow an error's `hint` before improvising. Never invent a website, email,
account ID, token, provider key or business fact.

## 4. Connect Cloudflare safely

Cloudflare access is the only external account required by the default setup.
If the CLI reports that this machine is not connected, give the user these two
choices.

### Browser login (recommended)

Ask the user to run this in their terminal and tell you when it succeeds:

```bash
npx wrangler login
```

Do not run an interactive browser login unattended. After the user confirms
success, rerun the HelpPuff command.

### API token

If browser login is unavailable, direct the user to:

https://dash.cloudflare.com/profile/api-tokens

The token needs:

- Account › Workers Scripts › Edit
- Account › Workers KV Storage › Edit
- Account › D1 › Edit
- Account › Vectorize › Edit
- Account › Account Settings › Read
- Account › AI Search › Edit and Account › AI Search › Run, only when using
  the AI Search backend

Never ask the user to paste a token into chat. Ask them to store the token
through HelpPuff's hidden prompt. This works even before the project is
initialised, but only from the project folder chosen in step 1, because `init`
reads the `.env` of the folder it runs in. Give them the exact folder:

```bash
cd <project folder>
npx -y @knowtific/helppuff secret set CLOUDFLARE_API_TOKEN
```

This saves it in that folder's gitignored `.env`. Provider keys use the same
flow, for example `secret set OPENAI_API_KEY`. Never print, repeat, log or
commit a secret.

## 5. Follow the deployment result

Read the successful JSON result and retain:

- `deploy.setupUrl`: one-time dashboard setup link, valid for 24 hours;
- `deploy.embed`: the website script;
- `deploy.preview`: the public demo.

If the user chose dashboard setup, give them `deploy.setupUrl` immediately and
explain that it creates their sign-in, lets them choose pages, and confirms
their business details. Do not claim learning or answer testing is complete.
You may add the widget while they do this; resume the checks below after they
say setup is finished.

For automatic setup, give the setup link to the user as soon as it is
available. Learning is already running in the background, so they do not need
to wait to create their dashboard sign-in. Continue the technical verification
while it runs.

Poll until learning finishes:

```bash
npx -y @knowtific/helppuff knowledge status --json
```

If pages fail, inspect their errors and fix the cause. Do not silently treat a
partially failed crawl as complete.

## 6. Test it like a visitor

Once learning is complete, ask two or three realistic questions:

```bash
npx -y @knowtific/helppuff ask "<a real customer question>" --json
```

Check both `reply` and `sources`. A correct answer should rely on the relevant
page. Include one question the website does not answer; the assistant should
say it is unsure instead of inventing an answer.

Use the narrowest correction when a test fails:

```bash
# Add a document
npx -y @knowtific/helppuff knowledge upload <file> --wait --json

# Add or correct an authoritative fact
npx -y @knowtific/helppuff knowledge facts set phone="..." --json

# Add a hand-written FAQ
npx -y @knowtific/helppuff knowledge add --file faq.md --json
```

Use `prompt.md` only for business-specific behaviour that is not already a
setting or built-in rule. Pull the live prompt before editing it:

```bash
npx -y @knowtific/helppuff prompt pull --json
npx -y @knowtific/helppuff deploy --json
```

## 7. Add the widget

If the website source is in the workspace, add the exact `deploy.embed` script
to the shared site layout. Preserve the framework's conventions and existing
script-loading strategy.

- Next.js App Router: use `next/script` in `app/layout.tsx` with
  `strategy="afterInteractive"`.
- Plain HTML: place it before `</body>` in the shared template.
- Other platforms without source access: tell the user to paste it into the
  site-wide footer or custom-code area.

Verify the script is present in the implementation. Do not claim the website
installation is complete when you only supplied instructions.

## 8. Hand over

Report:

1. the dashboard setup link;
2. whether the widget was added, or the exact embed script and where to add it;
3. the preview link;
4. the questions tested and whether their sources were correct;
5. any crawl failures, missing knowledge or user action still required.

If the setup link expires, create another one with:

```bash
npx -y @knowtific/helppuff dashboard --json
```

## Existing projects

Do not reinitialise a project that already has `helppuff.json`.

Check for a new HelpPuff release:

```bash
npx -y @knowtific/helppuff@latest upgrade --check --json
```

Explain the reported changes. Upgrade only when the user asked for an update or
approves it:

```bash
npx -y @knowtific/helppuff@latest upgrade --yes --json
```

The upgrade preserves conversations, leads, dashboard accounts, settings,
prompt history, webhooks, knowledge and uploaded files. The full upgrade and
rollback guide is:

https://github.com/knowtific/helppuff/wiki/Upgrading

For normal changes:

- Run `prompt pull --json` before editing `prompt.md`.
- Run `config pull --json` before editing `helppuff.json` when dashboard
  settings may have changed.
- Relearn changed pages with `crawl --json`.
- Add documents with `knowledge upload <file...> --wait --json`.
- Diagnose failures with `doctor --json` and follow each reported fix.

## Non-negotiable rules

- Never expose or commit `.env`, `ADMIN_API_KEY`, Cloudflare tokens or provider
  keys.
- Never guess credentials, account identifiers or business facts.
- Stay on the Workers Free plan and default backend unless the user chooses
  otherwise.
- Keep questions few, grouped and limited to decisions the CLI cannot make.
- Use `--json` for agent-driven commands and follow `needs_input` and `hint`.
- Preserve unrelated repository changes.
- Do not overwrite newer dashboard changes to settings or prompts.
- Do not stop at deployment: verify learning, answers, sources and embedding.
