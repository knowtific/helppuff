# Security model

The widget is public, unauthenticated code running in a browser you do not
control, talking to an endpoint that costs you money per request. That shapes
everything below.

## The uncomfortable part, first

**You cannot make the API usable "only by the widget, only on your domain."**
Not with origin checks, not with a signed request, not with anything shipped to
a browser. Two reasons:

1. **`Origin` and `Referer` are set by the browser, not by the caller.** That
   is exactly why they work *against other websites* — a page on
   `evil.example` genuinely cannot forge them in a real browser. But `curl`,
   a script or a server sets them to whatever it likes. Origin checking stops
   one real threat completely and another not at all.

2. **Any secret in the widget is a public secret.** Signing requests with HMAC
   from the browser needs a key in the bundle. An attacker reads it out of
   `app-*.js` in about a minute and signs their own requests. It raises the
   effort from "trivial" to "mildly annoying" and costs real complexity — it
   does not create a trust boundary.

So the goal is not "prove the caller is our widget." It is **bound cost and
bound damage**, in layers, so that every remaining path to abuse is either
expensive for the attacker or cheap for you.

## What each layer actually buys

| Layer | Stops | Does not stop | Status |
| --- | --- | --- | --- |
| Origin allowlist | Another site embedding your widget and spending your budget through real visitors' browsers | A script setting its own `Origin` | **Built** |
| CORS reflection | A browser on another origin reading your responses | Anything non-browser | **Built** |
| Signed session tokens | Forging or editing a session, reading connector state, cross-site token reuse | Replay by whoever holds the token | **Built** |
| Per-session message cap | A single conversation running away | Opening many sessions | **Built** |
| Lead field validation | Junk and oversized lead data reaching a sink | — | **Built** |
| Turnstile | Scripted abuse. **This is the only layer that meaningfully separates "a human in a browser" from "a script"** | A determined attacker paying a solver service | **Built** |
| Per-IP rate limits | Casual scripted abuse, accidental loops | A distributed attacker | **Built** |
| Daily per-site quota | **Everything, eventually.** The cost backstop that holds when every other layer fails | Denying service to real visitors once tripped | **Built** |

The honest summary: **Turnstile plus the daily quota are the real defences.**
Origin checking handles a different (and common) threat. Everything else
limits blast radius.

---

## Holes

### Closed

**The per-session cap is no longer bypassable.** It used to be counted from
`count` inside the session token, and the client chooses which token it
sends — so replaying the original reset the count on every request and the
cap never tripped. It is now a KV counter keyed by session id, which the
client cannot rewind. There is a test that replays the first token forever
and asserts the cap still trips.

**Rate limits are enforced.** `messagesPerIpPerMinute`, `sessionsPerIpPerHour`
and `messagesPerSitePerDay` were configured, validated and read by no code
path. All three now run, before anything that costs money, scoped per site so
one site's traffic cannot consume another's budget. IPs are hashed with the
server secret before they enter a key (§7.2).

**Turnstile is verified.** `captchaToken` is checked against siteverify when a
site configures a captcha. An unreachable Cloudflare counts as a failure, not
a pass — otherwise taking siteverify offline would take the captcha offline
with it.

KV is eventually consistent, so a determined attacker racing requests can slip
a few past a limit. That is accepted: these bound cost, they do not bill. A
few messages past 500 is fine; a few thousand is not, and the daily quota
catches that.

### Config stored in KV

A `config:<siteId>` key overrides the deployed config for that site
([`deployment.md`](deployment.md)). That makes KV write access a privileged
position: it can change the connector, the lead destination and the limits.
Two deliberate bounds keep it from being a complete one:

- **`origins` cannot be set from KV**, so it cannot widen who may embed the
  widget. The allowlist is fixed at deploy. A stored config carrying
  `origins` is rejected whole rather than partly applied.
- **A site must exist in the deployed config**, so KV cannot invent one.

It can still point a real site at a different connector, which is worth
knowing when deciding who gets a KV-writing API token. Stored config is
validated against the same schema as the bundled config, so it cannot be used
to smuggle a shape the server would not otherwise accept, and a config that
fails validation falls back to the deployed one.

### Still open

**Session tokens are bearer tokens.** Anyone holding one can continue that
conversation from anywhere. Mitigated by a short TTL and by the token carrying
nothing but ids and small connector state — no lead data, no keys. Binding to
the hashed IP was considered and rejected: mobile networks change IP
mid-conversation, so it would break real visitors to inconvenience an attacker
who can simply start a new session.

