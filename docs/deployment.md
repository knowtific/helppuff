# Deploying

## One Worker, not two

The widget and the API are the **same Worker**.

```
                    chat.knowtific.com  (one Worker)
                    ├── /loader.js        static asset, from the edge
                    ├── /app-<hash>.js    static asset, from the edge
                    └── /v1/*             the protocol, from the Worker
```

Cloudflare serves a request that matches a built file straight from the
edge, without invoking your Worker or costing a request. Everything else
falls through to the Hono app. That is what `[assets]` in `wrangler.toml`
does, and it is why the embed snippet needs only one host:

```html
<script src="https://chat.knowtific.com/loader.js" data-site="knowtific" async></script>
```

The loader resolves the app chunk against **its own `src`**, not against the
page it is embedded on, so the two files always find each other wherever the
Worker is deployed.

### Caching

Written by the widget build into `dist/_headers`:

| Path | Cache-Control | Why |
| --- | --- | --- |
| `/loader.js` | `public, max-age=300` | Its content changes when the app hash does, so it cannot be immutable |
| `/app-<hash>.js` | `public, max-age=31536000, immutable` | Content-hashed, so a new build is a new URL |

Both also send `Access-Control-Allow-Origin: *`. That is not optional: the
`<script src>` needs no CORS, but the loader's `import()` of the app chunk is
a **module** fetch, and module fetches are always CORS-mode. Without it the
widget works on its own origin and fails on every real host page — a bug a
local dev server cannot show you, because there everything is same-origin.

## Would two Workers ever be right?

Only if you want the widget on a CDN path you already own, or to version the
two independently. `data-api` exists for that:

```html
<script src="https://cdn.knowtific.com/murmur/loader.js"
        data-site="knowtific"
        data-api="https://chat.knowtific.com" async></script>
```

The widget then talks to `data-api` for the protocol and loads the app chunk
from wherever the loader itself came from. Both hosts need the CORS header
above, and the API host needs your site in its `origins` allowlist.

Unless you have that need, one Worker is simpler, cheaper and one fewer
thing to keep in step.

---

## Deploying

```bash
pnpm build          # widget bundles into packages/widget/dist
pnpm deploy:worker     # wrangler deploy, which uploads them with the Worker
```

`pnpm deploy:worker`, not `pnpm deploy`: pnpm has a built-in `deploy` command for
copying a workspace package into a directory, and it shadows the script —
failing with `ERR_PNPM_NOTHING_TO_DEPLOY` rather than passing through.

The build must run first — `wrangler deploy` uploads whatever is in `dist`
at that moment. `scripts/setup.sh` wires up a first deployment end to end.

### Secrets

Nothing sensitive belongs in `wrangler.toml` or `murmur.config.ts`. The
config refers to secrets by name:

```ts
connector: { type: 'gemini', options: { apiKey: { env: 'GEMINI_API_KEY' } } }
```

and the value is set on the Worker:

```bash
wrangler secret put MURMUR_SECRET      # openssl rand -base64 32
wrangler secret put GEMINI_API_KEY
```

Locally the same names go in `packages/server/.dev.vars` — see
[`.dev.vars.example`](../packages/server/.dev.vars.example) for the full
list. That file is gitignored.

### KV

One namespace, bound as `MURMUR_KV`. It holds rate-limit counters,
per-session message counts, `{ kv }` prompt overrides and any stored site
config — no session state and no lead data, so losing it costs nothing but a
reset of today's counters and a fall back to the deployed config.

```bash
wrangler kv namespace create MURMUR_KV
# put the returned id into wrangler.toml
```

---

## Changing config without a deploy

`murmur.config.ts` is compiled into the Worker, so editing it is a deploy.
It is also **gitignored** — the committed files are `murmur.config.demo.ts`,
which a fresh clone is started from, and `murmur.config.example.ts`, which
documents a production site. Your origins, agent ids and copy never enter
the repository.

For anything that changes more often than a deploy, put it in KV under
`config:<siteId>`:

```bash
cat > site.json <<'JSON'
{
  "widget": {
    "brand": { "name": "Knowtific", "agentName": "Alex", "accent": "#0EA5E9" },
    "home": { "title": "Hi there", "subtitle": "Ask us anything." }
  }
}
JSON

wrangler kv key put --binding=MURMUR_KV "config:knowtific" --path ./site.json
```

