# Tutorial: nearest store

A hardware chain's assistant knows the visitor's nearest store before they
type anything. The pre-chat form asks for their postcode; when the chat
starts, a tool asks Google Places for your stores near it; the first answer
can already say where to go.

```text
[Form]     Name: Sam · Postcode: 3056
Visitor    Can I pick up an online order today?
Assistant  Yes: your nearest store is Acme Hardware Brunswick, 450 Sydney Rd,
           Brunswick VIC 3056 (Google Maps: https://maps.google.com/?cid=…). Bring your
           order number. Is that store OK, or would another suit you better?
```

**What it teaches:** a pre-chat form field, a before-chat tool, and putting
a tool's result straight into the prompt.

**Template:** `nearest-store` ([[import it|Tutorials#use-a-template]]). It
sets the pre-chat form to name and postcode.
**You need:** a Google Maps Platform key with the **Places API (New)**
enabled, and your stores listed on Google Maps.

## How it works

```text
Pre-chat form ──▶ nearest_store (before) ──▶ the prompt has the stores ──▶ first answer
postcode 3056     Places text search          {{nearest_store.places}}
```

Before-chat tools run once, when the chat starts, all together, with the
form's answers. The first answer waits for them (5 seconds at most by
default), and what they returned is in the prompt from then on. The visitor
never sees the lookup.

## 1. Ask for the postcode

Add a field named `postcode` to the pre-chat form: Settings → **Lead form**,
or:

```bash
helppuff config set widget.leadForm.fields '[{"name":"name","label":"Name","type":"text","required":true},{"name":"postcode","label":"Postcode","type":"text","required":true}]'
helppuff deploy
```

Every field is available to tools as `{{prechat.<name>}}` and to the prompt
as `{{lead.<name>}}`. A before-chat tool that uses a field the visitor left
empty is skipped, so make the field required if the tool needs it.

## 2. The tool

```bash
helppuff tools add nearest_store --before --method POST \
  --url https://places.googleapis.com/v1/places:searchText \
  --header 'Content-Type: application/json' \
  --header 'X-Goog-Api-Key: ${GOOGLE_MAPS_API_KEY}' \
  --header 'X-Goog-FieldMask: places.displayName,places.formattedAddress,places.googleMapsUri' \
  --body '{"textQuery": "Acme Hardware near {{prechat.postcode}}", "regionCode": "AU", "pageSize": 3}' \
  --pick places \
  --description 'The three stores nearest the visitor’s postcode.'
```

- **[Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)**
  finds places matching words, here your brand "near" a postcode, most
  relevant first (for "… near 3056", usually the closest). Change
  `Acme Hardware` to your business's name as it appears on Google Maps, and
  `regionCode` to your country.
- **`X-Goog-FieldMask`** is required, and decides what you pay for: the
  fields here are billed as Pro. Phone numbers and opening hours
  (`places.nationalPhoneNumber`, `places.currentOpeningHours`) are billed as
  Enterprise; add them only if the assistant should use them.
- **`{{prechat.postcode}}`** is put into the JSON as a string, escaped, so a
  visitor cannot break the request whatever they type.
- **The key** is stored encrypted. Restrict it in Google Cloud to the Places
  API (New). Do not restrict it to your website's address: the request comes
  from your Worker, not the visitor's browser.

Test it:

```bash
helppuff tools test nearest_store --prechat postcode=3056
```

```json
{ "places": [
  { "displayName": { "text": "Acme Hardware Brunswick", "languageCode": "en" }, "formattedAddress": "450 Sydney Rd, Brunswick VIC 3056, Australia", "googleMapsUri": "https://maps.google.com/?cid=…" },
  { "displayName": { "text": "Acme Hardware Coburg", "languageCode": "en" }, "formattedAddress": "…", "googleMapsUri": "…" }
] }
```

## 3. The prompt

```text
## Their nearest store
The visitor gave their postcode before the chat ({{lead.postcode}}). The stores nearest to it, closest first: {{nearest_store.places}}

- When they ask where to buy, where to pick up an order or where the nearest store is, give the first store's name and address, and its Google Maps link.
- If they say that store doesn't suit them, give the next one.
- If the list is "(not known yet)" or empty, say you couldn't find a store near that postcode, and give the store finder: https://www.example.com/stores

Never guess opening hours: link to the store's page on Google Maps for them.
```

- **`{{nearest_store.places}}`** puts what the tool returned into the prompt,
  as data. A deeper path works too: `{{nearest_store.places.0.formattedAddress}}`
  is the first store's address alone.
- **When the tool found nothing** (a typo in the postcode, a timeout), the
  value is `(not known yet)`. The prompt says what to do then, so the
  assistant never invents a store.
- A before-chat tool is **not offered** to the assistant to call: it has
  already run. Naming its result is enough.

## 4. Try it

Open the chat on your site, fill in a real postcode, and ask "where's my
nearest store?". The conversation's **Data from tools** shows what Google
returned.

## Your own store list instead

If your stores are not on Google Maps, or you want stock levels too, point
the tool at your own endpoint:

```bash
helppuff tools add nearest_store --before \
  --url 'https://api.example.com/stores/nearest?postcode={{prechat.postcode}}&limit=3' \
  --header 'Authorization: Bearer ${STORES_API_KEY}' \
  --description 'The three stores nearest the visitor’s postcode.'
```

Return the stores closest first (`{ "stores": [{ "name": "…", "address": "…", "distanceKm": 2.1 }] }`)
and use `{{nearest_store.stores}}` in the prompt.

Next: [[Verified account changes|Tutorial-Verified-Account-Changes]], for a
task that needs several tools and real security.
