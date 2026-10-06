# Leads and callbacks

A **lead** is a person who left their details. Murmur turns conversations
into leads in three ways, keeps them in the dashboard, and can send them
anywhere else.

## Where leads come from

1. **The lead form** before the chat (on by default): name, email, an optional
   phone, and their question, which becomes their first message. Add your own
   fields (suburb, company, budget…) in **Settings → Lead form**, and mark which
   are required. Every answer is kept on the lead **and given to the
   assistant**, so it knows who it is talking to and never asks again.
2. **Typed in the chat:** an email address or phone number a visitor writes.
3. **The assistant:** when a visitor asks for a person, a quote or a booking,
   or it cannot help, it offers a **callback**. It reuses the details it already
   has and shows a short form only for what is missing (a phone or an email).
   The lead is marked as a callback request.

A dashboard **summary** of a conversation can also add contact details, but
only ones that literally appear in the transcript; a model cannot invent a lead.

## One lead per person

Leads are keyed by **email** (in any case). A visitor who comes back, or gives
their email in a second chat, gets the new chat added to the lead they already
have; new details only fill gaps, never overwrite. A lead with only a phone
number is merged into the person as soon as their email turns up.

## In the dashboard

**Leads** lists people by when they were last active, with:

- **Status**: new → contacted → qualified → won / lost (changed inline).
- **Notes**, and their form answers.
- **Chats**: how many, with a link to the latest transcript.
- **Export CSV** for a spreadsheet or CRM. Cells that start with `=`, `+`, `-`
  or `@` are escaped, so a lead cannot plant a formula in your spreadsheet.

## Callbacks

A visitor asking to be called back is a task, not just a lead. Each request
becomes a **callback** (the assistant requested it with the details it had,
or the visitor sent the callback form) with how to reach them, why, and the
conversation it came from.

- **Callbacks** in the dashboard lists the waiting ones, oldest first, with
  the count on the menu. **Done** (with a note of what happened, e.g. "Booked
  a measure for Tuesday") or **Dismiss** closes one; **Reopen** brings it back.
- The contact (Leads) and the conversation (Conversations, and its
  **Callback waiting** filter) are labelled **Callback requested** while one
  waits.
- A conversation has at most one waiting request: asking again updates it.
  A request after one was closed is a new task. A person can have several
  over time, from different chats.
- Webhooks: `callback.requested` when one is made, `callback.updated` when it
  is closed, reopened or its note changes.
- In the terminal: `murmur callbacks` lists them; `murmur callbacks done <id>
  --note "…"` closes one.

## Sending leads elsewhere

- **[[Webhooks]]** (Settings → Webhooks): every event as signed JSON, including
  `lead.captured`, `callback.requested` and `lead.updated`. The way to connect
  Zapier, Make, n8n, a CRM or Slack.
- **`leads.webhook`** in `murmur.json`: a simpler, older option that POSTs each
  lead to one URL:

  ```json
  "leads": { "webhook": "https://hooks.zapier.com/hooks/catch/123/abc" }
  ```

Because one person can produce several `lead.captured` events (the form, then
a phone number typed later), update the contact by email in your CRM rather
than always creating a new one.

## The form, in `murmur.json`

```json
"widget": {
  "leadForm": {
    "enabled": true,
    "title": "Before we start",
    "fields": [
      { "name": "name", "label": "Name", "type": "text", "required": true },
      { "name": "email", "label": "Email", "type": "email", "required": true },
      { "name": "phone", "label": "Phone (optional)", "type": "tel" },
      { "name": "service", "label": "What do you need?", "type": "select", "options": ["Hot water", "Drains", "Other"] },
      { "name": "message", "label": "How can we help?", "type": "textarea", "required": true }
    ],
    "privacy": { "text": "We only use this to reply to you.", "url": "https://acme.com.au/privacy" }
  }
}
```

`name`, `email`, `phone` and `message` mean something to the assistant (a
`message` field opens the chat); any other field is kept as is. Set
`"enabled": false` to let visitors chat straight away; the assistant then asks
for details only when arranging a callback.

## Privacy

Leads and transcripts are stored in the D1 database on **your** Cloudflare
account, nowhere else. Murmur stores no IP addresses (only the country), and
its logs never contain message text or contact details. To delete everything:
`murmur destroy --yes`.
