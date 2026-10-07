# Turn on Turnstile

[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) is a free
check that tells a person from a script, usually without the visitor noticing.
HelpPuff uses it in two places once it is on:

- **every new chat**, so a script cannot start chats and use up your daily cap;
- **the dashboard's sign-in**, so a script cannot keep trying passwords.

It is **off by default**, so you can try HelpPuff (and an AI agent can set it
up) without it. Turn it on before real visitors arrive: until then, only the
[[rate limits|Security#every-limit]] slow a script down. The dashboard's Home
page shows **Before you go live** until it is on, and `helppuff doctor` warns.

It takes about five minutes, and one part has to be done by you in the
Cloudflare dashboard: HelpPuff and AI agents work through `wrangler login`,
whose permissions do not include Turnstile (that is true for everyone, not
something about your account).

## 1. Create the widget (you, in Cloudflare)

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/), choose your
   account, and open **Turnstile** (search for it if you do not see it in the
   sidebar). Select **Add widget**.
2. **Widget name**: anything, for example `HelpPuff`.
3. **Hostnames**: every hostname the chat is on, and the dashboard's. The
   dashboard's Home page lists them under **Before you go live**, ready to
   copy. Typically:
   - your site, with and without `www` (`example.com`, `www.example.com`);
   - the Worker, which serves the dashboard and the preview page
     (`knowtific-helppuff-<site>.<you>.workers.dev`, or your custom domain).

   A widget takes up to 10 hostnames.
4. **Widget mode**: **Managed** (recommended): most people see nothing or a
   single tick; only suspicious traffic is asked to click. **Invisible** never
   shows anything, at the cost of letting a little more through.
5. **Pre-clearance**: leave it off.
6. Create it, then copy the **Site Key** and the **Secret Key**.

## 2. Tell HelpPuff (you or your agent)

In the project folder, with the two keys from step 1:

```bash
helppuff config set security.captcha '{"provider":"turnstile","siteKey":"<Site Key>","secret":{"env":"TURNSTILE_SECRET"}}'
helppuff secret set TURNSTILE_SECRET   # paste the Secret Key when asked
helppuff deploy
```

Or edit `helppuff.json` by hand:

```json
"security": {
  "captcha": { "provider": "turnstile", "siteKey": "<Site Key>", "secret": { "env": "TURNSTILE_SECRET" } }
}
```

The Site Key is public (the widget shows it to browsers). The Secret Key is
never written into `helppuff.json`: `secret set` keeps it in `.env` and as a
Worker secret. An AI agent can do this step: give it the Site Key, and paste
the Secret Key into `helppuff secret set` yourself.

## 3. Check it

- `helppuff doctor` shows **turnstile: pass**, and the dashboard's Home page
  shows **Turnstile is on**.
- Open your site (or the preview page from `helppuff deploy`) and start a chat:
  it works as before.
- Sign out of the dashboard and back in: the sign-in form now shows the
  Turnstile check.

From now on scripted chats are refused, including `helppuff chat` and
`helppuff ask` (they answer `captcha_failed`). Test in the preview page, or on
your site.

## Options

- **Sign-in without Turnstile**: Settings → Advanced → *Turnstile on the
  sign-in form*, or `security.signIn.captcha: false`. New chats are still
  checked.
- **Trying the flow locally**: Cloudflare's [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
  always pass: Site Key `1x00000000000000000000AA` with Secret Key
  `1x0000000000000000000000000000000AA`. Never use them on a public site.
- **Turning it off**: remove `captcha` from `security` in `helppuff.json` and
  deploy.

## If something goes wrong

| What you see | Why, and what to do |
| --- | --- |
| Every new chat fails with "We could not verify that you are human" | The page's hostname is not on the widget. Add it in Cloudflare (step 1.3); it applies within a minute |
| The dashboard sign-in says "Turnstile did not load" | Something blocks `challenges.cloudflare.com` (an ad blocker, a network filter). Allow it, or sign in with a one-time link |
| Locked out of the dashboard | `npx @knowtific/helppuff dashboard` in the project folder makes a one-time sign-in link, which does not need Turnstile |
| `helppuff chat` answers `captcha_failed` | Expected once Turnstile is on: scripts are what it stops. Test in the preview page |

See [[Security]] for what Turnstile does and does not stop.
