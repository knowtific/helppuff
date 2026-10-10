# Tutorial: order tracking

An online shop's assistant answers "where is my order?": it asks for the
order number, checks it in your shop, then asks the carrier where the parcel
is, and tells the visitor in one or two sentences.

```text
Visitor    Hi, where's my order? It's been a week.
Assistant  Sorry about the wait. What's your order number? It's in your confirmation email.
Visitor    1042
Assistant  Thanks. And the email address you ordered with?
Visitor    ada@example.com
Assistant  It's on its way: it left the Sydney depot this morning, and USPS expects it on
           Thursday 12 October.
```

**What it teaches:** asking for a value in the chat and saving it, one tool
feeding another (`{{data.*}}`), and picking a few fields from a big response.

**Template:** `order-tracking` ([[import it|Tutorials#use-a-template]]).
**You need:** an endpoint on your shop (step 1) and a
[Shippo](https://goshippo.com) account for tracking (a free test token works
for everything below).

## How it works

```text
Visitor asks ─▶ order_number (extract) ─▶ order_lookup (your shop) ─▶ track_shipment (Shippo) ─▶ answer
                saves 1042 + email         carrier, tracking number     status, place, ETA
```

Three tools, all **during the chat**, each named in the prompt:

| Tool | Kind | What it does |
| --- | --- | --- |
| `order_number` | extract | Saves the order number and email on the conversation (and as custom attributes, so your team sees them) |
| `order_lookup` | http | Asks your shop for the order: its status, carrier and tracking number |
| `track_shipment` | http | Asks Shippo where the parcel is, using what `order_lookup` returned |

## 1. Your shop's endpoint

The assistant should never see one customer's order because another typed
its number. So the lookup takes the **order number and the email** together,
and your endpoint answers only when both match.

`GET https://shop.example.com/api/helppuff/orders/1042?email=ada@example.com`
with `Authorization: Bearer <your key>`:

```json
{ "found": true, "status": "fulfilled", "carrier": "usps", "tracking_number": "9205590164917312751089", "items": ["Linen shirt (M)", "Canvas tote"] }
```

When the number and email don't match, answer **HTTP 200** with:

```json
{ "found": false }
```

Not a 404: a 404 tells the assistant the check failed, and it would say "I
couldn't check right now" instead of "those details don't match an order".

`carrier` is [Shippo's carrier token](https://docs.goshippo.com/docs/tracking/tracking/)
(`usps`, `ups`…). While testing, return `"carrier": "shippo"` and
`"tracking_number": "SHIPPO_TRANSIT"`: Shippo's test token answers those
with a sample parcel on its way (`SHIPPO_DELIVERED`, `SHIPPO_FAILURE`… give
the other statuses).

<details>
<summary>A sketch for Shopify (a Cloudflare Worker)</summary>

```ts
// GET /api/helppuff/orders/:number?email=… → { found, status, carrier, tracking_number, items }
// Secrets: HELPPUFF_KEY (what HelpPuff sends), SHOPIFY_TOKEN (an Admin API token). Check the API version in Shopify's docs.
const CARRIERS: Record<string, string> = { USPS: 'usps', UPS: 'ups', FedEx: 'fedex', 'DHL Express': 'dhl_express' };

export default {
  async fetch(request: Request, env: { HELPPUFF_KEY: string; SHOPIFY_TOKEN: string }): Promise<Response> {
    if (request.headers.get('Authorization') !== `Bearer ${env.HELPPUFF_KEY}`) return new Response('Unauthorized', { status: 401 });
    const url = new URL(request.url);
    const number = url.pathname.split('/').pop()!.replace(/^#/, '');
    const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
    const query = `query($q: String!) { orders(first: 1, query: $q) { nodes { email displayFulfillmentStatus lineItems(first: 5) { nodes { name } } fulfillments { trackingInfo { company number } } } } }`;
    const res = await fetch('https://your-store.myshopify.com/admin/api/2025-07/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_TOKEN },
      body: JSON.stringify({ query, variables: { q: `name:#${number}` } }),
    });
    const order = ((await res.json()) as any).data?.orders?.nodes?.[0];
    // Same answer for "no such order" and "wrong email": a number on its own reveals nothing.
    if (!order || order.email?.toLowerCase() !== email) return Response.json({ found: false });
    const tracking = order.fulfillments?.[0]?.trackingInfo?.[0];
    return Response.json({
      found: true,
      status: order.displayFulfillmentStatus.toLowerCase(),
      carrier: tracking ? (CARRIERS[tracking.company] ?? tracking.company.toLowerCase()) : null,
      tracking_number: tracking?.number ?? null,
      items: order.lineItems.nodes.map((i: { name: string }) => i.name),
    });
  },
};
```

</details>

## 2. The tools

### `order_number`: save what the visitor says

An extract tool calls nothing: it names the fields to collect, and the
assistant saves them as the visitor gives them.

```bash
helppuff tools add order_number --extract \
  --field order_number='The order number from the confirmation email, like 1042.' \
  --field order_email='The email address they ordered with.' \
  --description 'Save the order number and the email address the visitor ordered with, as soon as they give them.'
