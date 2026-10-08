# Live chat

A visitor talking to the assistant can be handed to a person on your team,
who answers from the dashboard (with a browser notification and a sound) or
from [[Telegram]]. When nobody is available, the visitor gets the callback
form instead, as before.

**Off by default.** While it is off nothing changes: the assistant offers
callbacks, the widget downloads no live-chat code, and there is no "Talk to a
person" button.

## Turning it on

- **Dashboard:** Settings → **Live chat** → *Let visitors talk to a person* → Save.
- **CLI:** `helppuff live on` (`helppuff live status` shows who can take chats).
- **An agent:** the same command, with `--json`. Setting up Telegram needs
  two steps from the person (see [[Telegram]]).

Someone must be able to take chats, or every visitor gets the callback form:

- **In the dashboard:** anyone with a dashboard tab open and the
  **Available** switch on (bottom of the menu). **Away** turns alerts off.
- **On Telegram:** a linked Telegram chat counts as available.

Deployments made before live chat need `helppuff upgrade` once: it adds the
live chat hub (a Cloudflare Durable Object, on the Free plan).

## What visitors see

1. They ask the assistant for a person ("can I talk to someone?"), or press
   the **person** button at the top of the chat.
2. *Connecting you with someone from the team. They'll reply right here.*
3. When someone takes the chat: *Sam joined the chat.* (or *Someone from the
   team joined*, if **Show visitors your first name** is off), and their
   replies, with their name above them.
4. If nobody takes it within **Wait before offering a callback** (default
   120 seconds), they get the callback form, and can keep waiting.
5. When the team hands back to the assistant, or closes the chat, they are
   told; if they write again, the assistant answers.

The workers-ai backend hands over by itself when a visitor asks for a person
(its `request_person` tool). Every other backend gets the same through the
button.

## Answering

New live chats appear at the top of **Conversations** with a **Waiting**
indicator, and the menu shows how many are waiting. Everyone available is
notified; whoever answers first, or presses **Take chat**, has it. Anyone can
**Take over** a chat from a colleague, and an admin can give it to someone
(the **Assigned to** menu).

In the chat:

| Button | What it does |
| --- | --- |
| **Take chat** / **Take over** | It's yours: the visitor sees you joined |
| Reply box | Enter sends, Shift+Enter is a new line. Replying takes the chat if nobody has |
| **Back to assistant** | The assistant answers the next message |
| **Close** | Closes it; the visitor is told |

Members (not admins) can take chats and answer; giving a chat to someone else
is for admins.

## Statuses

Every conversation has a status, and **Conversations** filters by it
(*All*, *AI bot*, *Live agent*; the choice is remembered in your browser):

| Status | Meaning |
| --- | --- |
| **AI bot** | The assistant answers |
| **Live agent** | A person has it (or it is waiting for one): the assistant does not answer |
| **Closed** | Closed by the team, or no message for **Close conversations after** (default 60 minutes) |

A closed conversation reopens with the assistant when the visitor writes
again.

## Notifications

Each person sets their own, in Settings → **Notifications**:

| Setting | Default |
| --- | --- |
| Browser notification: a new live chat is waiting | on |
| Browser notification: a new message in a live chat (tab in the background) | on |
| Sound: a new live chat / a new message | on / on |
| Repeat the sound every 15 seconds until someone takes it | off |
| Sound (chime, bell, pop) and volume | chime, 70% |
| Available for live chats | on |

**Allow notifications** asks the browser once. If it was blocked: Chrome →
the icon left of the address → Site settings → Notifications → Allow, then
reload. Browsers only play sound after you have clicked on the page once;
**Test sound** and **Test notification** check both.

Notifications need an open dashboard tab (in the background is fine). For
alerts with the dashboard closed, link [[Telegram]].

## Settings

| Setting (`live` in helppuff.json) | Default | What it does |
| --- | --- | --- |
| `enabled` | `false` | Live chat on |
| `waitSeconds` | `120` | How long a visitor waits before they are offered the callback form |
| `closeAfterMinutes` | `60` | Conversations with no message for this long are closed |
| `showAgentName` | `true` | Visitors see the first name of whoever answers |
| `aiWhileWaiting` | `false` | Let the assistant keep answering until someone takes the chat |

Limits (Settings → Advanced → More limits; see [[Security|Security#every-limit]]):
`handoversPerIpPerDay` (3), `waitingPerSite` (20), `liveSocketsPerIp` (3).

## How it works, and what it costs

The visitor's messages still go through the same route as every message
(limits, cleaning, recording); the reply comes back over a WebSocket to a
Cloudflare Durable Object, one per site, which uses the Hibernation API: an
open but idle connection costs nothing. Where a host page blocks WebSockets,
the widget polls instead. Every message is written to D1 like any other, so
summaries, webhooks and the transcript include the team's part (labelled as
the team's).

A handed-over chat is a few socket connections and about one Durable Object
request per 20 messages: 50 live chats a day of 40 messages is roughly 250
requests, of the Free plan's 100,000. See [[Cloudflare Free plan limits|Cloudflare-Free-Plan]].

Webhooks: `handover.requested`, `handover.missed`, `handover.ended`,
`conversation.assigned`, `conversation.closed`, and `message.sent` with an
`author` for a person's replies. See [[Webhooks]].

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Visitors always get the callback form | Nobody is available: switch to **Available**, or link Telegram. `helppuff doctor` says which |
| No sound | Click anywhere in the dashboard once (browsers need it), check Settings → Notifications |
| No notifications | Allowed for this site? Is the tab open? |
| "This deployment has no live chat hub" | `helppuff upgrade` |
| The visitor is stuck on "Connecting you…" | Someone takes it, or after `waitSeconds` they get the callback form |
