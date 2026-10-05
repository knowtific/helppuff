# Provider: your own API

`"backend": { "type": "http" }`

Put Murmur's widget, dashboard, leads and webhooks in front of anything you
have built: your own agent, a LangChain or LlamaIndex app, a local model, a
gateway. Nothing about your stack goes into Murmur, and you need no fork.

Two shapes, chosen with `mode`.

## `mode: "openai"`: any Chat Completions endpoint

vLLM, Ollama, LiteLLM, OpenRouter, DeepSeek, Together, or your own
OpenAI-compatible server. Murmur keeps the conversation history (in KV, per
session) and sends `prompt.md` as the system message.

```json
"backend": {
  "type": "http",
  "mode": "openai",
  "url": "https://llm.acme.com/v1",
  "model": "llama-3.3-70b",
  "token": { "env": "MURMUR_BACKEND_TOKEN" }
}
```

## `mode: "murmur"`: your service owns everything

Your service decides what to say; Murmur carries the messages. It POSTs:

```
POST {url}/start    { siteId, sessionId, lead?, context, firstMessage? }
POST {url}/message  { siteId, sessionId, state, input }
```

- `context` is the page the visitor is on: `{ pageUrl, pageTitle?, referrer?, utm?, locale? }`.
- `lead` is the pre-chat form's answers, when there is one.
- `input` is what the visitor did: `{ kind: "text", text }`, or
  `{ kind: "action", actionId, value, label }` for a button or form.
- `state` is whatever you returned last time (below).

Answer with JSON:

```json
{ "text": "Yes, we service Lilydale. Want a quote?" }
```

or, for rich messages and state:

```json
{
  "messages": [
    { "type": "text", "text": "Yes, we service Lilydale." },
    { "type": "options", "options": [{ "id": "q", "label": "Get a quote", "value": "I'd like a quote" }] }
  ],
  "state": { "conversation": "c-9" }
}
```

Messages use the [[protocol's message shapes|Protocol#messages]] (`id`, `ts`
and `role` may be left out). Or stream the reply as server-sent events:

```
event: delta   data: {"text":"Yes, we "}
event: delta   data: {"text":"service Lilydale."}
event: done    data: {"text":"Yes, we service Lilydale.","state":{"conversation":"c-9"}}
```

`state` comes back to you with the next message. It rides inside the signed
session token, so keep it small (under 1 KB): an id into your own storage, not
the conversation.

### Authentication

- `token`: sent as `Authorization: Bearer …`. Store it with
  `murmur secret set MURMUR_BACKEND_TOKEN`.
- `signingSecret`: every request also carries `X-Murmur-Timestamp` and
  `X-Murmur-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">`, so
  your service can check the call came from your Worker.

```json
"backend": {
  "type": "http",
  "mode": "murmur",
  "url": "https://agent.acme.com/murmur",
  "token": { "env": "MURMUR_BACKEND_TOKEN" },
  "signingSecret": { "env": "MURMUR_BACKEND_SECRET" }
}
```

## Set up

```bash
npx @knowtific/murmur init --url acme.com --backend http --http-url https://agent.acme.com/murmur --http-mode murmur --http-token "$TOKEN"
```

Your API must answer within 25 seconds. Errors and timeouts become a polite
"something went wrong" for the visitor; the details are only in the Worker's
logs.

For more ways to build on Murmur, see [[Extending]].
