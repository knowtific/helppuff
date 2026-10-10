/**
 * Ready-made agent files: the tutorials' setups, to import as they are and
 * change (the dashboard's Import & export page, `helppuff agent import
 * <id>`). Each is an agent file (`POST /agent/import`) plus where its
 * tutorial is. Plain data, no Zod: the dashboard and the CLI both bundle it.
 *
 * Secrets are `${NAME}` placeholders, listed in `needs`: importing asks for
 * each value and stores it encrypted.
 */

export type AgentTool = Record<string, unknown> & { name: string; description: string };

export type AgentFile = {
  helppuff: 'agent';
  version: 1;
  name: string;
  description?: string;
  prompt?: string;
  settings?: { behaviour?: Record<string, unknown>; leads?: { enabled?: boolean; fields?: Record<string, unknown>[] } };
  tools: AgentTool[];
  needs: { name: string; description: string }[];
};

export type AgentTemplate = { id: string; title: string; summary: string; tutorial: string; agent: AgentFile };

const ORDER_PROMPT = `## Order questions
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

Never promise a delivery date the tracking does not show.`;

const CRM_PROMPT = `## Project enquiries
When a visitor describes a renovation they want done, find out, one question at a time and only what you don't know yet:
- the service (kitchen, bathroom, laundry, extension or other);
- the suburb;
- their budget range;
- when they would like to start.
Save each answer with {{project_details}} as soon as they give it. Then sum it up in one sentence and offer a free measure and quote from the team.

If they ask for a price, say every renovation is quoted after a free measure, and offer to book one.`;

const STORE_PROMPT = `## Their nearest store
The visitor gave their postcode before the chat ({{lead.postcode}}). The stores nearest to it, closest first: {{nearest_store.places}}

- When they ask where to buy, where to pick up an order or where the nearest store is, give the first store's name and address, and its Google Maps link.
- If they say that store doesn't suit them, give the next one.
- If the list is "(not known yet)" or empty, say you couldn't find a store near that postcode, and give the store finder: https://www.example.com/stores

Never guess opening hours: link to the store's page on Google Maps for them.`;

const ACCOUNT_PROMPT = `## Changing account details
Visitors can change the email address, the postal address or the name on their account. Before any change, confirm it is really them:
1. You need the mobile number on their account. Their form may have it: {{lead.phone}}. If it is empty, ask for it.
2. Send a code with {{send_code}}, and tell them a 6-digit code is on its way by text to the number it shows.
   - If no account was found, say you couldn't find an account with that number and offer a callback from the team. Do not try other numbers for them.
3. Ask for the code, then check it with {{check_code}}.
   - A wrong code: say so and ask again; it says how many tries are left.
   - Expired, or no tries left: offer to send a new code.
4. Only once the code is verified: ask exactly what to change, repeat it back, and when they confirm, make the change with {{update_account}}.
5. Confirm what changed in one sentence.

Never ask for a password or a card number, and never read out what is on their account.`;


const SUPPORT_PROMPT = `## Billing and account questions
The visitor is signed in as {{user.name}}. Their plan: {{account.plan}} ({{account.status}}), renewing on {{account.renews_at}}. Their recent invoices: {{account.invoices}}

- Answer questions about their plan, invoices and renewal from the account above. Give amounts and dates exactly as shown.
- "I was charged twice", or a charge they don't recognise: find the invoices in question and say what each one was for. If two look like duplicates, say so and offer to ask the billing team for a refund. When they say yes, send it with {{request_refund}} and give them the reference.
- Never promise a refund: the billing team decides, usually within two business days.
- If their account is "(not known yet)", they are not signed in: ask them to sign in to their account on the website and open the chat again. Never ask for an account number or an email address to look them up.`;

const STOCK_PROMPT = `## Products and stock
- When they describe what they want, search with {{product_search}}, using their words and any size or colour they gave. Suggest at most three, each with its price and link. Never mention a product the search did not return.
- When they ask whether it is in a store, you need their postcode ({{lead.postcode}}); ask if you don't have it. Then check {{store_stock}} with the product's sku, and give the nearest store that has it, with how many.
- Prices and stock change: say "right now", and never hold or reserve stock.
- For sizing, materials and care, answer from the website's product pages.`;

