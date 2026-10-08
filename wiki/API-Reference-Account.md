<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Account API

Who the key is, and the API description itself. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Who is calling|API-Reference-Account#who-is-calling]]: `GET /me`

## Who is calling

`GET /me` · any key

The key (or account) and the site it works on. A cheap way to check a key.

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/me" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/me`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as WhoCallingResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "admin": {
    "email": "key:k7m3p9q2r4s8",
    "owner": false,
    "role": "admin",
    "name": "Website backend",
    "via": "key"
  },
  "key": {
    "id": "k7m3p9q2r4s8",
    "name": "Website backend",
    "scopes": [
      "chat",
      "leads:read"
    ],
    "site": "acme",
    "expiresAt": null
  },
  "sites": [
    {
      "id": "acme",
      "name": "Acme Plumbing",
      "accent": "#5B5BF7",
      "avatar": null,
      "embed": "<script src=\"https://helppuff.example.workers.dev/loader.js\" data-site=\"acme\" async></script>",
      "connector": "workers-ai",
      "knowledge": true,
      "website": "https://acme.example",
      "production": {
        "turnstile": true,
        "hostnames": [
          "acme.example",
          "helppuff.example.workers.dev"
        ],
        "dailyCap": 500
      },
      "live": true
    }
  ],
  "summaries": true
}
```
```ts [Type]
type WhoCallingResponse = {
  admin: {
    email: string;
    owner: boolean;
    role: string;
    name: string;
    via: string;
  };
  key: {
    id: string;
    name: string;
    scopes: string[];
    site: string;
    expiresAt: number | null;
  };
  sites: Array<{
    id: string;
    name: string;
    accent: string;
    avatar: string | null;
    embed: string;
    connector: string;
    knowledge: boolean;
    website: string;
    production: {
      turnstile: boolean;
      hostnames: string[];
      dailyCap: number;
    };
    live: boolean;
  }>;
  summaries: boolean;
};
```
<!-- /tabs -->
