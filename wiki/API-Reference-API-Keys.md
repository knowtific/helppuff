<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# API keys API

Keys for this API. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List API keys|API-Reference-API-Keys#list-api-keys]]: `GET /keys`
- [[Create an API key|API-Reference-API-Keys#create-an-api-key]]: `POST /keys`
- [[Revoke an API key|API-Reference-API-Keys#revoke-an-api-key]]: `DELETE /keys/:id`

## List API keys

`GET /keys` · scope `keys:read`

Never their secrets. With the scopes and presets there are.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/keys" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/keys`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListAPIKeysResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "keys": [
    {
      "id": "k7m3p9q2r4s8",
      "name": "Website backend",
      "prefix": "hp_live_k7m3p9q2r4s8",
      "site": "acme",
      "scopes": [
        "chat",
        "leads:read"
      ],
      "allowIps": [],
      "ratePerMinute": 120,
      "createdBy": "owner@acme.example",
      "createdAt": 1760000000000,
      "expiresAt": null,
      "lastUsedAt": null,
      "revokedAt": null
    }
  ],
  "scopes": [
    {
      "scope": "chat",
      "description": "Talk to the assistant as a visitor…"
    }
  ],
  "presets": [
    {
      "id": "chat",
      "label": "Chat only",
      "scopes": [
        "chat"
      ]
    }
  ]
}
```
```ts [Type]
type ListAPIKeysResponse = {
  keys: Array<{
    id: string;
    name: string;
    prefix: string;
    site: string;
    scopes: string[];
    allowIps: string[];
    ratePerMinute: number;
    createdBy: string;
    createdAt: number;
    expiresAt: number | null;
    lastUsedAt: number | null;
    revokedAt: number | null;
  }>;
  scopes: Array<{
    scope: string;
    description: string;
  }>;
  presets: Array<{
    id: string;
    label: string;
    scopes: string[];
  }>;
};
```
<!-- /tabs -->

## Create an API key

`POST /keys` · scope `keys:write`

The full key is in this answer only: store it in your secrets manager. A key cannot create a key with scopes it does not have.

| Body field | Required | Description |
| --- | --- | --- |
| `name` | yes | What the key is for. |
| `preset` | no | `chat`, `crm`, `read` or `full`. Or, instead: |
| `scopes` | no | A list of scopes (see the API page). |
| `expiresInDays` | no | 1–3650; absent or null: never. |
| `allowIps` | no | IP addresses or CIDR ranges it may be used from. |
| `ratePerMinute` | no | Requests a minute (default 120). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/keys" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Website backend",
  "preset": "chat",
  "expiresInDays": 365
}'
```
```ts [TypeScript]
type CreateAPIKeyRequest = {
  /** What the key is for. */
  name: string;
  /** `chat`, `crm`, `read` or `full`. Or, instead: */
  preset?: string;
  /** A list of scopes (see the API page). */
  scopes?: string;
  /** 1–3650; absent or null: never. */
  expiresInDays?: number;
  /** IP addresses or CIDR ranges it may be used from. */
  allowIps?: string;
  /** Requests a minute (default 120). */
  ratePerMinute?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/keys`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Website backend',
    preset: 'chat',
    expiresInDays: 365
  } satisfies CreateAPIKeyRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CreateAPIKeyResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "key": "hp_live_k7m3p9q2r4s8_Zx1…",
  "id": "k7m3p9q2r4s8",
  "name": "Website backend",
  "prefix": "hp_live_k7m3p9q2r4s8",
  "site": "acme",
  "scopes": [
    "chat"
  ],
  "allowIps": [],
  "ratePerMinute": 120,
  "createdBy": "owner@acme.example",
  "createdAt": 1760000000000,
  "expiresAt": 1791536000000,
  "lastUsedAt": null,
  "revokedAt": null
}
```
```ts [Type]
type CreateAPIKeyResponse = {
  key: string;
  id: string;
  name: string;
  prefix: string;
  site: string;
  scopes: string[];
  allowIps: string[];
  ratePerMinute: number;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 403 | `forbidden` | The calling key would hand out scopes it does not have. |

## Revoke an API key

`DELETE /keys/:id` · scope `keys:write`

Refused everywhere within 30 seconds. `:id` is the key's id or prefix.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/keys/ID" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/keys/${id}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RevokeAPIKeyResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "k7m3p9q2r4s8",
  "name": "Website backend",
  "prefix": "hp_live_k7m3p9q2r4s8",
  "site": "acme",
  "scopes": [
    "chat",
    "leads:read"
  ],
  "allowIps": [],
  "ratePerMinute": 120,
  "createdBy": "owner@acme.example",
  "createdAt": 1760000000000,
  "expiresAt": null,
  "lastUsedAt": null,
  "revokedAt": 1760000060000,
  "revoked": true
}
```
```ts [Type]
type RevokeAPIKeyResponse = {
  id: string;
  name: string;
  prefix: string;
  site: string;
  scopes: string[];
  allowIps: string[];
  ratePerMinute: number;
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number;
  revoked: boolean;
};
```
<!-- /tabs -->
