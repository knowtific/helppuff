# Troubleshooting

Start with:

```bash
npx @knowtific/helppuff doctor
```

It checks the config, secrets, Cloudflare access, the Worker, the database,
the knowledge base and the widget, and prints a fix for each failing check.
`helppuff status` shows what is deployed and today's usage.

## The widget does not appear on my site

- **Is the script on the page?** View the page source and look for
  `loader.js`. Dashboard → Home → **Check my site** looks for you.
- **Is the page's origin allowed?** `origins` in `helppuff.json` must include the
  exact scheme and host, including `www.` if you use it. Add it and deploy.
- **Does the site have a Content Security Policy?** Allow the Worker in
  `script-src` and `connect-src` (and `img-src`, if the assistant has an
  avatar). Add `?hpdebug=1` to the page URL to see the widget's own log in the
  browser console.
- **Is it hidden on this page?** Check `widget.launcher.hideOnPaths`.

The widget never shows a broken state: if anything is wrong it simply does
not appear, so the browser console (with `?hpdebug=1`) is where to look.

## Visitors see "Chat is unavailable right now"

The daily message cap (`security.limits.messagesPerSitePerDay`) or the daily
AI budget is used up. Both reset at 00:00 UTC. Visitors still get your contact
details and the callback form. Raise the limits if the traffic is real; see
[[Costs and limits|Costs-and-Limits]].

## The assistant says it is not sure about something on my site

- Dashboard → Knowledge → **Test a question** shows what it would answer from.
  No passage? The page may not be learned: check its status under Website pages.
- A page shows **Blocked** (robots.txt), **Skipped** (no readable text: often a
  page drawn by JavaScript; it is rendered automatically when possible) or
  **Failed**: the reason is on the row.
- Add the answer yourself under **Your own answers**, or upload a file.
- If good passages are found but dropped, the reranker may be strict for that
  question; see `retrieval.minScore` in [[Workers AI|Provider-Workers-AI]].

## A file failed to learn

The reason is next to it. "No readable text" usually means a scanned PDF
(pictures of text); upload a text version. "The upload went missing" means it
was not read within a few minutes; upload it again.

## Deploy errors

| Error code | Meaning | Fix |
| --- | --- | --- |
| `settings_changed` | Settings were changed in the dashboard since this folder pulled them | `helppuff config pull`, check the diff, deploy |
| `prompt_behind`, `prompt_diverged` | The prompt was changed in the dashboard | `helppuff prompt pull` (your unpublished edits are kept in `prompt.mine.md`), then deploy |
| `missing_secret` | A key the config needs is not in `.env` | `helppuff secret set <NAME>` |
| `downgrade` | The Worker runs a newer release than this CLI | `npx @knowtific/helppuff@latest …`, or `--allow-downgrade` to roll back on purpose |
| `cli_outdated` | `upgrade` was run with an older CLI | `npx @knowtific/helppuff@latest upgrade` |
| `project_too_new` | `helppuff.json` was written by a newer CLI | use the newer CLI (`@latest`) |
| `no_admin_key`, `admin_unauthorized` | `ADMIN_API_KEY` is missing or does not match the Worker's | `helppuff deploy` sets it again |
| exit code `3` | Cloudflare refused the credentials | `npx wrangler login`, or check the token's permissions ([[Configuration|Configuration#cloudflare-access]]) |
| exit code `4` | A Cloudflare quota or limit | the message says which; often a free-plan daily limit |

Every error in `--json` mode has a stable `code` and a `hint` with the command
to run next.

## I cannot sign in to the dashboard

```bash
npx @knowtific/helppuff dashboard        # a one-time sign-in link (15 minutes)
helppuff users reset you@example.com     # a new password
```

Before anyone has an account, `helppuff dashboard` prints the setup link again.

## Replies are slow

`helppuff ask "<question>" --timing` prints each step's time. On Workers AI the
model and the reranker take most of it. Turning the reranker off (Settings →
Advanced → "Double-check answers") saves about half a second, at some cost in
accuracy.

## Webhooks are not arriving

Settings → Webhooks → **Recent deliveries** shows each delivery's status and
error; **Send test** sends one now. Endpoints must be `https://` and answer
within 8 seconds with a 2xx. See [[Webhooks]].

## Still stuck

Open an issue with the output of `helppuff doctor --json` (it contains no
secrets) and what you expected to happen.
