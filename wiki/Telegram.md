# Answering from Telegram

Telegram puts live chats on everyone's phone, free: each chat a visitor
starts with your team becomes its own **thread**, and whatever you write in
that thread goes to that visitor. It counts as "someone available", so
visitors are handed over even when nobody has the dashboard open.

Turn on [[Live chat|Live-Chat]] first.

## Setup (about five minutes)

Two steps are yours: an agent cannot create a bot or post in your Telegram.

1. **Make a bot.** In Telegram, message **@BotFather**, send `/newbot`,
   choose a name (what your team sees, e.g. *Acme Desk*) and a username
   ending in `bot`. Copy the **token** it gives you.
2. **Connect it.** Dashboard → Settings → Live chat → Telegram → paste the
   token → **Connect**. Or: `helppuff telegram connect` (it asks for the
   token; `--token` or a pipe works too). The token is stored encrypted on
   your Worker and never shown again.
3. **Choose where chats arrive:**
   - **A team:** make a Telegram group, turn on **Topics** (group settings),
     add the bot, and make it an **admin** with **Manage topics**.
   - **Just you:** open a private chat with your bot. For a thread per chat
     there too, turn on the bot's topic (thread) mode in @BotFather.
4. **Link it.** Send the code the dashboard shows there: `/link 1a2b3c4d`.
   The bot answers *Linked*.
5. **Send a test** from the dashboard (or `helppuff telegram test`).

Without topics, each chat arrives as a message: reply to it (Telegram's
**Reply**) to answer that visitor.

## In a thread

| You write | What happens |
| --- | --- |
| Anything | Goes to the visitor (and takes the chat if nobody has) |
| `/take` | The chat is yours |
| `/close` | Closes the chat; the visitor is told |
| `/ai` | Back to the assistant |
| `/info` | The visitor's page, country and details |
| `/help` | These commands |

The visitor sees your Telegram first name (or "someone from the team", if
**Show visitors your first name** is off). Replies from the dashboard appear
in the thread too, so the thread is the whole conversation.

## Privacy

Visitors' messages, and (unless you turn it off) their email and phone, are
sent to Telegram, a third party. **Include visitors' email and phone** in
Settings → Live chat → Telegram turns contact details off. Only the linked
chat is listened to; messages anywhere else are ignored, and Telegram's
requests are checked with a secret only your Worker and Telegram know.

Rotating `HELPPUFF_SECRET` makes the stored token unreadable: connect
Telegram again.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| No thread appears for a new chat | The bot must be an admin with **Manage topics**, and Topics on. Otherwise chats arrive as messages to reply to |
| `/link` says the code does not match | Copy it again from the dashboard; a new **Connect** makes a new code |
| Replies do not reach the visitor | Write in the chat's thread (or reply to its message); the chat must still be live |
| "Last error" in the dashboard | `helppuff telegram status`; reconnect with a fresh token from @BotFather (`/token`) |
| Nothing arrives at all | `helppuff doctor` checks it; **Disconnect** and connect again |
