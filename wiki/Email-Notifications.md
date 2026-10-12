# Email notifications

An email when something needs you: a new contact, a hot lead, a callback
request, a visitor waiting for a person, a new job or booking. You bring the
email service you already use (Resend, Postmark, SendGrid, Brevo or any
other with a send API) and its key; HelpPuff writes each email and sends it
through that service. Everyone on the team chooses which emails they get.

No connector per provider: the service is one request you can see and
change, so a provider changing its API never waits for a HelpPuff release.

## 1. Connect your email service (an admin, once)

**Settings → Notifications** → **Email service**:

1. **Service**: Resend, Postmark, SendGrid or Brevo, or **Another service**.
2. **Send from**: an address on a domain you verified in that service.
3. **API key** (Postmark: the server token). Stored encrypted, never shown
   again.
4. **Send me a test**, then **Save**.

Or from the project folder:

```bash
helppuff secret set RESEND_API_KEY
helppuff email set --preset resend --from 'HelpPuff <assistant@yourdomain.com>' --key '${RESEND_API_KEY}'
helppuff email test --to you@yourdomain.com
```

`--preset` is `resend`, `postmark`, `sendgrid` or `brevo`. **Pause emails**
(`helppuff email pause`) stops every email until you resume; **Remove**
keeps everyone's choices for when you connect one again.

### Another service

Choose **Another service**, or **Edit the request** on a preset, and write the
request its "send an email" API wants: the method, the address, headers (put
the key in a secret one) and the body. HelpPuff fills in:

| Value | What it is |
| --- | --- |
| `{{email.to}}` | One person's address: each person gets their own email |
| `{{email.subject}}` | The subject, like `Callback requested: Ada` |
| `{{email.text}}` | The message as plain text, with a link to the dashboard |
| `{{email.html}}` | The same message as HTML, everything a visitor wrote escaped |

The request must use `{{email.to}}` and `{{email.text}}` (or
`{{email.html}}`). For example, a service that takes JSON with an `X-Api-Key`:

```bash
helppuff email set --url https://api.example-mail.com/v1/send \
  --header 'Content-Type: application/json' \
  --header 'X-Api-Key: ${MAIL_API_KEY}' \
  --body '{"from": "assistant@yourdomain.com", "to": "{{email.to}}", "subject": "{{email.subject}}", "text": "{{email.text}}"}'
```

Values are escaped for JSON in a JSON body, so nothing a visitor types can
break out of its field.

## 2. Choose your emails (everyone)

**Settings → Notifications** → **Email me when**, ticked for yourself only:

| Email | When |
| --- | --- |
| **New contact** | Someone left their name, email or phone in the chat |
| **Hot lead** | A chat ended and the AI rated the lead hot, with its summary and next step (five minutes after the chat went quiet) |
| **Callback request** | A visitor asked to be called back |
| **A visitor wants a person** | Someone asked for the team in [[live chat|Live-Chat]] |
| **A live chat nobody took** | Nobody took it in time; the visitor got the callback form |
| **A chat given to me** | Someone on the team gave you a conversation (only you get it) |
| **New job** | A [[job|Jobs]] was created |
| **New booking**, **Booking cancelled** | An [[appointment|Bookings]] was booked or cancelled |
| **A question to answer** | A visitor asked something your knowledge base does not cover ([[answer it|Knowledge-Base#5a-questions-to-answer]]; admins only) |
| **AI budget used up** | Today's AI budget ran out (admins only) |

Nothing is ticked until you choose. Members choose too: they see this page
even with live chat off. Someone removed from the team gets nothing more.
Each email links to the conversation, job, callbacks or calendar.

## Check it

**Send me a test** sends one now and says what the service answered. The
**Email service** card shows when the last email went and, if it failed,
why. A 401 or 403 is usually the key; a 403 or 422 about the sender means
its domain (or Postmark's sender signature) is not verified yet. Emails are
sent after the visitor's reply, never in its way, and HelpPuff's logs keep
only the kind of email and the status, never an address or what it said.

## Other channels

Slack, Microsoft Teams, SMS or your CRM want their own format: send any
event there with a [[webhook in your own format|Webhooks#your-own-request]],
or through n8n, Make or Zapier with the signed JSON ([[Webhooks]]). For
real-time alerts while you work, use the dashboard's notifications and sound,
or [[Telegram]].

Back to [[the dashboard|Dashboard]].