```

Saving matters even though the lookup gets the same values: the number shows
on the conversation as a custom attribute (`order_number: 1042`), your team
can filter by it, and it goes to [[webhooks|Webhooks]] and exports.

### `order_lookup`: your shop

```bash
helppuff tools add order_lookup \
  --url 'https://shop.example.com/api/helppuff/orders/{{args.order_number}}?email={{args.email}}' \
  --header 'Authorization: Bearer ${SHOP_API_KEY}' \
  --param order_number='The order number, like 1042 (without #).' \
  --param email='The email address the order was placed with.' \
  --pick found,status,carrier,tracking_number,items \
  --description 'Look an order up by its number and the email address it was placed with: its status, carrier and tracking number.'
```

- `{{args.order_number}}` and `{{args.email}}` are filled in by the
  assistant. Their descriptions tell it what to ask for; "without #" stops it
  sending `#1042`. Each value is URL-encoded for its place, so whatever the
  visitor types stays a value.
- `${SHOP_API_KEY}` is read from `.env` and stored encrypted; it is never
  shown again.
- `--pick` keeps only what the assistant needs.

### `track_shipment`: one tool feeding another

```bash
helppuff tools add track_shipment \
  --url 'https://api.goshippo.com/tracks/{{data.order_lookup.carrier}}/{{data.order_lookup.tracking_number}}' \
  --header 'Authorization: ShippoToken ${SHIPPO_TOKEN}' \
  --pick tracking_status.status,tracking_status.status_details,tracking_status.status_date,tracking_status.location.city,tracking_status.location.state,eta \
  --timeout 8000 \
  --description 'Where the order’s parcel is now and when it should arrive. Call it after order_lookup found a tracking number.'
```

There is no `{{args.*}}` here: the carrier and tracking number come from
what `order_lookup` returned in this chat, as `{{data.order_lookup.carrier}}`.
The assistant never copies a tracking number, so it cannot mistype one.

Shippo's answer is long (the whole tracking history). The picked paths keep
six values, nested as they were:

```json
{ "tracking_status": { "status": "TRANSIT", "status_details": "Your shipment has departed from the origin.", "status_date": "2026-10-10T08:12:00Z", "location": { "city": "Sydney", "state": "NSW" } }, "eta": "2026-10-12T00:00:00Z" }
```

### Test each tool

```bash
helppuff tools test order_lookup --arg order_number=1042 --arg email=ada@example.com
helppuff tools test track_shipment --data order_lookup.carrier=shippo --data order_lookup.tracking_number=SHIPPO_TRANSIT
```

`--data` stands in for what another tool would have returned. On the
dashboard, **Test** in the tool's window does the same, and ticking keys
there is the same as `--pick`.

## 3. The prompt

```text
## Order questions
When someone asks where their order is, or when it will arrive:
1. Ask for their order number and the email address they ordered with, one at a time, unless you already have them. Their email may be in the form: {{lead.email}}. Save both with {{order_number}}.
2. Look the order up with {{order_lookup}}.
   - If it is not found, say the order number and email don't match an order we can see, and ask them to check both. Never say whether an order number exists on its own.
3. If the order has a tracking number, check the parcel with {{track_shipment}}. Then tell them, in one or two sentences, where it is and the expected delivery day if there is one ("Thursday 12 October").
4. If it has no tracking number yet, say it is being packed and usually ships within one business day.

What the tracking statuses mean:
- PRE_TRANSIT: the label is made; the carrier has not collected the parcel yet.
- TRANSIT: on its way.
- DELIVERED: delivered. If they say they don't have it, say sorry and offer a callback from the team.
- RETURNED or FAILURE: there is a problem with the delivery. Say sorry and offer a callback.
- UNKNOWN: the carrier has no news yet. Suggest checking again tomorrow.

Never promise a delivery date the tracking does not show.
```

Why it is written this way:

- **Numbered steps, a tool at each.** The assistant calls tools in the order
  the steps give, and only the tools the prompt names. Step 3's condition ("if
  the order has a tracking number") stops it calling Shippo with nothing.
- **"One at a time, unless you already have them."** Visitors answer one
  question better than two, and `{{lead.email}}` (from the pre-chat form, if
  you ask for email there) saves a question.
- **What to say for each outcome**, including not found. Without it, the
  assistant improvises, and "this order doesn't exist" would tell anyone
  guessing numbers which ones are real.
- **What each status means, in the shop's words.** Carrier statuses are
  codes; the prompt turns them into what to say and what to offer.
- **No settings repeated.** Tone, length and "never invent" are
  [[settings and built-in rules|Prompts-and-Instructions]]; the prompt only
  says what is specific to this shop.

## 4. Try it

```bash
helppuff ask "Where is my order 1042? I ordered with ada@example.com"
```

Then chat on your site like a customer. On the dashboard, the conversation
shows **Data from tools**: what each tool returned, and the saved order
number as an attribute.

## When it goes wrong

| What you see | Why, and what to do |
| --- | --- |
| "I couldn't check that right now" | A tool failed (4xx, 5xx, timeout). `helppuff tools list` shows each tool's last status; test it with the same values |
| It asks for the order number again | The extract tool is not named in the prompt (`{{order_number}}`), or its field descriptions don't match what the visitor said |
| It never calls `track_shipment` | `order_lookup` returned no `tracking_number`, or the tool is missing from the prompt |
| Shippo answers 401 | A test token only tracks the `shippo` test carrier; use your live token for real parcels |

Next: [[Send chats to your CRM|Tutorial-CRM-Sync]], to send the order number
and a summary to your help desk when the chat ends.
