# Models and providers

Who writes your assistant's answers is `model` in `helppuff.json`. Leave it
out for the default, Workers AI. Everything else about the assistant (the
prompt, tools, citations, guardrails, history) is the same whichever you
choose.

Models change only with the CLI (or by editing `helppuff.json`), then
`helppuff deploy`. The dashboard shows them under Settings → Advanced but
does not change them, so `helppuff.json` stays the one place they are set.

## Set a model

```bash
helppuff model                                        # what answers now
helppuff model set <provider> [options]               # change it
helppuff secret set <KEY_NAME>                        # its key (a hidden prompt)
helppuff deploy
helppuff model test "Do you do emergency callouts?"   # one question through the deployed Worker
```

`model set` saves `helppuff.json` and keeps the assistant's tuning (time zone,
language, answer length…). When the key it needs is not in `.env` yet, it
answers `needs_input` with the exact `helppuff secret set` command. Keys are
never written into `helppuff.json`: it names the variable, `.env` holds the
value, and `helppuff deploy` uploads it to the Worker as an encrypted secret.

## Workers AI (the default)

```json
"model": { "provider": "workers-ai", "model": "@cf/zai-org/glm-4.7-flash" }
```

No key: the Worker's AI binding runs on your own Cloudflare account. The
daily budget (`model.budget.dailyNeurons`, 9,000 by default) keeps you under
the free 10,000 neurons; on Workers Paid, raise it and redeploy. `gateway`
puts an AI Gateway in front of every call. [[AI models|AI-Models]] compares the
Workers AI models.

## Any OpenAI-compatible API

```json
"model": { "provider": "openai-compatible", "preset": "deepinfra", "model": "deepseek-ai/DeepSeek-V3.1" }
```

Any API with OpenAI's `/chat/completions` and tool calls. A preset fills the
address and the key's variable name:

| `preset` | Address | Key | Model ids look like |
| --- | --- | --- | --- |
| `deepinfra` | `https://api.deepinfra.com/v1/openai` | `DEEPINFRA_API_KEY` | `deepseek-ai/DeepSeek-V3.1` |
| `openrouter` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-5` |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | `deepseek-flash` |
| `groq` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `together` | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` | their catalogue's id |
| `mistral` | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` | their catalogue's id |
| `fireworks` | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` | their catalogue's id |
| `vercel-ai-gateway` | `https://ai-gateway.vercel.sh/v1` | `AI_GATEWAY_API_KEY` | `provider/model`, e.g. `openai/gpt-5-mini` |
| `cloudflare-ai-gateway` | `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat` | the provider's key | `provider/model` |

Without a preset, give the address yourself:

```json
"model": { "provider": "openai-compatible", "baseUrl": "https://llm.example.com/v1", "model": "my-model", "apiKey": { "env": "MY_LLM_KEY" } }
```

- `apiKey`: sent as `Authorization: Bearer …` (default: the preset's).
- `headers`: extra headers; a value may be a secret (`{ "env": "NAME" }`).
- `nativeTools: false`: for a model without native tool calls. Tool calls it
  writes in its text are still read.

**Cloudflare AI Gateway**: `gatewayId` (default `default`) and `accountId`
(default: the account you deploy to) build the address. `apiKey` is your
provider's key (or the gateway's own, with keys stored in the gateway), and
`gatewayToken` is sent as `cf-aig-authorization` for an authenticated
gateway:

```bash
helppuff model set openai-compatible --preset cloudflare-ai-gateway --gateway-id acme --model openai/gpt-5-mini --key-env OPENAI_API_KEY
```

## OpenAI, Gemini and Claude

```json
"model": { "provider": "openai", "model": "gpt-5-mini" }
"model": { "provider": "gemini", "model": "gemini-3-flash" }
"model": { "provider": "anthropic", "model": "claude-opus-5" }
```

Keys: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` (or name your
own with `apiKey`). OpenAI and Gemini go through their OpenAI-compatible
APIs; Claude through its own Messages API.

## Your own model

`"provider": "custom"` runs your own TypeScript file in the Worker. See
[[Custom model|Custom-Model]].

## The assistant's tuning

These work with every provider: `reasoning`, `fallbackModel` (another model
of the same provider, tried once when a call fails), `locale`, `timezone`,
`maxAnswerSentences`, `maxOutputTokens`, `historyMessages`, `richMessages`,
`tools` (callbacks and opening hours), `business`, and `budget`
(`maxInputTokens` for all; `dailyNeurons` for Workers AI). See the
[[Configuration reference|Configuration-Reference]].

## Costs

Workers AI counts neurons against `model.budget.dailyNeurons`. Other
providers bill you directly at their own prices; cap the day with
`security.limits.messagesPerSitePerDay`. HelpPuff's knowledge base (search,
reranking) still uses a few Workers AI neurons per question whatever the
model.

## Knowledge

What the answers come from is set separately: see [[Providers]] (the table)
and [[Custom knowledge base|Custom-Knowledge-Base]].
