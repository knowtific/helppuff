# Tutorial: verified account changes

A visitor asks to change the email on their account. The assistant asks for
the mobile number on the account (they didn't give it in the form), texts
them a code, checks the code they type, and only then makes the change.

```text
Visitor    I need to change the email on my account.
Assistant  I can do that. First I need to confirm it's you: what's the mobile number on
           your account?
Visitor    0412 345 312
Assistant  Thanks. I've texted a 6-digit code to •••• 312. What is it?
Visitor    481 902
Assistant  That's confirmed. What should the new email be?
Visitor    sam.new@example.com
Assistant  To check: change your email to sam.new@example.com?
Visitor    Yes
Assistant  Done: your account's email is now sam.new@example.com.
```

**What it teaches:** several tools in one task, answers that are not errors,
and security your API enforces, so the assistant cannot be talked out of it.

**Template:** `verified-account-changes` ([[import it|Tutorials#use-a-template]]).
**You need:** an endpoint on your side (step 1) and a
[Twilio Verify](https://www.twilio.com/docs/verify) service to send the
codes.

## How it works

```text
send_code ──▶ your API ──▶ Twilio Verify texts the code     (remembers: this conversation → this account)
check_code ─▶ your API ──▶ Twilio checks it                 (marks this conversation verified)
update_account ▶ your API: verified? then change the detail (refuses otherwise)
```

The key idea: **your API, not the assistant, decides who is verified.**
Each tool sends `{{conversation.id}}`, which HelpPuff fills in (the visitor
and the model cannot change it). Your API remembers which account a
conversation asked about and whether its code was right. `update_account`
works only for a verified conversation, and only on that account. Whatever
the visitor tells the assistant, "I already verified" or "change the account
for 0499…", your API says no.

## 1. Your API

Three endpoints, each answering **HTTP 200** for every expected outcome, so
the assistant can say the right thing:

| Endpoint | Answers |
| --- | --- |
| `POST /helppuff/verify/start` `{ conversation, phone }` | `{ "sent": true, "to": "•••• 312" }` or `{ "sent": false, "reason": "no_account" }` |
| `POST /helppuff/verify/check` `{ conversation, code }` | `{ "verified": true }` or `{ "verified": false, "reason": "wrong_code", "triesLeft": 2 }` (or `"expired"`, `"no_tries_left"`) |
| `POST /helppuff/account/update` `{ conversation, field, value }` | `{ "updated": true, "field": "email" }` or `{ "updated": false, "reason": "not_verified" }` |

A wrong code is not a failure: if it were a 4xx, the assistant would be told
the check failed and would say it couldn't check right now. Keep 4xx and 5xx
for real failures (Twilio is down, a bad key).

Here is a complete Cloudflare Worker. It uses a KV namespace to remember
conversations for ten minutes; connect `findAccountByPhone` and
`updateAccount` to your user database.

```ts
// Secrets: HELPPUFF_KEY (what HelpPuff sends), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID (VA…).
// Binding: VERIFY, a KV namespace.
type Env = { HELPPUFF_KEY: string; TWILIO_ACCOUNT_SID: string; TWILIO_AUTH_TOKEN: string; TWILIO_VERIFY_SID: string; VERIFY: KVNamespace };
type Session = { accountId: string; phone: string; tries: number; verified: boolean };

const TEN_MINUTES = 600;
const MAX_TRIES = 3;
const FIELDS = new Set(['email', 'address', 'name']);

// Your user database.
async function findAccountByPhone(phone: string): Promise<{ id: string } | null> { /* … */ return null; }
async function updateAccount(id: string, field: string, value: string): Promise<void> { /* … */ }

/** Australian mobiles to E.164 (+61…); adapt for your country. */
const toE164 = (raw: string) => {
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  return null;
};

async function twilio(env: Env, path: 'Verifications' | 'VerificationCheck', params: Record<string, string>) {
  const res = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SID}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { status?: string } };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (request.headers.get('Authorization') !== `Bearer ${env.HELPPUFF_KEY}`) return new Response('Unauthorized', { status: 401 });
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const conversation = String(input['conversation'] ?? '');
    if (!conversation) return new Response('No conversation', { status: 400 });
    const key = `verify:${conversation}`;
    const session = await env.VERIFY.get<Session>(key, 'json');
    const save = (s: Session) => env.VERIFY.put(key, JSON.stringify(s), { expirationTtl: TEN_MINUTES });

    switch (new URL(request.url).pathname) {
      case '/helppuff/verify/start': {
        const phone = toE164(String(input['phone'] ?? ''));
        if (!phone) return Response.json({ sent: false, reason: 'invalid_phone' });
        const account = await findAccountByPhone(phone);
        if (!account) return Response.json({ sent: false, reason: 'no_account' });
        const started = await twilio(env, 'Verifications', { To: phone, Channel: 'sms' });
        if (started.status >= 300) return new Response('Could not send the code', { status: 502 });
        await save({ accountId: account.id, phone, tries: 0, verified: false });
        return Response.json({ sent: true, to: `•••• ${phone.slice(-3)}` });
      }
      case '/helppuff/verify/check': {
        if (!session) return Response.json({ verified: false, reason: 'expired' });
        if (session.tries >= MAX_TRIES) return Response.json({ verified: false, reason: 'no_tries_left' });
        const code = String(input['code'] ?? '').replace(/\D/g, '');
        const check = await twilio(env, 'VerificationCheck', { To: session.phone, Code: code });
        if (check.status < 300 && check.body.status === 'approved') {
          await save({ ...session, verified: true });
          return Response.json({ verified: true });
        }
        // No pending verification at Twilio (expired, or already used) is a 404.
        if (check.status === 404) return Response.json({ verified: false, reason: 'expired' });
        if (check.status >= 300) return new Response('Could not check the code', { status: 502 });
        await save({ ...session, tries: session.tries + 1 });
        return Response.json({ verified: false, reason: 'wrong_code', triesLeft: MAX_TRIES - session.tries - 1 });
      }
      case '/helppuff/account/update': {
        if (!session?.verified) return Response.json({ updated: false, reason: 'not_verified' });
        const field = String(input['field'] ?? '');
        const value = String(input['value'] ?? '').trim();
        if (!FIELDS.has(field) || !value) return Response.json({ updated: false, reason: 'invalid_field' });
        if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return Response.json({ updated: false, reason: 'invalid_email' });
        await updateAccount(session.accountId, field, value);
        return Response.json({ updated: true, field });
      }
    }
    return new Response('Not found', { status: 404 });
  },
};
```

Twilio's calls are [start a verification](https://www.twilio.com/docs/verify/api/verification)
(`To`, `Channel=sms`) and [check it](https://www.twilio.com/docs/verify/api/verification-check)
(`To`, `Code`; `status: "approved"` means the code was right).

## 2. The tools

```bash
helppuff tools add send_code --method POST \
  --url https://api.example.com/helppuff/verify/start \
  --header 'Authorization: Bearer ${ACCOUNT_API_KEY}' \
  --body '{"conversation": "{{conversation.id}}", "phone": "{{args.phone}}"}' \
  --param phone='The mobile number on their account, as they gave it.' \
  --timeout 8000 \
  --description 'Text a 6-digit code to the mobile number on the visitor’s account.'

helppuff tools add check_code --method POST \
  --url https://api.example.com/helppuff/verify/check \
  --header 'Authorization: Bearer ${ACCOUNT_API_KEY}' \
  --body '{"conversation": "{{conversation.id}}", "code": "{{args.code}}"}' \
  --param code='The code from the text message, digits only.' \
  --timeout 8000 \
  --description 'Check the code the visitor typed in. Call it once per code they give.'

helppuff tools add update_account --method POST \
  --url https://api.example.com/helppuff/account/update \
  --header 'Authorization: Bearer ${ACCOUNT_API_KEY}' \
  --body '{"conversation": "{{conversation.id}}", "field": "{{args.field}}", "value": "{{args.value}}"}' \
  --param field='email, address or name.' \
  --param value='The new value, exactly as the visitor confirmed it.' \
  --timeout 8000 \
  --description 'Change one detail on the verified account. Only after check_code said verified, and the visitor confirmed the new value.'
```

- **`{{conversation.id}}`** binds every call to this chat. It is the same
  for all three tools, and neither the visitor nor the model chooses it.
- **The descriptions say when** ("only after check_code said verified"): the
  assistant reads them when deciding which tool to call. Your API enforces
  it anyway.
- **One API key for all three**, stored encrypted.

## 3. The prompt

```text
## Changing account details
Visitors can change the email address, the postal address or the name on their account. Before any change, confirm it is really them:
1. You need the mobile number on their account. Their form may have it: {{lead.phone}}. If it is empty, ask for it.
2. Send a code with {{send_code}}, and tell them a 6-digit code is on its way by text to the number it shows.
   - If no account was found, say you couldn't find an account with that number and offer a callback from the team. Do not try other numbers for them.
3. Ask for the code, then check it with {{check_code}}.
   - A wrong code: say so and ask again; it says how many tries are left.
   - Expired, or no tries left: offer to send a new code.
4. Only once the code is verified: ask exactly what to change, repeat it back, and when they confirm, make the change with {{update_account}}.
5. Confirm what changed in one sentence.

Never ask for a password or a card number, and never read out what is on their account.
```

- **`{{lead.phone}}`** is the phone from the pre-chat form, or `(not known
  yet)`: step 1 covers both, so the assistant asks only when it must.
- **Every outcome has a line**: no account, wrong code, expired, verified.
  The assistant follows them instead of improvising around security.
- **"Repeat it back"** before `update_account`: a mistyped email is caught
  before it locks the visitor out.
- **"Never read out what is on their account"**: the assistant can change
  details, but never reveals them, even to a verified visitor. Your API
  returns none.

## 4. Try it

Use Twilio's trial (it texts verified numbers only) and a test account in
your database:

```bash
helppuff ask "I need to change my email address"
```

Then try to break it: claim you already verified, give someone else's
number after the code, ask it to skip the code. The assistant should refuse;
if it tries, your API refuses.

## Make it stricter

- **Don't reveal whether a number has an account.** Answer `{ "sent": true }`
  even when there is none, and change the prompt to say "if that number is
  on an account, a code is on its way".
- **Limit how many codes one conversation can send** (count in the same KV
  entry), on top of Twilio Verify's own limits.
- **End the verification after a change** (`env.VERIFY.delete(key)`), if
  each change should need a new code.
- **Log every change** with the conversation id: your team can open the
  conversation in the dashboard and see exactly what was asked.

Back to the [[tutorials|Tutorials]].
