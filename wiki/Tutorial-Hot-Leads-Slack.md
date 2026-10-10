# Tutorial: hot leads to Slack

When a chat ends and the AI rated the lead **hot**, a message lands in your
sales channel with the contact, the summary and what to do next. Warm and
cold chats stay quiet.

```text
#sales
🔥 Hot lead: Ada Lovelace (ada@example.com · 0400 111 222)
Ada wants a kitchen renovation in Brunswick, budget $40–50k, starting after Christmas.
Next: call this week to book the free measure.
```

**What it teaches:** an after-chat tool with a condition (**Only when**),
and the AI's labels on every finished conversation.

**Template:** `hot-leads-slack` ([[import it|Tutorials#use-a-template]]). It
adds one tool; your prompt and other tools stay as they are.
**You need:** a Slack app with a bot token.

## How it works

Five quiet minutes after the last message, HelpPuff summarises the
conversation and labels it: `intent`, `sentiment`, `outcome`, `topics`, and
**`leadQuality`**: `hot` (ready to buy or book), `warm` (interested), `cold`
(just browsing) or `none`. Then the after-chat tools run, with all of it.

A tool's **Only when** decides whether it runs at all. This one runs only
when `labels.leadQuality` is `hot`.

## 1. A Slack bot token

1. At [api.slack.com/apps](https://api.slack.com/apps), **Create New App**
   → From scratch, in your workspace.
2. **OAuth & Permissions** → Bot Token Scopes: add `chat:write`.
3. **Install to Workspace**, then copy the **Bot User OAuth Token**
   (`xoxb-…`).
4. In Slack, invite the bot to the channel: `/invite @YourApp` in `#sales`.

## 2. The tool

```bash
helppuff secret set SLACK_BOT_TOKEN      # or put it in .env
helppuff tools add slack_hot_lead --after --method POST \
  --url https://slack.com/api/chat.postMessage \
  --header 'Content-Type: application/json; charset=utf-8' \
  --header 'Authorization: Bearer ${SLACK_BOT_TOKEN}' \
  --body '{"channel": "#sales", "text": ":fire: *Hot lead: {{lead.name}}* ({{lead.email}} · {{lead.phone}})\n{{summary}}\n*Next:* {{conversation.followUp}}"}' \
  --when labels.leadQuality=hot \
  --description 'Post a hot lead to the sales channel.'
```

On the dashboard: **Prompt & tools** → **After the chat** → **+ Add** →
**New tool**, then **Only when** → **Hot leads only**.

- `--when labels.leadQuality=hot,warm` sends warm leads too;
  `--when lead.email` sends every chat that left an email.
- [`chat.postMessage`](https://api.slack.com/methods/chat.postMessage) takes
  Slack's own formatting in `text` (`*bold*`, `<https://…|a link>`).
- The bot token is stored encrypted, like any secret header.

## 3. Check it

Have a chat that would be hot ("I'd like to book a measure next week, here's
my number"), then wait five minutes. The conversation in the dashboard shows
the labels, and **Data from tools** shows Slack's answer under
`slack_hot_lead`.

Slack answers HTTP 200 even when it refuses, with `"ok": false` and a reason
in the answer: `not_in_channel` means the bot was not invited,
`invalid_auth` a wrong token.

## Without a Slack app

An [incoming webhook](https://api.slack.com/messaging/webhooks) works too: set
the tool's address to the webhook URL and drop the `channel` and the
`Authorization` header. The URL is itself the secret, so keep it out of an
exported agent file you share.

Back to the [[tutorials|Tutorials]].
