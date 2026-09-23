# `@murmur/connector-retell`

[Retell](https://retellai.com) chat agents. The agent is configured in
Retell's dashboard — prompt, model, tools and all — so Murmur carries
messages and nothing else.

Verified against [docs.retellai.com](https://docs.retellai.com/api-references/overview)
on 2026-09-22. The wire shapes are in
[`docs/connectors.md`](../../../docs/connectors.md).

## Setup

```bash
echo 'RETELL_API_KEY=key_...' >> packages/server/.dev.vars   # local
wrangler secret put RETELL_API_KEY                           # production
```

```ts
connector: {
  type: 'retell',
  options: {
    apiKey: { env: 'RETELL_API_KEY' },
    agentId: 'agent_abc123',
    agentVersion: 'latest_published',

    // Injected into the agent's prompt, templated from the lead and page.
    dynamicVariables: {
      customer_name: '{{lead.name}}',
      page_url: '{{context.pageUrl}}',
    },
  },
},
```

There is no prompt setting here, by design: with Retell the agent *is* the
prompt. A variable that does not resolve is left out rather than sent empty,
so the agent sees an absent value instead of a blank one.

## Options

| Option | Default | |
| --- | --- | --- |
| `apiKey` | — | String or `{ env }` |
| `agentId` | — | |
| `agentVersion` | — | A pinned version, or `latest` / `latest_published` |
| `dynamicVariables` | — | `{{lead.*}}` and `{{context.*}}` templates |
| `inlineMarkers` | `false` | Parse `[[options: …]]` markers — see below |
| `baseUrl` | Retell's | |

## Rich messages without tools

Agents that can call tools should call `show_options`, `show_card` and
`show_links`; the schemas are exported as `RICH_TOOL_SCHEMAS` from
`@murmur/connector-types`, so what you paste into Retell and what the parser
accepts cannot drift.

When tools are not available, set `inlineMarkers: true` and have the agent
end a reply with a marker instead:

```
When suits you?
[[options: Today | Tomorrow | This week]]
[[link: Pricing | https://example.com/pricing]]
```

The marker is stripped from the text and becomes a real message. A malformed
marker is stripped too — the visitor sees the prose, never the punctuation.

## Conversation state

`POST /create-chat` returns a `chat_id` and that is the whole state; Retell
holds the history, and a completion returns only the new messages. `end-chat`
is a `PATCH` with the id in the path, and is best-effort — it never fails a
request.

Of the seven message roles Retell can return, the connector renders `agent`
and `injected`, maps `tool_call_invocation` to a rich message, and ignores
`user`, `tool_call_result`, `node_transition`, `state_transition` and `sms`.
