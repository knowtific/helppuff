# Where prompts and content live

Murmur is transport and UI. A system prompt is **content** — it changes on a
different clock from the code, it differs per site, and in a hosted service it
belongs to the customer rather than to this repository.

So the rule is: **nothing in this repository should have to change to change
what the assistant says.** Everything below follows from that.

---

## The short answer

| You want to… | Put the prompt in |
| --- | --- |
| Use Retell | The Retell agent. Murmur only passes `agentId` and variables. |
| Use OpenAI, and version prompts properly | An OpenAI **stored prompt**, referenced by `promptRef: { id, version }`. |
| Use Gemini, or any provider without stored prompts | `{ kv: 'prompt:<site>' }` — edited live, no redeploy. |
| Use your own model, RAG or orchestration | The `http` connector. Murmur forwards the protocol; your backend owns everything AI-shaped. |
| Run one site yourself and keep it simple | An inline string in `murmur.config.ts`. |

---

## Why provider-side comes first

Retell and OpenAI both let the prompt live on *their* side, addressed by id:

```ts
// Retell — the prompt is the agent, edited in Retell's dashboard.
connector: { type: 'retell', options: { agentId: 'agent_xxx' } }

// OpenAI — a stored, versioned prompt template.
connector: {
  type: 'openai',
  options: { promptRef: { id: 'pmpt_abc', version: '4' } },
}
```

This is the best option wherever it exists, for three reasons:

- **A prompt change is not a deploy.** Someone who does not write TypeScript
  can edit it.
- **Versioning is the provider's problem**, and they are better at it than a
  git history of a config file.
- **The open-source repository stays free of customer content**, which
  matters the moment this is published.

Murmur still supplies the *variables* — see below — so the prompt can say
"You are helping {{lead_name}} who is on {{page_url}}" without Murmur knowing
anything about the wording.

## When the provider has no stored prompts

Gemini's Interactions API takes `system_instruction` inline, so there is
nowhere on Google's side to keep it. That is what the other sources are for:

```ts
systemInstruction: 'You are Alex…'                        // inline
systemInstruction: { env: 'KNOWTIFIC_PROMPT' }            // a Worker secret
systemInstruction: { kv: 'prompt:knowtific' }             // live, per site
systemInstruction: { url: 'https://cms…/prompt.txt' }     // from a CMS
```

`{ kv }` is the one to reach for in a service. The key is yours to namespace
per site, and updating it takes effect on the next message:

```bash
wrangler kv key put --binding=MURMUR_KV "prompt:knowtific" --path ./prompt.txt
```

`{ url }` fetches and caches in KV for `ttlSeconds` (300 by default), so a
prompt that already lives in a CMS does not cost a fetch per message.

**A source that cannot be read yields no prompt, not an error.** An assistant
with no system prompt still answers; a failed request answers nothing. The
miss is logged as `prompt.kv_missing` or `prompt.fetch_failed` so it is
visible to you rather than to the visitor.

## The variables

Every connector supplies the same set, so a prompt written for one reads the
same on another:

| Variable | From |
| --- | --- |
| `lead_<field>` | Each configured lead field — `lead_name`, `lead_phone`, … |
| `page_url`, `page_title`, `referrer` | The page the visitor is on |
| `locale`, `timezone` | The browser |
| `utm_source`, `utm_medium`, … | The campaign that brought them |
| `site_id` | Which site, when one deployment serves several |

Inline and `{ kv }` / `{ url }` prompts use `{{lead.name}}` and
`{{context.pageUrl}}` templating. Provider-side prompts get the flat names
above, because that is what Retell's dynamic variables and OpenAI's prompt
variables accept.

---

## Keeping it versatile: your own model

For Supabase vector search with DeepSeek, or anything else you want to own,
there are two routes.

### The `http` connector — nothing about your stack enters this repo

Murmur POSTs the protocol to your URL and expects protocol messages back:

```
POST {url}/start     { sessionId, siteId, lead, context, firstMessage }
                  -> { state?, messages }
POST {url}/message   { sessionId, state, input }
                  -> { state?, messages }
```

Your service does the embedding, the vector search, the prompt assembly and
the model call. Prompts, retrieval and model choice all live with you, and
Murmur never learns about any of them. Requests are HMAC-signed when you set
`signingSecret`, so you can verify the caller.

This is the right answer when the RAG is yours, when you want a model Murmur
has no connector for, or when you would rather not give this project your
provider keys.

### A connector — when it should be first-class

Write one when the backend is worth sharing: it is ~200 lines, it runs inside
the Worker with no extra hop, and it gets the same `PromptSource` support for
free. `docs/connectors.md` has the interface.

The rule of thumb: **a connector is for a provider, the `http` connector is
for a product.** DeepSeek behind an OpenAI-compatible endpoint is already
covered — point the `openai` connector at its `baseUrl`. Your own RAG
pipeline in front of DeepSeek is a backend, so it goes through `http`.

---

## What this means for the service

When Murmur becomes multi-tenant, the same rule extends from prompts to the
whole config: today `murmur.config.ts` is bundled into the Worker, so adding
a site is a deploy. The plan (§5) already anticipates a KV-backed override,
and prompts are the first thing that should move.

The shape that falls out:

```
config:{siteId}     the public widget config and connector options
prompt:{siteId}     the system prompt
quota:{siteId}:{d}  today's usage
```

Nothing customer-specific in git; the repository stays a product rather than
a deployment of one. The `{ kv }` prompt source is the first step of that and
works today.
