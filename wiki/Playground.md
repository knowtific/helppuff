# The playground

The [playground](https://knowtific.github.io/helppuff/playground/) is the real
widget in a frame, with every option in a panel beside it. Change an option
and the preview rebuilds. It needs no account and no Worker: the page answers
the widget's calls itself, with the same replies as HelpPuff's test backend.
Nothing you type leaves your browser.

Use it to choose how the widget looks and behaves before you set HelpPuff up,
to show someone a design, or to check an option before you change it on your
real site.

## The panel

- **Start from** (at the top): a ready-made setup to begin with: *Everything
  on*, *Minimal*, *Trades, dark* or *Clinic, soft*. Once you change
  something, it says *Your changes*.
- **Options**: brand, launcher, home screen, teaser, pre-chat form, chat and
  more, as controls. **Embed and replies** at the end has *Fill the page*
  (the `data-fill` attribute of the script tag), *Stream replies* and *Reply
  delay* (to watch the typing indicator). These three are not part of
  `helppuff.json`: the first goes on the script tag, the other two only
  change the playground's replies.
- **JSON**: the same config as text. Edit it and apply; a mistake is shown,
  not applied.
- **Reference**: every option with what it does. Filter it by name.
- **Use it**: the config to copy into `helppuff.json`, the script tag, and a
  link to this exact setup.

In the preview, the page beside the chat has a button for every kind of
message (text, options, a card, links, a form, the booking date picker and
more) and every call of the widget's [[JavaScript API|Widget#the-javascript-api]],
with a log of what the widget reports.

## Link to this exact setup

The link (**Use it** → *Link to this exact setup*, or simply the address in
your browser's address bar) opens the playground with everything as you
left it: the options, the JSON and the three preview switches. Send it to a
colleague, put it in an issue, or keep it to come back to.

How it works:

- **The setup is in the link itself**, after the `#`. Nothing is stored
  anywhere: there is no account and no server copy, so the link never
  expires, and anyone who has it sees the same setup. The part after `#` is
  never sent to a server, not even to GitHub Pages, which serves the page.
- **An untouched starting point is a short link**: `…/playground/#p=clinic`.
  Change anything and the link carries the whole config instead:
  `…/playground/#c=eyJ3aWRnZXQiOnsi…`, the setup as JSON in URL-safe base64.
  The more you change, the longer it gets.
- **The address bar keeps up**: it changes a moment after you stop typing,
  so copying the address works as well as the copy button.
- **Opening it restores the setup**, not a conversation: the chat starts
  fresh. A link that cannot be read (cut short, say) opens the default setup
  instead.

What a link holds is the `widget` part of `helppuff.json`, which is public
anyway: it is what your Worker serves to every visitor. Keys and secrets are
never part of it.

> Some chat apps and email clients cut very long links. If a `#c=` link opens
> the default setup, send the JSON from **Use it** instead; it pastes into
> the **JSON** tab.

## From the playground to your site

1. Set HelpPuff up in your Cloudflare account: `npx @knowtific/helppuff`, or
   give your coding agent the [[install prompt|AI-Agents]].
2. Copy the config from **Use it** and merge its `widget` part into your
   `helppuff.json`, then run `helppuff deploy`. Most of it can also be
   changed in the dashboard's **Settings**.
3. Add the script tag the dashboard gives you to your pages
   ([[Embedding|Widget#embedding]]).

A coding agent can do step 2 from the link: give it the link and ask it to
apply that setup to `helppuff.json`. The JSON is in the link, after `#c=`.

The playground's replies are scripted: the answers your visitors get come
from your assistant and your [[knowledge base|Knowledge-Base]], and the date
picker shows your real free times once
[[booking in the chat|Bookings]] is on.
