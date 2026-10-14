# Integrations

**Settings → Integrations** keeps the keys HelpPuff uses to talk to other
services, once for the whole site. Any feature can use them; today that is
[[Bookings]]' calendar sync. You can connect a calendar before turning on the
date picker.

| Integration | What it holds | Used for |
| --- | --- | --- |
| **Composio** | Your Composio API key, and the accounts connected through it | Google Calendar and Outlook (Microsoft 365) |
| **Cal.com** | A Cal.com API key; for a self-hosted Cal.com, also your API v2 address | Free times and bookings in Cal.com |
| **Calendly** | A personal access token | Free times and bookings in Calendly |

Keys are stored encrypted with your Worker's `HELPPUFF_SECRET`, are live at
once (no deploy) and are never shown again. **Check** asks the service
whether the key works, and the card shows how the last call went. Changing
`HELPPUFF_SECRET` makes stored keys unreadable: save them again.

## Composio: Google Calendar and Outlook

Connecting Google or Microsoft yourself means registering an OAuth app (and,
for Google calendar access, passing Google's review). Composio does that
part: you sign in to your calendar on Composio's page, and Composio keeps the
credentials.

1. Make an account at composio.dev and copy an API key (Settings → API keys).
2. In **Settings → Bookings**, choose Google Calendar or Outlook under
   **Calendar sync**, paste the key in **Composio** and press **Connect**. You
   can also do this on this page.
3. Press **Connect Google Calendar** or **Connect Outlook**, and sign in on
   the page that opens. Return to the page you started from after sign-in;
   the account list refreshes when you return to the tab. If your browser
   blocks the new tab, use the **Open Composio sign-in** link shown there.
4. Pick the account if you have more than one, then save Bookings.

Each HelpPuff site is its own user at Composio, so a site sees only its own
accounts.

## Cal.com

1. In Cal.com, **Settings → Developer → API keys**, make a key.
2. In **Settings → Bookings**, choose **Cal.com** and paste the key there. You
   can also connect it on this page. Self-hosted? Tick it and give your API v2
   address, like `https://cal.example.com/api/v2`.
3. Choose the event type in **Settings → Bookings**.

Optional, for instant updates: under **Instant updates from Cal.com**, copy
the address and secret into Cal.com's **Settings → Developer → Webhooks**,
for booking created, rescheduled and cancelled. Without it, changes made in
Cal.com show at the next sync (every 15 minutes).

## Calendly

1. In Calendly, **Integrations → API and webhooks**, make a personal access
   token.
2. In **Settings → Bookings**, choose **Calendly** and paste the token there.
   You can also connect it on this page.
3. Choose the event type in **Settings → Bookings**.

Calendly creates video links according to that event type's **Location**
setting. To book in person or by phone, change the location in Calendly;
HelpPuff uses the event type's choice.

Calendly lets apps book directly only on its paid plans (Standard and up).
On a free plan, the picker still shows your real free times; when the
visitor picks one, Calendly's own page opens for that time with their name
and email filled in, and the booking is read back at the next sync. The card
shows which plan HelpPuff found.

## From the terminal or your agent

```bash
helppuff secret set CALCOM_API_KEY                 # prompted; never paste keys into a chat
helppuff integrations add calcom --key-env CALCOM_API_KEY
helppuff integrations add composio --key-env COMPOSIO_API_KEY
helppuff integrations connect google               # prints the sign-in link
helppuff integrations accounts google
helppuff integrations calcom-webhook               # the address and secret for Cal.com
helppuff integrations list
```

The API: `GET /api/v1/integrations`, `PUT /api/v1/integrations/:kind`,
`POST /api/v1/integrations/:kind/test`, and the Composio routes (keys with
`settings:read` / `settings:write`). See
[[the API reference|API-Reference-Integrations]].

[[Agent files|Agent-Files]] never carry keys: after importing one, connect
the integrations it needs here.
