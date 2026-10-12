# Email notifications

HelpPuff has no mail server of its own: you bring the email service you
already use (Resend, Postmark, SendGrid, Mailgun, Brevo, Amazon SES…), with
its API key, and HelpPuff calls it. Nothing to install and no per-provider
connector: the same pattern works for any service with a REST API.

Pick by what you want to hear about:

| You want | Use | How fast |
| --- | --- | --- |
| An email for each new lead, or only hot leads, with the AI's summary | [An after-chat tool](#1-an-email-when-a-chat-ends) that calls your email service | Five quiet minutes after the chat |
| An email the moment a visitor asks for a callback, a person, or books a time | [A webhook to n8n, Make or Zapier](#2-an-email-for-any-event) | Right away |
| To answer live chats as they arrive | The dashboard's notifications and sound, or [[Telegram]] ([[Live chat|Live-Chat]]) | Right away |

## 1. An email when a chat ends

An [[after-chat tool|Tools#3-after-the-chat]] runs when a conversation goes
quiet (or a live chat closes), with the contact, the summary, the labels and
the transcript. Point it at your email service's send API.

### With Resend

1. In [Resend](https://resend.com), verify your domain and make an API key.
2. Add the tool:

```bash
helppuff secret set RESEND_API_KEY        # or put it in .env
helppuff tools add email_new_lead --after --method POST \
  --url https://api.resend.com/emails \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer ${RESEND_API_KEY}' \
  --body '{"from": "HelpPuff <assistant@yourdomain.com>", "to": ["sales@yourdomain.com"], "subject": "New lead: {{lead.name}}", "text": "{{lead.name}} ({{lead.email}} · {{lead.phone}})\n\n{{summary}}\n\nNext: {{conversation.followUp}}\n\nhttps://YOUR-WORKER/admin/#/conversations/{{conversation.id}}"}' \
  --when lead.email \
  --description 'Email the team about a chat that left an email.'
```

Replace `YOUR-WORKER` with your dashboard's address, so the email links to
the conversation.

### With Postmark

The same tool, with Postmark's address, header and field names:

```bash
helppuff secret set POSTMARK_SERVER_TOKEN
helppuff tools add email_new_lead --after --method POST \
  --url https://api.postmarkapp.com/email \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'X-Postmark-Server-Token: ${POSTMARK_SERVER_TOKEN}' \
  --body '{"From": "assistant@yourdomain.com", "To": "sales@yourdomain.com", "Subject": "New lead: {{lead.name}}", "TextBody": "{{lead.name}} ({{lead.email}} · {{lead.phone}})\n\n{{summary}}\n\nNext: {{conversation.followUp}}"}' \
  --when lead.email \
  --description 'Email the team about a chat that left an email.'
```

`From` must be a confirmed sender signature in Postmark.

### Any other service

Look up its "send an email" API and fill in the same four things: the
address, the header with the key (`${NAME}`, stored encrypted), the body in
its field names, and **Only when**. On the dashboard it is **Prompt & tools**
→ **After the chat** → **+ Add** → **New tool**.

- **Which chats:** `--when lead.email` (any chat that left an email),
  `--when labels.leadQuality=hot` (hot leads only), `hot,warm`, or none (every
  chat). On the dashboard: **Only when**.
- **What you can put in it:** `{{lead.name}}`, `{{lead.email}}`,
  `{{lead.phone}}`, `{{summary}}`, `{{conversation.followUp}}`,
  `{{conversation.labels.leadQuality}}`, `{{conversation.id}}`, any
  `{{attributes.*}}`, and everything else `conversation.completed` carries
  (see [[Webhooks]]).
- **Send text, not HTML.** Values are escaped for JSON, not for HTML, and a
  visitor writes part of them: use the service's plain-text field (`text`,
  `TextBody`) so nothing a visitor types can become a link or markup.
- **Several people:** most services take a list in `to`.

### Check it

Have a chat that leaves an email, then wait five minutes. The conversation's
**Data from tools** in the dashboard shows the email service's answer under
the tool's name, and `helppuff tools list` shows the last status. A 401 or
403 is the key; a 422 (Postmark) or 403 (Resend) about the sender means the
domain or sender is not verified yet.

## 2. An email for any event

[[Webhooks]] send every event the moment it happens, as signed JSON:
`callback.requested`, `handover.requested` (a visitor wants a person),
`handover.missed`, `lead.captured`, `appointment.created`, `job.created` and
the rest. Their body is always the same, so a small workflow in front of
your email turns it into the message you want, for any provider:

1. In [n8n](https://n8n.io), [Make](https://www.make.com) or
   [Zapier](https://zapier.com), start a workflow with a webhook trigger and
   copy its address.
2. In HelpPuff, **Settings → Webhooks** → add that address, and tick the
   events you want (or `helppuff webhooks add <url> --events callback.requested,handover.requested`).
3. Add an email step (n8n's **Send Email** or Gmail node, or your provider's)
   and write the message from the event's fields, like `data.name`,
   `data.phone` and `data.message` for a callback.
4. **Send test** in HelpPuff checks the address (a `test.ping`). To build
   the email from real fields, make the event happen once (ask for a callback
   in the [playground](https://knowtific.github.io/helppuff/playground/) or your
   preview page), or use the example bodies in [[Webhooks]].

To be sure a call came from your Worker, check its `X-HelpPuff-Signature`
([[checking a delivery|Webhooks#checking-a-delivery-came-from-us]]). n8n can run on your own server,
so nothing leaves your hands.

Back to [[Leads and callbacks|Leads]] or the [[dashboard|Dashboard]].
