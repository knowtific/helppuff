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
- `deploy.preview`: the public demo;
- `deploy.jobs`: how Jobs (requests and quotes from the chat) was set up.

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

### Jobs are set up for the user

Deploy creates the Jobs pipeline (so the assistant can record quote and work
requests from the first visitor) and the AI picks its stages and fields from
the website: at once for other backends, and when learning finishes for
workers-ai (`deploy.jobs.status` is `waiting`). Do not choose a template
yourself. After learning finishes, read what was chosen and tell the user in
one line:

```bash
npx -y @knowtific/helppuff jobs pipeline --json
```

If `chosenBy` is still `default` with no reason, set it up now with
`jobs setup --json`. Change templates, stages or fields only when the user
asks (see **Changing what HelpPuff does** below).

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

### Live chat and the team

Only when the user asks for it (it is off by default):

```bash
npx -y @knowtific/helppuff live on --json
npx -y @knowtific/helppuff users add sam@example.com --role member --json
```

Members see only conversations, jobs, contacts, callbacks and live chat. For
Telegram, the person must create the bot with @BotFather and give you its
token; never invent one. Then:

```bash
npx -y @knowtific/helppuff telegram connect --token <token> --json
```

and tell the person to send the returned `/link <code>` in the Telegram group
or chat they will answer from. Check with `live status --json` and
`telegram status --json`. Guide: https://github.com/knowtific/helppuff/wiki/Live-Chat

## Changing what HelpPuff does

When the user asks to turn something on or off, or to change how it behaves,
use the matching command below. Change only what they asked for; everything
else keeps its default. Two kinds of setting:

- **In `helppuff.json`** (the widget, the assistant, the knowledge base,
  limits): run `config pull --json` first (the dashboard may have changed
  them), then `config set <path> <value> --json`, then `deploy --json`.
  Values are JSON when they look like JSON (`true`, `120`, `'["a","b"]'`).
  `schema --json` lists every path with its meaning.
- **On the Worker** (jobs, labels, live chat, Telegram, webhooks, tools, the
  team, API keys): their own commands, live at once, no deploy. Anything without a
  command goes through `api <METHOD> <path> --data '{…}' --json`, the public
  API with the project's admin key (the wiki's API reference lists every
  route).

