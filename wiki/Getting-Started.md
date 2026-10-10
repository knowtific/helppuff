# Getting started

You need:

- **Node.js 20 or later** (for `npx`).
- **A Cloudflare account.** The free plan is enough for the default setup.
- **A website** the assistant is for. It can be hosted anywhere; it does not have to be on Cloudflare.

## 1. Run it

You can either run the CLI yourself, or ask any coding agent to follow the
shared [instructions.md](https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md).

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

### When an AI agent installs it

An agent finishes onboarding automatically with the recommended defaults: it
selects the suggested pages, reads the business details, tests the result and
adds the widget when it has access to the website source. If you explicitly
prefer to choose pages and details yourself, ask it to use
`--onboarding dashboard`.

## 2. Finish on the setup page

Open the link:

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

Paste the script from Home before `</body>` on every page, or into the layout
your pages share:

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

## 4. Keep it up to date

Everything you change in the dashboard is live within a minute. From the
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
instead:

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
