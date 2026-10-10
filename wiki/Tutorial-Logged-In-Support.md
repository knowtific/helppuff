# Tutorial: logged-in customer support

A software company's billing assistant, for customers signed in to the app.
It knows who they are without asking, has their plan and invoices before the
first answer, and sends refund requests to the billing team.

```text
[Signed in as Ada · Pro plan]
Visitor    Why was I charged twice this month?
Assistant  I can see two charges of $49.00: invoice INV-2041 on 1 October (your Pro
           renewal) and INV-2042 on 1 October too, which looks like a duplicate. Shall I
           ask the billing team to refund INV-2042?
Visitor    Yes please
Assistant  Done: the request is R-3317. The billing team usually replies within two
           business days, by email to ada@example.com.
```

**What it teaches:** [[signed-in visitors|Signed-In-Visitors]], tools that
use the verified `{{user.id}}`, and a request your team decides on rather
than an action the assistant takes.

**Template:** `logged-in-support` ([[import it|Tutorials#use-a-template]]).
**You need:** sign-in on your site, and two endpoints in your app (step 2).

## How it works

```text
Your page ─token─▶ chat starts ─▶ account (before, by {{user.id}}) ─▶ first answer knows the plan and invoices
                                  request_refund (during) ─▶ your billing team's queue
```

Both tools use `{{user.id}}`, so they run **only for a verified visitor**.
Without a valid token, `account` is skipped, and the prompt tells the
assistant to ask the visitor to sign in, never to look someone up by an
email they typed.

## 1. Sign the visitor in

Follow [[Signed-in visitors|Signed-In-Visitors]]: show the secret, sign
`{ sub: user.id, email, name }` on your server, and on every page of the app:

```js
HelpPuff.identify({ name: user.name, email: user.email, token });
```

## 2. Your endpoints

`GET /api/helppuff/accounts/:id` returns what the assistant may tell the
customer about their own account:

```json
{
  "plan": "Pro",
  "status": "active",
  "renews_at": "2026-11-01",
  "invoices": [
    { "id": "INV-2042", "date": "2026-10-01", "amount": "$49.00", "description": "Pro, monthly", "status": "paid" },
    { "id": "INV-2041", "date": "2026-10-01", "amount": "$49.00", "description": "Pro, monthly", "status": "paid" }
  ]
}
```

Send amounts already formatted, with the currency: the assistant repeats them
as they are. Leave out what it must never say (card numbers, internal notes).

`POST /api/helppuff/refund-requests` with `{ user, invoice, reason, conversation }`
puts a request in front of your billing team and answers
`{ "requested": true, "reference": "R-3317" }`. Check on your side that the
invoice belongs to `user`: the assistant is honest, but your API is the
guard.

## 3. The tools

```bash
helppuff tools add account --before \
  --url 'https://app.example.com/api/helppuff/accounts/{{user.id}}' \
  --header 'Authorization: Bearer ${APP_API_KEY}' \
  --pick plan,status,renews_at,invoices \
  --description 'The signed-in customer’s plan, status, renewal date and recent invoices.'

helppuff tools add request_refund --method POST \
  --url https://app.example.com/api/helppuff/refund-requests \
  --header 'Authorization: Bearer ${APP_API_KEY}' \
  --body '{"user": "{{user.id}}", "invoice": "{{args.invoice_id}}", "reason": "{{args.reason}}", "conversation": "{{conversation.id}}"}' \
  --param invoice_id='The id of the invoice to refund, from the account’s invoices.' \
  --param reason='Why, in a few words (e.g. charged twice).' \
  --description 'Ask the billing team to refund an invoice. Only after the customer agreed. Returns a reference.'
```

`{{user.id}}` is filled from the token, never from what the assistant or
the visitor says. The refund request includes `{{conversation.id}}` so your
team can open the chat from the request.

## 4. The prompt

```text
## Billing and account questions
The visitor is signed in as {{user.name}}. Their plan: {{account.plan}} ({{account.status}}), renewing on {{account.renews_at}}. Their recent invoices: {{account.invoices}}

- Answer questions about their plan, invoices and renewal from the account above. Give amounts and dates exactly as shown.
- "I was charged twice", or a charge they don't recognise: find the invoices in question and say what each one was for. If two look like duplicates, say so and offer to ask the billing team for a refund. When they say yes, send it with {{request_refund}} and give them the reference.
- Never promise a refund: the billing team decides, usually within two business days.
- If their account is "(not known yet)", they are not signed in: ask them to sign in to their account on the website and open the chat again. Never ask for an account number or an email address to look them up.
```

- **The account is in the prompt from the first answer**: no "let me check"
  for the common questions.
- **"Offer, then wait for yes"** before `request_refund`, and **"never promise"**:
  the assistant asks; people decide.
- **The last line closes the gap** a typed email would open.

## Try it

From your own server, the API takes the user directly, which is the quickest
test:

```bash
curl https://<your worker>/api/v1/conversations -H "Authorization: Bearer $HELPPUFF_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"message": "Why was I charged twice?", "user": {"id": "u_8812", "name": "Ada", "email": "ada@example.com"}}'
```

Then sign in on your app and open the chat. The conversation in the dashboard
says **Signed in as ada@example.com**.

Next: [[Testing and monitoring|Testing-And-Monitoring]], to keep a setup
like this working as you change it.
