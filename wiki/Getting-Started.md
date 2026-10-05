# Getting started

You need:

- **Node.js 20 or later** (for `npx`).
- **A Cloudflare account.** The free plan is enough for the default setup.
- **A website** the assistant is for. It can be hosted anywhere; it does not have to be on Cloudflare.

## 1. Run it

In an empty folder (it becomes the assistant's project folder):

```bash
npx @knowtific/murmur
```

```
◇ What is your website address?  acme.com.au
◇ Live on Cloudflare
└ Finish setting up: https://knowtific-murmur-acme.you.workers.dev/admin/#/setup/…
```

That is the only question. Murmur then:

1. connects to Cloudflare. If this machine is not signed in, it offers to open
   `wrangler login` in your browser. An API token works too; see [[Configuration|Configuration#cloudflare-access]].
2. reads your site's name, colours, logo and contact details;
3. deploys the widget, the server, the knowledge base and the dashboard to
   your Cloudflare account, all named `knowtific-murmur-<site>`;
4. prints a one-time **setup link**, valid for 24 hours.

## 2. Finish on the setup page

Open the link:

1. **Create your sign-in** (email and password) for the dashboard.
2. **Your pages.** It found your site's pages and ticked the useful ones (legal
   pages and old posts are left out). Click **Start learning**, or **Choose
   pages** first. Learning runs on Cloudflare in the background, so you can
   close the page.
3. **Your details.** Check the business details it read from your site
   (phone, email, address, hours) and pick what the assistant is mainly for.

You land on **Home**: a live test chat, the script for your site, and a demo
link to share.

## 3. Add it to your website

Paste the script from Home before `</body>` on every page, or into the layout
your pages share:

```html
<script src="https://knowtific-murmur-acme.you.workers.dev/loader.js" data-site="acme" async></script>
```

**Check my site** on Home confirms it is installed. Platform notes:

- **WordPress:** a header/footer code plugin, or your theme's footer.
- **Shopify:** `theme.liquid`, before `</body>`.
- **Next.js (App Router):** `app/layout.tsx`, `<Script src="…/loader.js" data-site="acme" strategy="afterInteractive" />`.
- **Webflow / Squarespace / Wix:** the site-wide custom code (footer) setting.

The widget can only be embedded on the origins listed in `murmur.json`
(`origins`). Your website is added for you. To embed it somewhere else (a
staging site, say), add that origin and deploy again; see [[Configuration]].

## 4. Keep it up to date

Everything you change in the dashboard is live within a minute. From the
project folder:

```bash
npx @knowtific/murmur deploy                 # after editing murmur.json or prompt.md
npx @knowtific/murmur dashboard              # a one-time sign-in link, if you lose your password
npx @knowtific/murmur@latest upgrade         # move to a new release (see Upgrading)
```

## What is in the folder

| File | What it is | Commit it? |
| --- | --- | --- |
| `murmur.json` | What the assistant is: site, backend, knowledge, widget, deployment ids | yes |
| `prompt.md` | How it talks (the system prompt) | yes |
| `.env` | Secrets: provider keys, `MURMUR_SECRET`, `ADMIN_API_KEY` | **never** (gitignored) |
| `.murmur/` | Generated: the Worker build, the JSON Schema, deploy state | no (gitignored) |
| `AGENTS.md`, `.claude/skills/murmur/` | Instructions for coding agents that open the folder | yes |

## Choosing another AI provider

The default answers with Cloudflare Workers AI from your own site's content,
on the free plan. To use OpenAI, Gemini, Claude, Retell or your own API
instead:

```bash
npx @knowtific/murmur init --no-defaults      # asks which one
npx @knowtific/murmur init --url acme.com --backend openai --api-key "$OPENAI_API_KEY"
```

See [[Providers]].

## Removing it

```bash
npx @knowtific/murmur destroy --yes
```

deletes everything it created on your Cloudflare account: the Worker, the
database (conversations, leads, knowledge), the KV namespace and the vector
index. Your project folder stays, so `deploy` can rebuild it. This cannot be
undone.
