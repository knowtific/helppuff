# Customer emails

[[Email notifications|Email-Notifications]] go to your team. These go to your
**customers**: three switches in **Settings → Customer emails**, each off
until you turn it on.

| Switch | What the customer gets | Needs |
| --- | --- | --- |
| [The team's replies](#the-teams-replies) | A reply from your team they would otherwise never see, with **Continue the chat** | An email service, live chat on |
| [Answers by email](#answers-by-email) | They reply to the email; it lands in the same conversation, waiting for the team | Live chat on, your domain on Cloudflare, set up once with the CLI or your AI agent |
| [A copy of the conversation](#a-copy-of-the-conversation) | When a chat ends: a short recap and the whole conversation | An email service |

They send through the email service in **Settings → Notifications** (Resend,
Postmark, SendGrid, Brevo, any send API, or Cloudflare Email Service), with
the business name from **Settings → Chat**.

## The story

9:40 pm. Sarah asks Acme Plumbing's assistant if someone can fix her leaking
hot water tank tomorrow, leaves her email in the form, and closes the tab.

7:15 am. Mike opens the conversation and replies "Yes, 10am, does that
work?". Sarah is not on the site, so two minutes later she gets:

> **Mike from Acme Plumbing replied**
> *You asked:* My hot water tank is leaking, can someone come tomorrow?
> *Mike:* Yes, I can be there at 10am. Does that work?
> **[Continue the chat]** · or just reply to this email

She replies "10am is perfect" from Gmail. It appears in the same
conversation; Mike is alerted as for any live chat and answers in the
dashboard; she gets that by email too. When the conversation goes quiet, she
gets a copy of it.

## The team's replies

**Email the team's replies when the customer has left.** When someone on the
team replies (the dashboard, [[Telegram]] or the API; never the assistant),
HelpPuff waits two minutes. If the customer is on the conversation by then,
they have seen it in the chat and nothing is sent. Otherwise they get one
email with every reply since the last one, what they asked, and **Continue
the chat**. A burst of replies is one email, and a quick correction lands
before it goes.

- Subject: "Mike from Acme Plumbing replied" ("Acme Plumbing replied" with
  **Show the team member's first name** off in Settings → Live chat).
- The reply box says who it reaches: *"Sarah isn't on the site: this reply
  will also be emailed to s…@gmail.com"*, with **Also email** to untick for
  one reply. Without an address: *"No email for this visitor: they'll see it
  only if they come back."*
- The wait is **Settings → Advanced → More limits → Wait before emailing a
  reply** (`security.limits.customerReplyDelaySeconds`, 0 to 3600; 0 sends
  each reply at once).
- Needs live chat on: the reply box is live chat's.

## Answers by email

**Customers can answer by email.** Every customer email's Reply-To is that
conversation's own address, `reply+<conversation>.<signature>@chat.acme.com`.
Their answer lands in the conversation as their message, and the
conversation becomes a **live chat waiting for the team**, whatever it was:

- the assistant had it, or it was closed: it is live and waiting, with
  whoever had it (if they are still on the team), else everyone available is
  alerted;
- someone had it live: it stays theirs, now waiting.

**The assistant never answers an email.** The team does, from the dashboard
or Telegram, and the customer gets that reply by email (even with the team's
replies switch off, when their last message came by email). Messages that
came by email have a small mail mark in the transcript. Each person can get
an email about it: **A customer answered by email** in Settings →
Notifications (to whoever has the chat, else everyone who chose it).

### Set it up

Cloudflare's mail servers receive the replies and hand them to your Worker
(Email Routing): no server to run, free on every plan. It needs your
domain's DNS on Cloudflare, in the same account as the Worker. It uses a
**subdomain** like `chat.acme.com`: turning Email Routing on for `acme.com`
itself would take over its mail and break a Google Workspace or Outlook
inbox there. `@acme.com` mail is never touched.

From your project folder:

```bash
npx @knowtific/helppuff email replies on chat.acme.com --enable
```

It finds the zone, refuses the domain itself and any name that already
receives mail elsewhere, turns Email Routing on for the subdomain (Cloudflare
adds and locks its MX and SPF records), adds one rule that hands
`reply@chat.acme.com` to your Worker, and sends a test email to the reply
address. When the test arrives, `--enable` turns answers by email on (or flip
the switch in the dashboard).

**One click it cannot do for you:** the `+` part of the address needs
**sub-addressing**, a setting of the zone with no API. When it is off, the
command stops and says so: Cloudflare dashboard → your domain → **Email** →
**Email Routing** → **Settings** → **Subaddressing**: on. Then
`helppuff email replies test --enable`.

Or ask your AI agent, in the project folder:

> Set up HelpPuff so customers can answer by email. Check my domain is on
> Cloudflare (helppuff email replies status), suggest a subdomain for
> replies, explain what it changes, run helppuff email replies on, send a
> test and tell me what happened.

Your email service's request must send the reply address: new requests from
a preset do; for an older one, **Add it for me** on the Customer emails page
adds `{{email.replyTo}}` in your service's own field (`reply_to`, `ReplyTo`,
`replyTo`). For **Another service**, put `{{email.replyTo}}` where it takes a
reply-to address yourself ([[the values|Email-Notifications#another-service]]).

`helppuff email replies status` checks each part, `helppuff doctor` checks the
rule still points at this Worker, and `helppuff email replies off` deletes the
rule (Email Routing stays on the subdomain; remove it in the Cloudflare
dashboard). `helppuff destroy` deletes the rule too.

### What arrives, and what does not

- Only the new part of an answer: the quoted email below it ("On … wrote:",
  Outlook's "From: … Sent: …", `>` lines) and a `-- ` signature are cut.
- Attachments are not kept yet: the message says how many there were, so
  the team can ask for them in the chat.
- Automatic mail (out-of-office, `Auto-Submitted`, bulk, bounces) is dropped
  and never answered: no loops.
- An answer from an address that is not the contact's (a forward, a
  colleague) is kept, marked "by email from <address>".
- A failed DMARC check, a reply address with a wrong signature, or a domain
  this Worker does not serve: refused.
- When the `+` part is lost, the email it answers (`In-Reply-To`, when the
  service told us its id) or the tag in its subject (`[#k3f9a2q]`) finds the
  conversation.

## A copy of the conversation

**Send a copy of the conversation.** When a chat goes quiet (five minutes
after the last message, as for [[conversation.completed|Webhooks]]), the
customer gets "Your conversation with Acme Plumbing": a recap written to
them ("You asked about…, we said…, next: …") and the whole conversation.

**The risk, plainly:** anyone can type someone else's email address into the
chat form. With this on, that person gets a copy of a conversation they
never had, including whatever was typed in it, sent from your email service.
Your sending reputation can suffer if it is misused. The limits below keep it
small, and every email has an unsubscribe link. It is off by default, last on
the page, and asks you to confirm once.

- Sent for conversations with at least two messages from the visitor, once
  (a conversation that continues later gets one more, at most once a day).
- **Email a copy** on a conversation sends one by hand, whether or not the
  switch is on.
- The recap is written by the summary, only when this is on. Without a
  summary (AI off, today's budget spent), the copy is the transcript alone.

## What every customer email has

- **Continue the chat**: a link to the page the conversation started on,
  which opens the chat with everything said so far. The link is signed for
  that one conversation and works for 30 days.
- **Unsubscribe**: a link (and `List-Unsubscribe`, one click in Gmail and
  Outlook; with answers by email, also a `mailto:`). An unsubscribed contact
  gets no copies or replies by email; the contact page says so, and an admin
  can **Allow again** (only if they asked you to).
- Your contact details from **Business details** (a copy), and Reply-To: the
  conversation's address with answers by email on, else your business email.
- **Sent to customers** on the page lists the last 20, with any error.

## Privacy

A customer gets only what they saw: their messages and the answers. Never
the team's summary, lead rating, labels, notes, attributes or what tools
returned. Anyone with a Continue the chat link sees that one conversation,
as anyone with the email could. Deleting a contact deletes their customer
email log too. See [[Security|Security#customer-emails]].

## Limits

Each is a setting (Settings → Advanced → More limits, `security.limits` in
helppuff.json):

| Limit | Default |
| --- | --- |
| `customerReplyDelaySeconds`: wait before emailing the team's replies | 120 |
| `customerEmailsPerContactPerDay`: emails one customer gets a day | 5 |
| `customerEmailsPerSitePerDay`: customer emails a day, the whole site | 200 |
| `inboundEmailsPerConversationPerDay`: answers by email one conversation takes a day | 20 |
| `inboundEmailsPerSitePerDay`: answers by email a day, the whole site | 200 |

## What it costs

| | Workers Free | Workers Paid |
| --- | --- | --- |
| Receiving answers (Email Routing) | Free, unlimited | Free, unlimited |
| Sending through Resend, Postmark, SendGrid, Brevo… | Their plan | Their plan |
| Sending with Cloudflare Email Service | Only to addresses verified in Cloudflare (your team), not customers | 3,000 a month included, then $0.35 per 1,000 |

So a Free-plan site sends with Resend (or any service) and still receives
with Cloudflare.

## In helppuff.json

```json
"customerEmails": {
  "copy": { "enabled": false },
  "replies": { "enabled": true },
  "inbound": { "enabled": true, "domain": "chat.acme.com", "ruleId": "…" }
}
```

`inbound.domain` and `ruleId` are written by `helppuff email replies on`;
`helppuff config pull` brings switches changed in the dashboard. See the
[[Configuration reference|Configuration-Reference]].

## Troubleshooting

- **The test email never arrives.** DNS can take a few minutes after Email
  Routing is turned on: run `helppuff email replies test` again. Check
  sub-addressing is on (above), and that your email service sends from a
  verified address (`helppuff email test --to you@…`).
- **A reply shows "from another address".** The customer answered from
  another address than the one they gave (a forward, a second account). It is
  kept; check before you share anything private.
- **Out-of-office replies do not show up.** They are dropped on purpose.
- **"Before you turn this on" stays.** Each ✗ says what is missing; the
  switch turns on once every one is ✓.

Back to [[Email notifications|Email-Notifications]] · [[Live chat|Live-Chat]].
