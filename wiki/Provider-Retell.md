# Provider: Retell

`"backend": { "type": "retell" }`

Connects the widget to a [Retell](https://retellai.com) **chat agent**. The
agent is built in Retell (its prompt, model, tools and all), so HelpPuff carries
the messages and adds the widget, dashboard, leads and webhooks around it.

## Set up

```bash
npx @knowtific/helppuff init --url acme.com --backend retell --retell-agent agent_abc123 --api-key "$RETELL_API_KEY"
```

```json
"backend": {
  "type": "retell",
  "agentId": "agent_abc123",
  "apiKey": { "env": "RETELL_API_KEY" }
}
```

| Option | | |
| --- | --- | --- |
| `agentId` | required | The Retell chat agent |
| `apiKey` | `{ "env": "RETELL_API_KEY" }` | By environment variable name |
| `retrieval` | — | `"helppuff"`: give the agent HelpPuff's knowledge base as a custom function (below) |

There is no prompt setting: with Retell, the agent *is* the prompt. HelpPuff
passes the visitor's name (`{{customer_name}}`) and the page they are on
(`{{page_url}}`) as dynamic variables your agent's prompt can use.

## Giving the agent your website's knowledge

With `"retrieval": "helppuff"`, your site and files are learned into Vectorize
and D1 on your Cloudflare account (as with the default backend), and the
Worker answers a Retell **custom function**:

- **URL:** `POST https://<your worker>/v1/sites/<site>/retell/kb`
- **Parameters:** `{ "query": { "type": "string" } }`
- **Auth:** Retell signs each call with your API key (`X-Retell-Signature`);
  the Worker checks it and refuses anything unsigned or older than five minutes.

Add it to the agent in Retell's dashboard and tell the agent to use it for
questions about the business. `helppuff status` prints the exact URL. It works
for Retell voice agents too.

## Rich messages

Agents can show option chips, cards and link lists by calling custom tools
named `show_options`, `show_card` or `show_links`. Their JSON schemas are
exported as `RICH_TOOL_SCHEMAS` from `@helppuff/connector-types`; paste them
into the agent's tools so what the agent sends and what the widget accepts
match.

## Notes

Retell holds the conversation; the session holds only the chat id. Ending a
chat in the widget ends it in Retell.
