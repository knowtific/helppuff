# Tutorial: product and stock

A shop's assistant finds what a visitor describes, with live prices, and
checks whether their nearest store has it.

```text
Visitor    Do you have waterproof hiking boots in a 10?
Assistant  Right now, three in a 10:
           - Ridgeline GTX, $229 (https://shop.example.com/p/ridgeline-gtx)
           - Trailhead Mid WP, $189 (…)
           - Summit Lite, $159 (…)
Visitor    Is the Ridgeline in store near 3056?
Assistant  Yes: Brunswick has 2 pairs right now, 450 Sydney Rd.
```

**What it teaches:** what belongs in the knowledge base and what comes from a
tool (see [[Knowledge base or tool?|Knowledge-Or-Tool]]), two tools where
the second uses a value from the first, and keeping the assistant to what
the search returned.

**Template:** `product-stock` ([[import it|Tutorials#use-a-template]]).
**You need:** two endpoints on your shop (step 1).

## Knowledge or tool?

| What | From | Why |
| --- | --- | --- |
| What a product is, sizing, materials, care | The **knowledge base** (your product pages) | Changes rarely; the assistant answers in context |
| Price, sizes in stock, store stock | A **tool** | Changes every hour; the knowledge base would be out of date |

So the prompt sends sizing questions to the website, and prices and stock to
the tools.

## 1. Your endpoints

`GET /api/helppuff/products?q=waterproof+hiking+boots&size=10&limit=3`:

```json
{ "products": [{ "name": "Ridgeline GTX", "sku": "RG-GTX-BLK", "price": "$229", "url": "https://shop.example.com/p/ridgeline-gtx", "sizes_online": ["9", "10", "11"] }] }
```

`GET /api/helppuff/stock?sku=RG-GTX-BLK&postcode=3056`:

```json
{ "stores": [{ "name": "Brunswick", "address": "450 Sydney Rd", "quantity": 2 }, { "name": "Coburg", "address": "…", "quantity": 0 }] }
```

Return stores nearest first. An empty search is `{ "products": [] }` with
HTTP 200: "nothing matches" is an answer, not a failure.

Shopify, WooCommerce and most shop platforms have a search and an inventory
API; a small endpoint (like the order tracking tutorial's) shapes their
answers into these.

## 2. The tools

```bash
helppuff tools add product_search \
  --url 'https://shop.example.com/api/helppuff/products?q={{args.query}}&size={{args.size}}&limit=3' \
  --header 'Authorization: Bearer ${SHOP_API_KEY}' \
  --param query='What they are looking for, in their words, like "waterproof hiking boots".' \
  --param size='Their size, if they gave one; otherwise empty.' \
  --pick products \
  --description 'Search the catalogue: matching products with price, link, sku and the sizes in stock online.'

helppuff tools add store_stock \
  --url 'https://shop.example.com/api/helppuff/stock?sku={{args.sku}}&postcode={{args.postcode}}' \
  --header 'Authorization: Bearer ${SHOP_API_KEY}' \
  --param sku='The product’s sku, from product_search.' \
  --param postcode='The visitor’s postcode.' \
  --pick stores \
  --description 'How many of a product each store near a postcode has, nearest first.'
```

`size` is optional: its description says to leave it empty, and your
endpoint ignores an empty `size=`. The `sku` comes from the search's result
in the same chat; its description says so.

## 3. The prompt

```text
## Products and stock
- When they describe what they want, search with {{product_search}}, using their words and any size or colour they gave. Suggest at most three, each with its price and link. Never mention a product the search did not return.
- When they ask whether it is in a store, you need their postcode ({{lead.postcode}}); ask if you don't have it. Then check {{store_stock}} with the product's sku, and give the nearest store that has it, with how many.
- Prices and stock change: say "right now", and never hold or reserve stock.
- For sizing, materials and care, answer from the website's product pages.
```

- **"Never mention a product the search did not return"** stops the
  assistant recommending something from memory, or from an old page.
- **`{{lead.postcode}}`** works if your pre-chat form asks for it (see
  [[Nearest store|Tutorial-Nearest-Store]]); otherwise it asks.

## Try it

```bash
helppuff tools test product_search --arg query='hiking boots' --arg size=10
helppuff ask "Do you have waterproof hiking boots in a 10?"
```

Next: [[Hot leads to Slack|Tutorial-Hot-Leads-Slack]].
