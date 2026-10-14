# Getting started

HelpPuff is **AI-agent first**. Your coding agent (Claude Code, Codex,
Cursor, OpenCode or another) sets it up, deploys it, tests it and changes
it later, because every part of HelpPuff has a command it can run and
read. You don't have to configure anything by hand, though you can.

You need:

- **An AI coding agent**, or a terminal if you'd rather do it yourself.
- **Node.js 20 or later** (for `npx`).
- **A Cloudflare account.** The free plan is enough for the default setup.
- **A website** the assistant is for. It can be hosted anywhere; it does not have to be on Cloudflare.

## 1. Ask your AI agent

Make a folder for your assistant and open your agent in it:

```bash
mkdir my-assistant && cd my-assistant
claude        # or codex, cursor ., opencode…
```

Then paste this prompt:

> Follow the HelpPuff instructions at https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md and set up HelpPuff in this folder. Complete setup automatically with the recommended free defaults. Ask me only for information you cannot determine safely or authorization I must complete. Continue until it is deployed, added to the website when possible, tested with real questions, and you have given me the dashboard, embed and preview links.

What you do:

- **Tell it your website address.** In an empty folder there is nothing to
  read it from. (Run the prompt in your website's own repository instead,
  and it finds the address and adds the script to your pages for you.)
- **Sign in to Cloudflare** when it asks: it gives you `npx wrangler login`
  to run, which opens your browser. It never asks you to paste a key into
  the chat.
- **Open the link it gives you** to create your dashboard sign-in.

What the agent does: deploys the widget, the server, the knowledge base and
the dashboard to your Cloudflare account; picks the useful pages of your
website to learn and reads your business details; tests the assistant with
real questions, including one your site doesn't answer; then hands you the
**dashboard** link, the **script** for your site and a **preview** link.

If you'd rather choose the pages and check the business details yourself,
add "Let me choose the pages in the dashboard" to the prompt. See
[[Using with AI agents|AI-Agents]] for everything the agent does.

### Or run it yourself

In an empty folder (it becomes the assistant's project folder):

```bash
npx @knowtific/helppuff
```

```
◇ What is your website address?  acme.com.au
◇ Live on Cloudflare
└ Finish setting up: https://knowtific-helppuff-acme.you.workers.dev/admin/#/setup/…
```

That is the only question. HelpPuff then:

1. connects to Cloudflare. If this machine is not signed in, it offers to open
   `wrangler login` in your browser. An API token works too; see [[Configuration|Configuration#cloudflare-access]].
2. reads your site's name, colours, logo and contact details;
3. deploys the widget, the server, the knowledge base and the dashboard to
   your Cloudflare account, all named `knowtific-helppuff-<site>`;
4. prints a one-time **setup link**, valid for 24 hours.

## 2. Finish on the setup page

Open the link. When your agent set it up, you only create your sign-in: it
already chose the pages and read the business details, and you land on
**Home**. When you ran the CLI yourself:

1. **Create your sign-in** (email and password) for the dashboard.
2. **Your website.** It found your site's pages and ticked the useful ones
   (legal pages and old posts are left out). Click **Start learning**, or
   **Choose pages** first. Learning runs on Cloudflare in the background, so
   you can close the page.
3. **Business details.** Check the details it read from your site (name,
   phone, email, address, hours, areas you serve). The assistant gives these
   to visitors.
4. **Assistant (optional).** What it does when a visitor is interested: offer
   a callback from your team (the default), just answer, or send them to your
   booking page. **Skip** keeps the default; it is in Settings → Instructions
   later.

You land on **Home**: a live test chat, the script for your site, and a demo
link to share.

## 3. Add it to your website

If your agent worked in your website's repository, it already added the
script. Otherwise ask it ("Add HelpPuff to my website", with the site's code
open), or paste the script from Home before `</body>` on every page, or into
the layout your pages share:

```html
<script src="https://knowtific-helppuff-acme.you.workers.dev/loader.js" data-site="acme" async></script>
```

**Check my site** on Home confirms it is installed. Platform notes:

- **WordPress:** a header/footer code plugin, or your theme's footer.
- **Shopify:** `theme.liquid`, before `</body>`.
- **Next.js (App Router):** `app/layout.tsx`, `<Script src="…/loader.js" data-site="acme" strategy="afterInteractive" />`.
- **Webflow / Squarespace / Wix:** the site-wide custom code (footer) setting.

The widget can only be embedded on the origins listed in `helppuff.json`
(`origins`). Your website is added for you. To embed it somewhere else (a
staging site, say), add that origin and deploy again; see [[Configuration]].

## 4. Change it by asking

Open your agent in the project folder again and say what you want. It reads
what is set now, changes it, deploys when needed, tests it and tells you
what changed:

- *"Make the chat button orange and call the assistant Sam."*
- *"Don't ask for details before the chat starts."*
- *"Never quote prices; offer a callback instead."*
- *"Turn on live chat so my team can answer."*
- *"When someone asks where their order is, check our order API."*
- *"Upgrade HelpPuff to the latest version."*
- *"Go through my HelpPuff settings with me."*

Every page in the dashboard's **Settings** (and **Prompt & tools**,
**Knowledge**) has an **Ask your AI agent** button that copies the request
for that page. The dashboard works too: what you change there is live within
a minute, and your agent reads it before changing anything.

## 5. Keep it up to date

The commands your agent runs, if you'd rather run them yourself. From the
project folder:

```bash
npx @knowtific/helppuff deploy                 # after editing helppuff.json or prompt.md
npx @knowtific/helppuff dashboard              # a one-time sign-in link, if you lose your password
npx @knowtific/helppuff@latest upgrade         # move to a new release (see Upgrading)
```

## What is in the folder

| File | What it is | Commit it? |
| --- | --- | --- |
| `helppuff.json` | What the assistant is: site, backend, knowledge, widget, deployment ids | yes |
| `prompt.md` | How it talks (the system prompt) | yes |
| `.env` | Secrets: provider keys, `HELPPUFF_SECRET`, `ADMIN_API_KEY` | **never** (gitignored) |
| `.helppuff/` | Generated: the Worker build, the JSON Schema, deploy state | no (gitignored) |

## Choosing another AI provider

The default answers with Cloudflare Workers AI from your own site's content,
on the free plan. To use OpenAI, Gemini, Claude, Retell or your own API
instead, ask your agent ("Use OpenAI for the answers"), or:

```bash
npx @knowtific/helppuff init --no-defaults      # asks which one
npx @knowtific/helppuff init --url acme.com --backend openai --api-key "$OPENAI_API_KEY"
```

See [[Providers]].

## Removing it

```bash
npx @knowtific/helppuff destroy --yes
```

deletes everything it created on your Cloudflare account: the Worker, the
database (conversations, leads, knowledge), the KV namespace and the vector
index. Your project folder stays, so `deploy` can rebuild it. This cannot be
undone.
