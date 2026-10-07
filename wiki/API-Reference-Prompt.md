<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Prompt API

The business-specific instructions, versioned. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[The prompt and its versions|API-Reference-Prompt#the-prompt-and-its-versions]]: `GET /prompt`
- [[One prompt version|API-Reference-Prompt#one-prompt-version]]: `GET /prompt/versions/:version`
- [[Publish a prompt version|API-Reference-Prompt#publish-a-prompt-version]]: `POST /prompt`
- [[Restore a prompt version|API-Reference-Prompt#restore-a-prompt-version]]: `POST /prompt/restore`

## The prompt and its versions

`GET /prompt` · scope `prompt:read`

The business-specific instructions, everything HelpPuff adds around them (`builtIn`), lines that repeat a setting (`overlaps`), and the version history.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/prompt" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/prompt`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as PromptAndItsVersionsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "site": "acme",
  "connector": "workers-ai",
  "builtIn": "You are the website assistant for Acme…",
  "overlaps": [],
  "editable": true,
  "reason": null,
  "text": "We service the Inner West only.",
  "hash": "9f2c…",
  "version": 3,
  "meta": {
    "version": 3,
    "hash": "9f2c…",
    "at": 1760000000000,
    "by": "owner@acme.example",
    "source": "dashboard"
  },
  "limit": 16000,
  "versions": [
    {
      "version": 3,
      "hash": "9f2c…",
      "source": "dashboard",
      "author": "owner@acme.example",
      "note": null,
      "restoredFrom": null,
      "createdAt": 1760000000000,
      "chars": 31
    }
  ]
}
```
```ts [Type]
type PromptAndItsVersionsResponse = {
  site: string;
  connector: string;
  builtIn: string;
  overlaps: string[];
  editable: boolean;
  reason: string | null;
  text: string;
  hash: string;
  version: number;
  meta: {
    version: number;
    hash: string;
    at: number;
    by: string;
    source: string;
  };
  limit: number;
  versions: Array<{
    version: number;
    hash: string;
    source: string;
    author: string;
    note: string | null;
    restoredFrom: string | null;
    createdAt: number;
    chars: number;
  }>;
};
```
<!-- /tabs -->

## One prompt version

`GET /prompt/versions/:version` · scope `prompt:read`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `version` | path | yes | The version. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/prompt/versions/VERSION" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const version = '2';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/prompt/versions/${version}`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as OnePromptVersionResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "version": 2,
  "hash": "1d4e…",
  "source": "cli",
  "author": "cli",
  "note": null,
  "restoredFrom": null,
  "createdAt": 1760000000000,
  "chars": 38,
  "text": "We service the Inner West and the CBD."
}
```
```ts [Type]
type OnePromptVersionResponse = {
  version: number;
  hash: string;
  source: string;
  author: string;
  note: string | null;
  restoredFrom: string | null;
  createdAt: number;
  chars: number;
  text: string;
};
```
<!-- /tabs -->

## Publish a prompt version

`POST /prompt` · scope `prompt:write`

Live within a minute. `baseVersion` is the version you edited: if someone published since, the answer is 409 with theirs.

| Body field | Required | Description |
| --- | --- | --- |
| `text` | yes | The whole prompt (up to 16,000 characters). |
| `baseVersion` | yes | The version you edited (from `GET /prompt`). |
| `note` | no | What changed, for the history. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/prompt" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "We service the Inner West only. Never quote for gas work.",
  "baseVersion": 3,
  "note": "No gas quotes"
}'
```
```ts [TypeScript]
type PublishPromptVersionRequest = {
  /** The whole prompt (up to 16,000 characters). */
  text: string;
  /** The version you edited (from `GET /prompt`). */
  baseVersion: number;
  /** What changed, for the history. */
  note?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/prompt`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'We service the Inner West only. Never quote for gas work.',
    baseVersion: 3,
    note: 'No gas quotes'
  } satisfies PublishPromptVersionRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as PublishPromptVersionResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "status": "published",
  "version": 4,
  "hash": "a1b2…"
}
```
```ts [Type]
type PublishPromptVersionResponse = {
  status: string;
  version: number;
  hash: string;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `bad_request` | Someone published a newer version (it is in the body). |

## Restore a prompt version

`POST /prompt/restore` · scope `prompt:write`

Publishes an old version's text as a new version.

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/prompt/restore" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "version": 2,
  "baseVersion": 4
}'
```
```ts [TypeScript]
type RestorePromptVersionRequest = {
  version?: number;
  baseVersion?: number;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/prompt/restore`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    version: 2,
    baseVersion: 4
  } satisfies RestorePromptVersionRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RestorePromptVersionResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "status": "published",
  "version": 5,
  "hash": "c3d4…"
}
```
```ts [Type]
type RestorePromptVersionResponse = {
  status: string;
  version: number;
  hash: string;
};
```
<!-- /tabs -->
