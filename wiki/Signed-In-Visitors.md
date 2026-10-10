# Signed-in visitors

If your website has accounts, the chat can know **for sure** who a logged-in
visitor is. Your server signs who is logged in; the assistant and your tools
then get their verified account as `{{user.*}}`.

**Why it matters.** Anything a visitor types is a claim: the pre-chat form,
or `HelpPuff.identify({ email })` called from the page (anyone can run it in
the browser's console). A tool that looks a customer up by a typed email
would show one customer's details to anyone who types their email. A signed
token is proof: only your server can make one.

## How it works

```text
Your server ──signs──▶ a token (JWT) ──the page──▶ HelpPuff.identify({ token }) ──▶ the Worker checks it
             { sub: "u_8812", email, plan }                                         {{user.id}}, {{user.plan}}
```

1. **Your secret.** Each site has one: dashboard → Settings → **Lead form** →
   **Signed-in visitors** → **Show secret**, or `helppuff identity`. Keep it
   on your server (for example as `HELPPUFF_IDENTITY_SECRET`); never put it
   in the page.
2. **Sign who is logged in**, on your server, for each page view: a JWT
   signed with HS256. `sub` is your user id; add any claims the assistant or
   tools should know (`email`, `name`, `plan`…). `exp` is required, at most a
   week ahead (an hour is typical).
3. **Pass it** on the page, next to the widget's script:

```js
HelpPuff.identify({ name: user.name, email: user.email, token: '<the token>' });
```

`name` and `email` still skip the pre-chat form as before; the token makes
them trusted.

## Signing the token

<!-- tabs -->

```js
// Node, with the jsonwebtoken package
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { sub: user.id, email: user.email, name: user.name, plan: user.plan },
  process.env.HELPPUFF_IDENTITY_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' },
);
```

```python
# Python, with PyJWT
import jwt, os, time

token = jwt.encode(
    {"sub": str(user.id), "email": user.email, "name": user.name, "plan": user.plan, "exp": int(time.time()) + 3600},
    os.environ["HELPPUFF_IDENTITY_SECRET"],
    algorithm="HS256",
)
```

```php
// PHP, with firebase/php-jwt
use Firebase\JWT\JWT;

$token = JWT::encode(
    ['sub' => (string) $user->id, 'email' => $user->email, 'name' => $user->name, 'exp' => time() + 3600],
    getenv('HELPPUFF_IDENTITY_SECRET'),
    'HS256'
);
```

<!-- /tabs -->

## What you get

When a chat starts with a valid token:

| Where | What |
| --- | --- |
| Tools | `{{user.id}}`, `{{user.email}}`, `{{user.plan}}`… in a URL, header or body |
| The prompt | `{{user.name}}`, `{{user.plan}}`… (quoted, like anything a visitor gives) |
| The lead | The token's `email`, `name` and `phone` win over what was typed |
| The conversation | **Signed in as …** in the dashboard; `user` in the API, in `conversation.completed` and after-chat tools |

**A tool that uses `{{user.*}}` runs only for a signed-in visitor.** Before
the chat it is skipped; during it the assistant is told the visitor must sign
in, and nothing is called. So `https://app.example.com/accounts/{{user.id}}`
is never called with an empty or made-up id.

A token that is forged, expired or signed with an old secret is ignored: the
chat works, without a signed-in user. The Worker logs it as
`identity.rejected`.

## From your own server

The [[API|API]] needs no token: the key is the proof. Pass the user when you
start a conversation:

```bash
curl https://<your worker>/api/v1/conversations \
  -H "Authorization: Bearer $HELPPUFF_KEY" -H 'Content-Type: application/json' \
  -d '{"message": "Why was I charged twice?", "user": {"id": "u_8812", "email": "ada@example.com", "plan": "pro"}}'
```

## Rotating the secret

**Rotate** on the dashboard (or `helppuff identity rotate`) makes a new
secret at once. Tokens signed with the old one stop working, so update your
server straight after. Visitors with an old token keep chatting, without a
signed-in user, until their next page view gets a new token.

## Rules for the token

- HS256 only. A token naming another algorithm (or `none`) is refused.
- `sub` is required (your user id, up to 200 characters).
- `exp` is required and at most a week after `iat` (or now).
- Up to 20 other claims, strings or numbers, 500 characters each. Nested
  objects are left out.

See it used: [[Logged-in customer support|Tutorial-Logged-In-Support]].
