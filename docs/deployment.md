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
pnpm deploy         # wrangler deploy, which uploads them with the Worker
```

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
per-session message counts and any `{ kv }` prompt overrides — no session
state and no lead data, so losing it costs nothing but a reset of today's
counters.

```bash
wrangler kv namespace create MURMUR_KV
# put the returned id into wrangler.toml
```

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
