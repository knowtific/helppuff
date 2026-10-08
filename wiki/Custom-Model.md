# Custom model

Use any model you can reach over HTTP, or anything you can write in
TypeScript, as the model that writes your assistant's answers. You write one
function, `chat`; HelpPuff keeps everything around it: the prompt and its
rules, the tools (callbacks, jobs, live chat hand-over, opening hours),
citations, guardrails, history and limits.

For an OpenAI-compatible API you do not need code: see
[[Models and providers|Models-and-Providers]]. Write your own when the API is
different, or you want to route, cache, or post-process.

## 1. A starter file

```bash
helppuff scaffold model --use     # writes ./llm.ts and points helppuff.json at it
```

```json
"model": { "provider": "custom", "module": "./llm.ts", "secrets": ["MY_MODEL_KEY"] }
```

## 2. The function

```ts
import type { LanguageModel } from '@knowtific/helppuff/sdk';

export default {
  id: 'my-model',
  capabilities: { tools: true },
  async chat(request, ctx) {
    const response = await ctx.fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(ctx.env['MY_MODEL_KEY'])}` },
      body: JSON.stringify({ model: request.model, messages: request.messages, max_tokens: request.maxTokens, tools: request.tools }),
      signal: request.signal,
    });
    if (!response.ok) throw new Error(`model ${response.status}`);
    const body = await response.json();
    const message = body.choices[0].message;
    return {
      content: message.content ?? '',
      toolCalls: (message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
      usage: body.usage ? { input: body.usage.prompt_tokens, output: body.usage.completion_tokens } : null,
    };
  },
} satisfies LanguageModel;
```

**What you get (`request`)**

| Field | What |
| --- | --- |
| `model` | `model.model` from helppuff.json (default `custom`) |
| `messages` | OpenAI chat-completions messages: `system` (HelpPuff's whole prompt, passages included), `user`, `assistant` (with `tool_calls`), `tool` (results) |
| `tools` | The tools offered, OpenAI's `function` shape. Empty on the last round |
| `maxTokens`, `temperature`, `reasoning` | The answer's limits. Use what your API supports |
| `onText` | Present when the visitor watches the reply arrive: call it with each piece of text to stream (optional) |
| `signal` | Aborts when the call takes too long |

**What you return**: `content` (the text), `toolCalls` (each `{ id, name,
arguments }`, the arguments as JSON text), `usage` (`{ input, output }`
tokens, or `null`). HelpPuff runs the tools and calls you again with their
results, up to three rounds.

With `capabilities: { tools: false }`, tool calls your model writes in its
text (`<tool_call>…`, or a JSON object naming a tool) are still read.

**What you can use (`ctx`)**: `ctx.fetch`, `ctx.env` (your secrets and the
Worker's bindings), `ctx.log(event, data)` (never log message text or contact
details), `ctx.siteId`.

## 3. Secrets

List every variable your file reads under `secrets`, then store each one:

```bash
helppuff secret set MY_MODEL_KEY
```

`helppuff deploy` uploads them as encrypted Worker secrets.

## 4. Deploy and test

```bash
helppuff deploy
helppuff model test "Do you do emergency callouts?"
```

The file is bundled into your Worker by wrangler at deploy (TypeScript
included); editing it, or a file next to it, redeploys. It runs in the Workers
runtime: `fetch`, Web APIs and npm packages that work on Workers, no
filesystem. The import of `@knowtific/helppuff/sdk` is for types only, so it
deploys without installing anything; `npm i -D @knowtific/helppuff` gives
your editor the types.

A model that throws, or answers an error, gives the visitor "The assistant is
busy right now"; `helppuff model test` shows the real error.