**No request-size cap before parsing.** Bodies are bounded by the schemas, but
the whole body is read and parsed first. A `Content-Length` check at the edge
would be cheap. Not done.

**`/config` is public and not rate limited.** By design — it is public data,
and edge-cached for 5 minutes. It reveals the site's shortcuts, form fields
and captcha site key, none of which are secret.

**Origin can be forged by a non-browser.** Inherent, and why Turnstile and the
daily quota are the layers that carry the weight.

## What is deliberately safe

- **The connector's API key never reaches the browser.** Secrets are `{ env }`
  references resolved inside the Worker.
- **No PII in logs** — event names, site ids, session ids, counts, latencies
  and error codes only.
- **IPs are hashed** (SHA-256 with the server secret) before they enter any
  rate-limit key or log. The raw IP is used in exactly one place — the
  `remoteip` field Turnstile's siteverify expects — and never stored.
- **Backend errors never reach the visitor.** A connector throwing produces a
  generic, safe message; the diagnostic text stays in the structured log.
- **Connector output is validated** against the protocol before it is sent, so
  a compromised or confused backend cannot inject markup or unsafe URLs.
- **The markdown renderer escapes everything** and emits an allowlisted tag
  set; `javascript:`, `data:` and friends are rejected at both ends.
- **Tokens use HMAC-SHA256 with a constant-time comparison** and a secret of
  at least 32 bytes, which `setup.sh` will generate.

---

## The dashboard: what is stored, and who can read it

With the dashboard on (the default for projects created by `murmur init`),
the Worker **does** store data: every conversation, every message both ways,
and leads — names, emails, phone numbers — in a D1 database on the site
owner's own Cloudflare account. Without a `MURMUR_DB` binding nothing is
written and everything above about "no lead data at rest" still holds.

- **Writes never touch the reply path.** Recording runs in `waitUntil` and
  swallows its own errors; a failing database cannot delay or break a visitor's
  chat.
- **No raw IPs.** A conversation keeps the page, referrer, UTM tags, locale and
  Cloudflare's two-letter country — never the address.
- **Sign-in** is email and password. Passwords are PBKDF2-SHA256 (100k
  iterations, the Workers maximum) hashed on the owner's machine by the CLI;
  the owner's hash is a Worker secret, teammates' hashes are in D1. A miss on
  an unknown email still runs a hash, so timing does not reveal which emails
  exist. Ten attempts per IP per 15 minutes.
- **Sessions** are a stateless HMAC-signed cookie (keyed from MURMUR_SECRET),
  `HttpOnly; Secure; SameSite=Strict; Path=/admin`, seven days. A removed
  teammate is refused on their next request, not when the cookie expires.
- **Mutations** (sign-in, summaries, lead edits) must come from the dashboard's
  own origin; every API response is `no-store` and `X-Frame-Options: DENY`.
- **CSV export** prefixes cells that start with `= + - @`, so a lead who types a
  formula cannot run it in the owner's spreadsheet.
- **AI summaries** only attach contact details that literally appear in the
  transcript — a model inventing an email cannot create a lead.

Rotating MURMUR_SECRET signs everyone out of the dashboard as well as ending
live chats.

## The owner's test header

`murmur chat` and `murmur users reset` send `X-Murmur-Owner: <hex SHA-256 of
"<MURMUR_SECRET>:owner-test">`. A request carrying the right value skips the
**per-IP** limits (sessions per hour, messages per minute, dashboard
sign-ins) — the ones that stop a single visitor hammering the site — so the
owner and their agent can test freely. It never skips the per-conversation
or daily caps, which bound cost. Deriving the value needs MURMUR_SECRET,
which never leaves `.env` and the Worker; a wrong value is ignored, not
rejected, so probing it tells an attacker nothing.

---

## If you want a stronger guarantee than "bounded cost"

The only way to genuinely restrict the API to known callers is to stop it
being a public endpoint:

- **Proxy through the site's own backend.** The Knowtific Next.js app exposes
  `/api/chat`, which holds a server-side secret and calls the Worker. The
  widget then talks to the same origin it is embedded on, and the Worker can
  require a real secret. This defeats scripted abuse properly — at the cost of
  the site owner running a proxy, which is against the project's "drop in one
  script tag" goal. Worth offering as an option in `docs/self-hosting.md`.
- **Signed embeds for logged-in users.** Where the host page already knows who
  the visitor is, it can pass a short-lived token minted by its own backend
  (the pattern Intercom calls identity verification). Strong, but only
  available for authenticated visitors.

For an anonymous public chat widget, Turnstile plus a hard daily quota is the
industry-standard answer, and it is what the server now implements.
