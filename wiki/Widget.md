# The widget

The chat bubble on your site. One `<script>` tag, about 6 KB gzipped to start
(the rest loads only when needed), inside a shadow root so your page's CSS
cannot break it and it cannot break your page.

**Try it first:** the [playground](https://knowtific.github.io/helppuff/playground/) runs the real widget with every
option below in a panel beside it, and exports the config you build.

## Embedding

```html
<script src="https://<your worker>/loader.js" data-site="acme" async></script>
```

Put it before `</body>` on every page, or in the layout your pages share.
Dashboard → Home has yours, with a **Check my site** button. The page must be
on one of the `origins` in `helppuff.json`.

| Attribute | |
| --- | --- |
| `data-site` | **Required.** The site id. |
| `data-open` | Open the chat as soon as it loads. |
| `data-fill` | Make the chat fill the whole page (or the iframe it is in), with no launcher or close button: for a full-page chat link or an embedded panel. The dashboard's test chat is `/chat.html`, which uses `data-open data-fill`. |
| `data-theme` | `light`, `dark` or `auto`: overrides the configured theme. |
| `data-api` | Where the chat API is, when the script is served from somewhere else (your own CDN). Default: wherever `loader.js` came from. |

Your Worker also serves a demo page at `https://<your worker>/` (Dashboard →
Home → Share a demo).

## Customising

Most of it is in **Dashboard → Settings**: names, welcome message, suggested
questions, colour, position, button icon, the lead form. Everything else is
under `widget` in `helppuff.json`; see the
[[Configuration reference|Configuration-Reference#widget]]. Highlights:

```json
"widget": {
  "brand": { "agentName": "Ava", "accent": "#0F766E", "avatar": "https://acme.com.au/ava.png", "theme": "auto",
             "tokens": { "radius-panel": "12px", "font": "Inter, system-ui, sans-serif" } },
  "launcher": { "position": "bottom-left", "label": "Chat with us", "shape": "pill", "icon": "wrench",
                "offset": { "x": 24, "y": 96 }, "hideOnPaths": ["/checkout/**"] },
  "home": {
    "title": "Hi there",
    "subtitle": "Ask anything, or pick one.",
    "shortcuts": [
      { "id": "quote", "label": "Get a quote", "icon": "quote", "action": { "id": "quote", "kind": "flow", "label": "Get a quote", "flowId": "quote" } },
      { "id": "call", "label": "Call us", "icon": "phone", "action": { "id": "call", "kind": "tel", "label": "Call", "phone": "+61390000000" } }
    ]
  },
  "teaser": { "text": "Need a quote? Ask me.", "afterScroll": 40, "paths": ["/services/**"] },
  "flows": [
    { "id": "quote", "steps": [
        { "field": "service", "ask": "What do you need?", "input": "choice", "choices": ["Hot water", "Blocked drain", "Something else"] },
        { "field": "suburb", "ask": "Which suburb?", "input": "text" }
      ],
      "submit": { "as": "message", "template": "I'd like a quote for {service} in {suburb}." } }
  ],
  "poweredBy": { "text": "Built by Acme", "url": "https://acme.com.au" }
}
```

- **Shortcuts** are buttons on the first screen (or above the message box
  during a chat): send a question, open a page, call, email, start a flow, open a form.
- **Flows** ask a few questions inside the widget (no AI involved) and send
  the answers as one message.
- **Forms** (`widget.forms`) are inline forms a shortcut or the assistant can
  open; submitting sends the answers to the assistant.
- **Theme tokens** override CSS custom properties (colours, fonts, radii,
  sizes, motion) without touching the stylesheet. Unknown tokens are ignored,
  and values cannot inject CSS.
- **`strings`** overrides any text the widget shows (button labels, error
  messages), for wording or language.

## The JavaScript API

```js
HelpPuff.open();                       // open the chat
HelpPuff.close();
HelpPuff.toggle();
HelpPuff.send('Do you work on Sundays?');   // send a message as the visitor (opens the chat)
HelpPuff.identify({ name: 'Ada', email: 'ada@example.com' });  // skip the lead form; details go to the lead
HelpPuff.reset();                      // forget the conversation (e.g. on sign-out)
HelpPuff.destroy();                    // remove the widget from the page

HelpPuff.on('open', () => …);
HelpPuff.on('close', () => …);
HelpPuff.on('lead', (lead) => …);      // the visitor submitted their details
HelpPuff.on('message', ({ role, count }) => …);   // a reply arrived
HelpPuff.off('lead', handler);
```

Calls made before the script has loaded are queued if you add this stub
first:

```html
<script>
  window.HelpPuff = window.HelpPuff || { q: [] };
  ['open', 'close', 'toggle', 'send', 'identify', 'reset', 'on', 'off'].forEach(function (name) {
    if (!window.HelpPuff[name]) window.HelpPuff[name] = function () { window.HelpPuff.q.push([name].concat([].slice.call(arguments))); };
  });
</script>
```

Every method is safe to call at any time: if the widget is not available, it
does nothing rather than throw.

## Behaviour you can rely on

- **It never breaks your page.** Every failure (a missing config, a blocked
  network, an old browser) ends in a working widget or no widget, never an
  error on your page. It writes nothing to your `<head>`, sets no cookies, and
  uses only `hp:`-prefixed local storage.
- **Accessible.** Keyboard-only use, screen-reader announcements for replies,
  focus returned to the button on close, every target at least 44 px.
- **Mobile.** Full screen on phones, no zoom on input focus, the composer
  stays above the keyboard.
- **Conversations survive** page loads and reloads for the session's
  lifetime (`security.sessionTtlHours`, default 24).
- **Debugging:** add `?hpdebug=1` to a page's URL to log what the widget does
  to the console; `HelpPuff.debug()` returns its state.