const account = (path: string) => `https://api.example.com/helppuff/${path}`;
const accountAuth = [{ name: 'Authorization', value: 'Bearer ${ACCOUNT_API_KEY}', secret: true }];

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'order-tracking',
    title: 'Order tracking',
    summary: 'Asks for the order number, looks it up in your shop, then tracks the parcel with Shippo.',
    tutorial: 'Tutorial-Order-Tracking',
    agent: {
      helppuff: 'agent',
      version: 1,
      name: 'Order tracking',
      description: 'An online shop’s support assistant: where is my order? Your shop’s API gives the carrier and tracking number; Shippo gives where the parcel is.',
      prompt: ORDER_PROMPT,
      tools: [
        {
          name: 'order_number',
          kind: 'extract',
          description: 'Save the order number and the email address the visitor ordered with, as soon as they give them.',
          fields: [
            { name: 'order_number', description: 'The order number from the confirmation email, like 1042.', required: true },
            { name: 'order_email', description: 'The email address they ordered with.', required: false },
          ],
        },
        {
          name: 'order_lookup',
          description: 'Look an order up by its number and the email address it was placed with: its status, carrier and tracking number.',
          method: 'GET',
          url: 'https://shop.example.com/api/helppuff/orders/{{args.order_number}}?email={{args.email}}',
          headers: [{ name: 'Authorization', value: 'Bearer ${SHOP_API_KEY}', secret: true }],
          parameters: [
            { name: 'order_number', description: 'The order number, like 1042 (without #).', required: true },
            { name: 'email', description: 'The email address the order was placed with.', required: true },
          ],
          pick: ['found', 'status', 'carrier', 'tracking_number', 'items'],
          timeoutMs: 5000,
        },
        {
          name: 'track_shipment',
          description: 'Where the order’s parcel is now and when it should arrive. Call it after order_lookup found a tracking number.',
          method: 'GET',
          url: 'https://api.goshippo.com/tracks/{{data.order_lookup.carrier}}/{{data.order_lookup.tracking_number}}',
          headers: [{ name: 'Authorization', value: 'ShippoToken ${SHIPPO_TOKEN}', secret: true }],
          pick: ['tracking_status.status', 'tracking_status.status_details', 'tracking_status.status_date', 'tracking_status.location.city', 'tracking_status.location.state', 'eta'],
          timeoutMs: 8000,
        },
      ],
      needs: [
        { name: 'SHOP_API_KEY', description: 'The key your shop’s order endpoint expects' },
        { name: 'SHIPPO_TOKEN', description: 'Your Shippo API token (a test token starts with shippo_test_)' },
      ],
    },
  },
  {
    id: 'crm-sync',
    title: 'Send chats to your CRM',
    summary: 'Collects the project details during the chat; when it ends, sends them with the summary to n8n or Zapier, which updates HubSpot.',
    tutorial: 'Tutorial-CRM-Sync',
    agent: {
      helppuff: 'agent',
      version: 1,
      name: 'Send chats to your CRM',
      description: 'A renovation company’s enquiry assistant. The project details are collected in the chat; after it, an n8n (or Zapier) workflow puts the contact and a note in HubSpot.',
      prompt: CRM_PROMPT,
      settings: {
        behaviour: { goal: 'callbacks' },
        leads: {
          enabled: true,
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'phone', label: 'Phone', type: 'tel', required: false },
          ],
        },
      },
      tools: [
        {
          name: 'project_details',
          kind: 'extract',
          description: 'Save the details of the renovation the visitor wants, as soon as they give each one.',
          fields: [
            { name: 'service', description: 'Kitchen, bathroom, laundry, extension or other.', required: true },
            { name: 'suburb', description: 'Where the work is.', required: false },
            { name: 'budget', description: 'Their budget range, as they said it.', required: false },
            { name: 'start', description: 'When they would like to start.', required: false },
          ],
        },
        {
          name: 'crm_sync',
          description: 'Send the finished conversation to the CRM workflow.',
          method: 'POST',
          url: 'https://your-n8n.example.com/webhook/helppuff-chat',
          headers: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'X-HelpPuff-Token', value: '${CRM_WEBHOOK_TOKEN}', secret: true },
          ],
          body: JSON.stringify(
            {
              conversationId: '{{conversation.conversationId}}',
              name: '{{lead.name}}',
              email: '{{lead.email}}',
              phone: '{{lead.phone}}',
              summary: '{{summary}}',
              leadQuality: '{{conversation.labels.leadQuality}}',
              followUp: '{{conversation.followUp}}',
              service: '{{attributes.service}}',
              suburb: '{{attributes.suburb}}',
              budget: '{{attributes.budget}}',
              start: '{{attributes.start}}',
              page: '{{conversation.page.url}}',
            },
            null,
            2,
          ),
          after: true,
          timeoutMs: 10000,
        },
      ],
      needs: [{ name: 'CRM_WEBHOOK_TOKEN', description: 'A long random string; the same value goes in the workflow’s Header Auth' }],
    },
  },
  {
    id: 'nearest-store',
    title: 'Nearest store',
    summary: 'Asks for a postcode before the chat, finds your three nearest stores with Google Places, and tells the visitor.',
    tutorial: 'Tutorial-Nearest-Store',
    agent: {
      helppuff: 'agent',
      version: 1,
      name: 'Nearest store',
      description: 'A retail chain’s assistant: the postcode from the pre-chat form, your stores near it from Google Places, before the first answer.',
      prompt: STORE_PROMPT,
      settings: {
        leads: {
          enabled: true,
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'postcode', label: 'Postcode', type: 'text', required: true },
          ],
        },
      },
      tools: [
        {
          name: 'nearest_store',
          description: 'The three stores nearest the visitor’s postcode.',
          method: 'POST',
          url: 'https://places.googleapis.com/v1/places:searchText',
          headers: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'X-Goog-Api-Key', value: '${GOOGLE_MAPS_API_KEY}', secret: true },
            { name: 'X-Goog-FieldMask', value: 'places.displayName,places.formattedAddress,places.googleMapsUri' },
          ],
          body: JSON.stringify({ textQuery: 'Acme Hardware near {{prechat.postcode}}', regionCode: 'AU', pageSize: 3 }, null, 2),
          pick: ['places'],
          before: true,
          timeoutMs: 5000,
        },
      ],
      needs: [{ name: 'GOOGLE_MAPS_API_KEY', description: 'A Google Maps Platform key with the Places API (New) enabled' }],
    },
  },
  {
    id: 'verified-account-changes',
    title: 'Verified account changes',
    summary: 'Texts a code to the account’s phone, checks it, then changes the email, address or name, through your own API.',
    tutorial: 'Tutorial-Verified-Account-Changes',
    agent: {
      helppuff: 'agent',
      version: 1,
      name: 'Verified account changes',
      description: 'Account changes after an SMS code: your API sends and checks the code (with Twilio Verify) and only then makes the change.',
      prompt: ACCOUNT_PROMPT,
      tools: [
        {
          name: 'send_code',
          description: 'Text a 6-digit code to the mobile number on the visitor’s account.',
          method: 'POST',
          url: account('verify/start'),
          headers: accountAuth,
          body: JSON.stringify({ conversation: '{{conversation.id}}', phone: '{{args.phone}}' }, null, 2),
          parameters: [{ name: 'phone', description: 'The mobile number on their account, as they gave it.', required: true }],
          timeoutMs: 8000,
        },
        {
          name: 'check_code',
          description: 'Check the code the visitor typed in. Call it once per code they give.',
          method: 'POST',
          url: account('verify/check'),
          headers: accountAuth,
          body: JSON.stringify({ conversation: '{{conversation.id}}', code: '{{args.code}}' }, null, 2),
          parameters: [{ name: 'code', description: 'The code from the text message, digits only.', required: true }],
          timeoutMs: 8000,
        },
        {
          name: 'update_account',
          description: 'Change one detail on the verified account. Only after check_code said verified, and the visitor confirmed the new value.',
          method: 'POST',
          url: account('account/update'),
          headers: accountAuth,
          body: JSON.stringify({ conversation: '{{conversation.id}}', field: '{{args.field}}', value: '{{args.value}}' }, null, 2),
          parameters: [
            { name: 'field', description: 'email, address or name.', required: true },
            { name: 'value', description: 'The new value, exactly as the visitor confirmed it.', required: true },
          ],
          timeoutMs: 8000,
        },
      ],
      needs: [{ name: 'ACCOUNT_API_KEY', description: 'The key your account API expects from HelpPuff' }],
    },
  },
  {
    id: 'logged-in-support',
    title: 'Logged-in customer support',
    summary: 'For signed-in customers: their plan and invoices before the first answer, and a refund request to the billing team.',
    tutorial: 'Tutorial-Logged-In-Support',
    agent: {
      helppuff: 'agent',
      version: 1,
      name: 'Logged-in customer support',
      description: 'A software company’s billing assistant for signed-in customers: their account from your API (by their verified id), and refund requests your team decides on.',
      prompt: SUPPORT_PROMPT,
      tools: [
        {
          name: 'account',
          description: 'The signed-in customer’s plan, status, renewal date and recent invoices.',
          method: 'GET',
          url: 'https://app.example.com/api/helppuff/accounts/{{user.id}}',
          headers: [{ name: 'Authorization', value: 'Bearer ${APP_API_KEY}', secret: true }],
          pick: ['plan', 'status', 'renews_at', 'invoices'],
          before: true,
          timeoutMs: 5000,
        },
        {
          name: 'request_refund',
          description: 'Ask the billing team to refund an invoice. Only after the customer agreed. Returns a reference.',
          method: 'POST',
          url: 'https://app.example.com/api/helppuff/refund-requests',
          headers: [{ name: 'Authorization', value: 'Bearer ${APP_API_KEY}', secret: true }],
          body: JSON.stringify({ user: '{{user.id}}', invoice: '{{args.invoice_id}}', reason: '{{args.reason}}', conversation: '{{conversation.id}}' }, null, 2),
          parameters: [
            { name: 'invoice_id', description: 'The id of the invoice to refund, from the account’s invoices.', required: true },
            { name: 'reason', description: 'Why, in a few words (e.g. charged twice).', required: true },
          ],
          timeoutMs: 8000,
        },
      ],
      needs: [{ name: 'APP_API_KEY', description: 'The key your app’s HelpPuff endpoints expect' }],
    },
  },
  {
    id: 'product-stock',
    title: 'Product and stock',
    summary: 'Searches your catalogue for what the visitor describes, then checks stock at their nearest store.',
    tutorial: 'Tutorial-Product-And-Stock',
    agent: {
      helppuff: 'agent',
      version: 1,
      name: 'Product and stock',
      description: 'A shop’s product assistant: live prices and stock from your catalogue API; descriptions and sizing from the website it learned.',
      prompt: STOCK_PROMPT,
      tools: [
        {
          name: 'product_search',
          description: 'Search the catalogue: matching products with price, link, sku and the sizes in stock online.',
          method: 'GET',
          url: 'https://shop.example.com/api/helppuff/products?q={{args.query}}&size={{args.size}}&limit=3',
          headers: [{ name: 'Authorization', value: 'Bearer ${SHOP_API_KEY}', secret: true }],
          parameters: [
            { name: 'query', description: 'What they are looking for, in their words, like "waterproof hiking boots".', required: true },
            { name: 'size', description: 'Their size, if they gave one; otherwise empty.', required: false },
          ],
          pick: ['products'],
          timeoutMs: 5000,
        },
        {
          name: 'store_stock',
          description: 'How many of a product each store near a postcode has, nearest first.',
          method: 'GET',
          url: 'https://shop.example.com/api/helppuff/stock?sku={{args.sku}}&postcode={{args.postcode}}',
          headers: [{ name: 'Authorization', value: 'Bearer ${SHOP_API_KEY}', secret: true }],
          parameters: [
            { name: 'sku', description: 'The product’s sku, from product_search.', required: true },
            { name: 'postcode', description: 'The visitor’s postcode.', required: true },
          ],
          pick: ['stores'],
          timeoutMs: 5000,
        },
      ],
      needs: [{ name: 'SHOP_API_KEY', description: 'The key your shop’s HelpPuff endpoints expect' }],
    },
  },
  {
    id: 'hot-leads-slack',
    title: 'Hot leads to Slack',
    summary: 'When a chat ends and the AI rated the lead hot, posts the contact and summary to your sales channel.',
    tutorial: 'Tutorial-Hot-Leads-Slack',
    agent: {
      helppuff: 'agent',
      version: 1,
      name: 'Hot leads to Slack',
      description: 'An alert in Slack for every hot lead, with the contact, the summary and what to do next. Adds one after-chat tool; your prompt and other tools stay.',
      tools: [
        {
          name: 'slack_hot_lead',
          description: 'Post a hot lead to the sales channel.',
          method: 'POST',
          url: 'https://slack.com/api/chat.postMessage',
          headers: [
            { name: 'Content-Type', value: 'application/json; charset=utf-8' },
            { name: 'Authorization', value: 'Bearer ${SLACK_BOT_TOKEN}', secret: true },
          ],
          body: JSON.stringify(
            {
              channel: '#sales',
              text: ':fire: *Hot lead: {{lead.name}}* ({{lead.email}} · {{lead.phone}})\n{{summary}}\n*Next:* {{conversation.followUp}}',
            },
            null,
            2,
          ),
          after: true,
          when: { path: 'labels.leadQuality', in: ['hot'] },
          timeoutMs: 8000,
        },
      ],
      needs: [{ name: 'SLACK_BOT_TOKEN', description: 'A Slack bot token (xoxb-…) with the chat:write scope' }],
    },
  },
];

export const agentTemplate = (id: string): AgentTemplate | undefined => AGENT_TEMPLATES.find((t) => t.id === id);