The next request picks it up. No build, no deploy, nothing committed.

To push a site's widget exactly as `murmur.config.ts` defines it, generate the
file instead of writing it by hand — it is checked against the schema the
Worker parses KV with:

```bash
node scripts/kv-config.mjs knowtific > site.knowtific.json
wrangler kv key put --binding=MURMUR_KV "config:knowtific" --path ./site.knowtific.json
```

**Whole sections replace their deployed counterpart**; anything you leave out
keeps its deployed value. So an override containing only `widget` swaps the
whole widget config — including parts you did not mention, which fall back to
their schema defaults, not to the deployed widget. Merging field by field
would make what is actually in force impossible to read off either source
alone. The four sections are `connector`, `widget`, `security` and `sinks`.

### Two things it deliberately will not do

**`origins` cannot be set from KV.** The CORS allowlist is built once when the
Worker starts, so an origin added in KV would pass the route check and still
be refused by the browser — a failure curl cannot show you. It also means
write access to KV cannot widen who may embed your widget. A stored config
carrying `origins` is rejected **whole**, not partially applied, and logged as
`config.kv_invalid`: believing you have locked a domain when you have not is
worse than an override that visibly did not take.

**A site must already exist in the deployed config**, since that is where its
origins come from. Adding a site is still a deploy.

### When a stored config is broken

It is ignored, and the site runs on what shipped in the bundle. Unparsable
JSON logs `config.kv_unparsable`; a shape the schema rejects logs
`config.kv_invalid` with the offending field paths — never their values, which
could be anything (§7.2). A bad paste into KV degrades to the last deployed
config; it never takes a site offline.

Reads are cached at the edge for 60 seconds, so a change takes up to a minute
to appear everywhere.

### Where each thing belongs

| | Lives in | Changing it is |
| --- | --- | --- |
| API keys, `MURMUR_SECRET` | `wrangler secret put` | Live |
| System prompt | KV, via `{ kv: 'prompt:…' }` | Live |
| Brand, copy, shortcuts, flows, limits, connector options | KV, via `config:<siteId>` | Live |
| `origins`, and adding a site | `murmur.config.ts` | A deploy |

---

## Checking a release against the real thing

```bash
pnpm prod:preview        # then open http://localhost:5173/
```

This serves one page, `demo/prod.html`, which loads the **deployed** Worker:
its bundles from the edge, its connector, its lead sink. The only thing
localhost provides is the page itself — everything else is production.

It binds port 5173 on purpose. If the dev server is running, the bind fails
and says so rather than starting beside it: with both up you cannot tell from
the outside whether a request went to the edge or to `localhost:8787`. Serving
on the dev server's own port also keeps the page's origin at
`http://localhost:5173`, which is what the development sites' `origins`
allow — on any other port the Worker would refuse every call, and that 403
would look like a bug rather than a misconfigured preview.

Nothing else is served. A request for anything but the page returns a 404
naming what it would have come from, so an accidental import from the dev
server is impossible to miss.

The page uses whichever site allows localhost. The production site does not,
by design, so it cannot be driven from here. Override with
`?worker=https://…&site=…`.

### Every site deploys together

One config, one Worker: a site whose `origins` are all localhost is still
live on the deployed Worker, and an `Origin` header is trivially forged
outside a browser. So a development site's rate limits are real limits in
production.

That is fine for a site on the `echo` connector, which costs nothing. It is
not fine for one pointing at a paid backend — `pnpm bootstrap`'s config review
warns about exactly that case.

---

### Checklist for a real site

1. `origins` lists every host the widget is embedded on, including `www`.
2. `messagesPerSitePerDay` is set to something you are willing to pay for.
   It is the backstop that holds when everything else fails.
3. Turnstile is configured, if the site is public. It is the only layer that
   separates a human from a script — see [`security.md`](security.md).
4. `fallbackContact` is set, so a visitor still has a way to reach you when
   the assistant cannot.
5. The per-IP limits are production values, not the development ones in the
   committed `murmur.config.ts`.