| The user wants | Do |
| --- | --- |
| No form before the chat | `config set widget.leadForm.enabled false` |
| Different form questions | `config set widget.leadForm.fields '[{"name":"name","label":"Name","type":"text","required":true},{"name":"email","label":"Email","type":"email","required":true}]'` |
| What the assistant is for | `config set assistant.goal callbacks\|answers\|bookings` (`bookings` also needs `assistant.bookingUrl`) |
| Tone, answer length | `config set assistant.tone friendly\|professional\|casual`, `assistant.length short\|detailed` |
| Never quote prices | `config set assistant.prices quote` |
| Its name, the business name, colour | `widget.brand.agentName`, `widget.brand.name`, `widget.brand.accent` |
| The greeting, a teaser, the button | `widget.chat.initialMessages`, `widget.teaser`, `widget.launcher.label` / `.shape` / `.position` / `.hideOnPaths` |
| The chat's first screen: heading, buttons, useful pages | HelpPuff suggests links and questions from the website by itself; leave them unless the user asks. To change: `api POST /home/suggest` for ideas, then `config set widget.home.title "…"`, `widget.home.links '{"title":"Useful pages","items":[{"label":"Prices","url":"https://…/prices"}]}'` (`null`: none) or `widget.home.shortcuts '[…]'` (the whole list, up to 8: `reply`, `url`, `tel`, `email`, `form` or `flow` buttons) |
| Re-learn the site regularly | `config set knowledge.website.schedule weekly` |
| Another Workers AI model | `model set workers-ai --model <id>` (the wiki's AI models page compares them) |
| Another provider's model | `model set openai-compatible --preset <deepinfra\|openrouter\|deepseek\|groq\|together\|mistral\|fireworks\|vercel-ai-gateway\|cloudflare-ai-gateway> --model <id>`, or `model set openai\|gemini\|anthropic [--model <id>]`, or `--base-url <url> --key-env <NAME>` for any OpenAI-compatible API. It answers `needs_input` with the `secret set` command for the key: the user runs it |
| Their own model or knowledge code | `scaffold model --use` / `scaffold rag --use`, edit the file, `secret set` each name in its `secrets`, deploy, then `model test` / `rag test` |
| Answers from another knowledge base | `rag set none\|ai-search\|openai-vector-store --vector-store vs_…\|http --url <url> [--token-env NAME]\|custom --module ./rag.ts` (`rag set helppuff` for the default) |
| A daily spending cap | Workers AI: `config set model.budget.dailyNeurons <n>` (raise it only on Workers Paid). Any provider: `config set security.limits.messagesPerSitePerDay <n>` |
| Protection from bots | Turnstile: the user creates the widget in Cloudflare; then `config set security.captcha '{"provider":"turnstile","siteKey":"<key>","secret":{"env":"TURNSTILE_SECRET"}}'` and the user runs `secret set TURNSTILE_SECRET` |
| Talk to a person (live chat) | `live on` / `live off`; Telegram: `telegram connect --token <token>` (see above) |
| Team members | `users add <email> --role admin\|member`, `users role <email> <role>`, `users remove <email>` |
| Labels for conversations | `api POST /labels --data '{"name":"Urgent","description":"Needs an answer today"}'` (`"ai": false`: only people add it) |
| Jobs: another template | `jobs template service-quote\|projects\|support\|sales-demo\|bookings\|custom-orders\|basic` |
| Jobs: let the AI choose again | `jobs setup` |
| Jobs: call them Quotes, Tickets… | `api PUT /jobs/pipeline --data '{"itemSingular":"Quote","itemPlural":"Quotes"}'` |
| Jobs: no "Get a quote" button | `api PUT /jobs/pipeline --data '{"quoteEnabled":false}'` (its label: `"quoteLabel"`; no contact questions: `"quoteContact":false`) |
| Jobs: different quote questions | `jobs pipeline` for the field names, then `api PUT /jobs/pipeline --data '{"quote":["service","address"]}'` (in order, up to 10) |
| Jobs: the assistant should not create them | `api PUT /jobs/pipeline --data '{"assistantJobs":false}'` |
| Jobs: other stages or fields | `api GET /jobs/pipeline`; from its `pipeline`, edit the whole `stages` list or `fields` list (keep each `id`; leave out fields with `"archived": true`), save it as `{"stages":[…]}` or `{"fields":[…]}` and `api PUT /jobs/pipeline --data @pipeline.json`. Keep one open, one won and one lost stage; a removed field keeps its values on old jobs |
| Send events to another tool | `webhooks add <https url> --events lead.captured,job.created` |
| The assistant should check their API (an order, a booking, stock) | `tools add order_status --curl '<their curl, with {{args.order_number}} where the assistant fills a value in and ${ENV_NAME} for a key>' --description '<when to use it>' --param order_number='<what it is>'`; it answers `needs_input` for a missing key (the user runs `secret set`). Then `tools test order_status --arg order_number=<sample>`, add `{{order_status}}` to the sentence of `prompt.md` that says when to use it, and `deploy` |
| Look the visitor up when the chat starts | `tools add crm_lookup --url <https url> --method POST --body '{"email":"{{prechat.email}}"}' --header 'Authorization: Bearer ${CRM_KEY}' --before --description '…'`; use what it returns in `prompt.md` as `{{crm_lookup.<key>}}` (`tools test` lists the keys) |
| Save something the visitor says (an order number) | `tools add order_number --extract --field order_number='<what it is>' --description 'Save the order number once they give it'`, and `{{order_number}}` in `prompt.md`. It is saved as a conversation attribute |
| Send each finished chat to their CRM | `tools add crm_sync --url <https url> --method POST --after --description '…'` (no body: the whole conversation as JSON), or a webhook on `conversation.completed` |
| Use HelpPuff from their own server | `keys create "<name>" --preset chat` (or `--scopes …`); the key is shown once: give it to the user, never store it in the repository |
| Remove everything from Cloudflare | Only on an explicit request: `destroy --yes` |

Models and knowledge bases change only this way (never in the dashboard),
and only take effect after `deploy`; then check with `model test` / `rag test`.
Never put a key in `helppuff.json` or a chat: name the variable and have the
user run `secret set`.

Every command above takes `--json` and runs as `npx -y @knowtific/helppuff …`.
Confirm the change with the matching read (`config get <path>`,
`jobs pipeline`, `live status`, `users list`, `webhooks list`, `tools list`) and tell the
user what changed.

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
