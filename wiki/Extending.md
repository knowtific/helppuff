# Extending Murmur

Most of what people want needs no code. When it does, there is a clean place
for it. From least to most work:

| You want to… | Use | Code? |
| --- | --- | --- |
| Change what it says, knows or asks | Settings, Instructions, Knowledge (own answers, files), the lead form | no |
| Guide visitors through questions, buttons, forms | `widget.home.shortcuts`, `widget.flows`, `widget.forms` ([[Widget]]) | no (JSON) |
| Send chats and leads to your CRM, Slack, a spreadsheet | [[Webhooks]] → Zapier, Make, n8n, or your endpoint | no / a little |
| React on your page: analytics, open the chat from a button | the [[widget's JavaScript API|Widget#the-javascript-api]] | a little |
| Answer with your own agent, model or business logic | the [[`http` backend|Provider-Your-Own-API]] | yes, in your own service |
| Give the built-in assistant a new ability (check stock, book a slot) | a **tool**, in a fork | yes |
| Support another AI provider | a **connector**, in a fork | yes |
| Send leads somewhere new, built in | a **lead sink**, in a fork | yes |

Prefer the options near the top: they survive upgrades untouched. Code in a
fork must be merged with each new release (or contributed upstream; see
[[Contributing]]).

## Webhooks: react to everything

Every conversation, message, lead, callback request, rating and learning
event can be sent to an endpoint as signed JSON. A Cloudflare Worker that
posts callback requests to Slack:

```js
export default {
  async fetch(request, env) {
    const body = await request.text();
    const timestamp = request.headers.get('X-Murmur-Timestamp');
    if (!(await valid(env.MURMUR_WEBHOOK_SECRET, timestamp, body, request.headers.get('X-Murmur-Signature')))) {
      return new Response('bad signature', { status: 401 });
    }
    const event = JSON.parse(body);
    if (event.type === 'callback.requested') {
      const { name, phone, email, message } = event.data;
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        body: JSON.stringify({ text: `📞 Callback: ${name ?? 'someone'} — ${phone ?? email}\n${message ?? ''}` }),
      });
    }
    return new Response('ok');
  },
};

async function valid(secret, timestamp, body, signature) {
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const expected = 'sha256=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return expected === signature;
}
```

Every event and its payload: [[Webhooks]].

## The widget's API: your page and the chat

```js
// Track leads in your analytics
Murmur.on('lead', () => gtag('event', 'generate_lead', { method: 'chat' }));

// A "Get a quote" button anywhere on your page
document.querySelector('#quote').addEventListener('click', () => Murmur.send('I would like a quote'));

// A signed-in customer: skip the form, the details go to the lead and the assistant
Murmur.identify({ name: user.name, email: user.email });
```

See [[The widget|Widget#the-javascript-api]].

## Your own backend: full control without a fork

The `http` backend sends each message to your service and shows what it
answers, rich messages included. Your service can call your database, your
booking system, any model or framework. Murmur still provides the widget,
dashboard, leads, webhooks, rate limits and security. See
[[Your own API|Provider-Your-Own-API]].

## Working from a fork

The rest of this page changes Murmur's code. Set up a fork:

```bash
git clone https://github.com/<you>/<your fork>.git && cd <your fork>
pnpm install
pnpm dev            # the Worker on :8787 and the widget on :5173, with the echo backend
pnpm test
```

To deploy your build to an assistant, build the CLI and run it in the
assistant's project folder, the same way you would run the published one:

```bash
pnpm build:cli
cd ~/my-assistant && node /path/to/your-fork/packages/cli/dist/cli.js deploy
```

`pnpm pack:cli` makes an installable tarball instead
(`npm install ./knowtific-murmur-<version>.tgz`). See [[Contributing]] for
the repository's layout and rules.

### A new tool for the built-in assistant

Tools are things the default (`workers-ai`) assistant can do mid-conversation.
There are two today: `request_callback` and `get_business_hours`, in
`packages/connectors/workers-ai/src/tools.ts`. Adding one takes three steps.
Here, a stock check against your own API:

**1. Declare it** in `toolDefinitions()`, so the model knows when to use it:

```ts
if (options.tools.stock) {
  tools.push({
    type: 'function',
    function: {
      name: 'check_stock',
      description: 'Whether a product is in stock at the warehouse. Use when the visitor asks about availability of a specific product.',
      parameters: {
        type: 'object',
        properties: { product: { type: 'string', description: 'The product name or code, as the visitor wrote it.' } },
        required: ['product'],
      },
    },
  });
}
```

**2. Run it** in `runTool()`. Validate the arguments first; the model wrote them.
`content` is what the model reads next; `messages` are shown to the visitor
as they are (a card, option chips, a form):

```ts
case 'check_stock': {
  const parsed = z.object({ product: z.string().trim().min(1).max(120) }).safeParse(args);
  if (!parsed.success) return { content: 'Invalid arguments.', messages: [] };
  const response = await env.ctx.fetch(`https://api.acme.com/stock?q=${encodeURIComponent(parsed.data.product)}`, {
    headers: { Authorization: `Bearer ${env.ctx.env['ACME_API_TOKEN']}` },
  });
  if (!response.ok) return { content: 'The stock system is unavailable. Offer a callback instead.', messages: [] };
  const { inStock, eta } = (await response.json()) as { inStock: boolean; eta?: string };
  return { content: JSON.stringify({ inStock, eta: eta ?? null }), messages: [] };
}
```

**3. Add the switch** to `tools` in `options.ts`, with a description:

```ts
stock: z.boolean().default(false).describe('Answer stock questions from the Acme API.'),
```

Then turn it on in the assistant's `murmur.json` (`"backend": { "tools": { "stock": true } }`),
set the secret (`murmur secret set ACME_API_TOKEN`), and deploy with your build.

Rules that keep tools safe: never trust the arguments (validate with zod);
never let a tool read another site's data or a secret it does not need; keep
results short (they cost tokens); and remember the visitor can see anything
in `messages`.

### A new connector (another AI provider)

A connector translates the [[Protocol]] into one backend. Copy the `echo`
connector's shape:

```
packages/connectors/<name>/
  package.json  tsconfig.json
  src/index.ts  test/
```

and implement:

```ts
export default defineConnector({
  type: 'acme-ai',
  optionsSchema,                       // zod: the connector's options
  capabilities: { poll: false, end: false },
  streams: (options) => options.stream,                  // optional: call ctx.onText with each piece of text
  promptOption: () => 'instructions',                    // optional: which option holds prompt.md
  async start(ctx, input) { return { state: {}, messages: [] }; },
  async send(ctx, state, input) { return { state, messages: [/* text, options, card, links… */] }; },
});
```

Then register it in `packages/server/src/core/registry.ts`, add it to
`packages/server/package.json`, and wire it into the CLI: `backendSchema` in
`packages/cli/src/engine/project.ts` and the `connectorFor` mapping in
`packages/cli/src/engine/compile.ts`.

The rules:

- **State is small.** It rides in the signed session token: under 1 KB. Keep
  history in the provider (an id), or use `loadHistory` / `appendHistory`
  (`history.ts` in `@murmur/connector-types`): they read the server's record
  of the conversation when there is one, and KV otherwise.
- **Never make the visitor wait for a write.** Hand it to `ctx.waitUntil`;
  `appendHistory` and `saveScope` already do. Start reads early and await
  them together.
- **Throw `ConnectorError` with a visitor-safe message.** Put diagnostics in
  `detail`, which is logged and never shown. Anything else becomes a generic error.
- **Time out outbound calls** (25 s; `fetchWithTimeout` does it) and use
  `ctx.fetch`, so tests can stub it.
- **Never log message text or lead data.** `ctx.log` takes event names, ids,
  counts and timings.
- **Only stream text meant for the visitor** to `ctx.onText`: never reasoning
  or tool arguments.
- To use Murmur's own knowledge base from your connector, call `ground()`
  from `@murmur/rag` (as the OpenAI, Gemini and Anthropic connectors do with
  `retrieval: "murmur"`).

### A lead sink

A sink sends each lead somewhere (`packages/sinks/webhook` is the example):
implement `onLead(ctx, event)` with `defineSink`, register it in
`registry.ts`, and map a `murmur.json` setting to it in `compile.ts`. Sinks
run after the reply, never block it, and their failures are only logged. For
most destinations a [[webhook|Webhooks]] is simpler and needs no fork.

### Rich messages

Replies can be more than text: option chips, cards with buttons, carousels,
link lists, inline forms and notices. Models produce them with three tools
(`show_options`, `show_card`, `show_links`; schemas in `RICH_TOOL_SCHEMAS`,
`@murmur/connector-types`), or with inline markers when a backend cannot take
tools:

```
When suits you?
[[options: This week | Next week]]
[[link: Prices | https://acme.com.au/prices]]
```

Every message is validated on the server and again in the widget, so a
backend can never inject markup. A new message type touches the protocol
(`packages/protocol/src/messages.ts`), the server's sanitiser, the widget's
validator and a component; see [[Contributing]].
