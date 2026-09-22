# Murmur

An open-source, serverless AI chat widget for websites.

The widget speaks one small REST protocol. A thin server on Cloudflare Workers
translates that protocol to any AI backend through **connectors**. No database,
no session store, free to run on the Workers free tier.

> **Status: milestones 1 and 2 done.** The protocol, the reference server, the
> `echo` connector and the widget core are built, tested and green in CI.
> Still to come: the rich message types (options, cards, carousels, links,
> inline forms) in M4, the Retell and OpenAI connectors, and lead sinks. See
> [`murmur-build-plan.md`](murmur-build-plan.md) for the full plan.

---

## Try it

```bash
pnpm install
pnpm dev          # Worker on :8787 and the widget dev server on :5173
```

Then open:

| URL | What it is |
| --- | --- |
| http://localhost:5173 | **Live playground** — the real widget on a real page, with buttons for every `window.Murmur` call, an event log, and one-click fail-safe checks |
| http://localhost:5173/gallery.html | **Component gallery** — every surface (launcher, home, lead form, thread, markdown, notices, composer states, error states, icons, mobile) rendered with the real components, with a live theme and accent picker |
| http://localhost:5173/fixtures/ | **Hostile host pages** — aggressive CSS, prototype patching, double include, SPA routing |

Each specimen in the gallery renders inside its own shadow root with the
shipped stylesheet, so what you see is exactly what a visitor gets.

### Talking to it directly

```bash
# Start a session
curl -s localhost:8787/v1/sites/demo/sessions \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"lead":{"name":"Ada","phone":"0400 000 000"},
       "context":{"pageUrl":"http://localhost:5173/"},
       "firstMessage":"/card"}'

# Send a message with the sessionToken it returned
curl -s localhost:8787/v1/sessions/messages \
  -H 'Origin: http://localhost:5173' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"text","text":"hello","clientId":"c1"}'
```

The `echo` connector answers `/options`, `/multi`, `/card`, `/carousel`,
`/links`, `/form`, `/notice`, `/slow`, `/long`, `/multipart` and `/error` — one
for every widget feature, with no paid backend and no API key.

---

## How it fits together

```
Widget (browser)  ──── Murmur protocol ────▶  Server (CF Worker)
                                               ├── connectors/echo
                                               ├── connectors/retell      (M3)
                                               ├── connectors/http        (M6)
                                               └── connectors/openai      (M6)
```

Three separable pieces:

| Package | What it is |
| --- | --- |
| [`@murmur/protocol`](packages/protocol) | Types and Zod schemas. The public contract, and the single source of truth. |
| [`@murmur/server`](packages/server) | Reference server: routes, origin allowlist, signed session tokens, connector registry. |
| [`@murmur/connector-types`](packages/connectors/_types) | The `Connector` interface and shared helpers. |
| [`@murmur/connector-echo`](packages/connectors/echo) | A deterministic connector for development and tests. |

**Sessions are stateless.** The server stores nothing. On session start it
returns an HMAC-signed token carrying the site id, session id and a small opaque
connector state. That is what makes it free and zero-maintenance: a conversation
needs no database.

---

## Configuration

One file, [`murmur.config.ts`](murmur.config.ts), typed and validated when the
Worker is built. Secrets are never written in it — they are referenced by
environment variable name and set with `wrangler secret put`.

```ts
export default defineConfig({
  sites: {
    demo: {
      origins: ['https://example.com'],
      connector: { type: 'echo' },
      security: { limits: { messagesPerSitePerDay: 500 } },
      widget: { brand: { name: 'Murmur', accent: '#5B5BF7' } },
    },
  },
});
```

See [`murmur.config.example.ts`](murmur.config.example.ts) for a production site
with Retell, a lead webhook, Turnstile and a multi-step quote flow.

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Worker + widget dev server, with the `echo` connector |
| `pnpm lint` | ESLint, type-aware |
| `pnpm test` | Unit and functional tests (Vitest) |
| `pnpm e2e` | UI, isolation and fail-safe tests (Playwright) |
| `pnpm build` | Build the widget bundles and check the size budgets |
| `pnpm typecheck` | Typecheck every package |
| `pnpm check` | All of the above |
| `pnpm deploy` | Deploy the Worker |

Local development needs `packages/server/.dev.vars` — copy
`.dev.vars.example` and keep the default secret, which is for local use only.
`pnpm e2e` needs a browser once: `npx playwright install chromium`.

## Testing

| Layer | Tool | What it covers |
| --- | --- | --- |
| Protocol | Vitest | Every message and action type, valid and invalid |
| Widget store | Vitest | Every state transition, persistence, expiry, restore |
| Markdown | Vitest | The supported subset, plus ~25 XSS fixtures |
| Validation | Vitest | The widget's hand-rolled validator cross-checked against the Zod schemas |
| Server | Vitest | Origin rejection, token tamper/expiry, limits, sanitizing, error envelopes |
| Components | Vitest + happy-dom | Each component's rendering, states and accessibility wiring |
| App flows | Vitest + happy-dom | Home → form → chat → send → reply → reload, error recovery, the error boundary |
| UI | Playwright | The whole stack in a browser, desktop and mobile |
| Isolation | Playwright | Hostile host pages; the widget and the page must both be unaffected |
| Fail-safe | Playwright | Every fatal condition in §8.3, forced individually |
| Budgets | Playwright | Bundle sizes against §11's limits |
| Demo pages | Playwright | The playground, gallery and fixtures load with no 404s or errors |

All of it runs on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

### Bundle sizes

| Bundle | gzipped | Budget |
| --- | --- | --- |
| `loader.js` | 5.1 kb | 5.5 kb |
| `app-*.js` | 24.2 kb | 35.0 kb |

The plan sets the loader at 4 kb. Reaching that meant giving up specified
behaviour — the animated orb gradient, runtime contrast correction for the
accent, or evaluating `hideOnPaths` before the app loads — so the ceiling was
raised rather than the features quietly dropped. Together the two bundles are
under 30 kb, against the plan's 35 kb for the whole widget.

---

## Docs

- [`docs/protocol.md`](docs/protocol.md) — the full wire contract, and what it
  takes to implement your own server.

---

## Licence

MIT.
