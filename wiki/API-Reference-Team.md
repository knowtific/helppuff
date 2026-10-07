<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Team API

Who can sign in to the dashboard. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List dashboard accounts|API-Reference-Team#list-dashboard-accounts]]: `GET /admins`
- [[Add a dashboard account|API-Reference-Team#add-a-dashboard-account]]: `POST /admins`
- [[Remove a dashboard account|API-Reference-Team#remove-a-dashboard-account]]: `DELETE /admins/:email`
- [[Make a one-time sign-in link|API-Reference-Team#make-a-one-time-sign-in-link]]: `POST /admins/:email/sign-in-link`

## List dashboard accounts

`GET /admins` · scope `team:read`

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/admins" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/admins`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ListDashboardAccountsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "me": "key:k7m3p9q2r4s8",
  "owner": "owner@acme.example",
  "admins": [
    {
      "email": "sam@acme.example",
      "name": "Sam",
      "createdAt": 1760000000000,
      "lastLoginAt": 1760000000000
    }
  ]
}
```
```ts [Type]
type ListDashboardAccountsResponse = {
  me: string;
  owner: string;
  admins: Array<{
    email: string;
    name: string;
    createdAt: number;
    lastLoginAt: number;
  }>;
};
```
<!-- /tabs -->

## Add a dashboard account

`POST /admins` · scope `team:write`

With a `password` (10+ characters) they can sign in at once; without one, the answer has a one-time sign-in link (7 days) to send them. `team:write` can give dashboard access: treat it like full access.

| Body field | Required | Description |
| --- | --- | --- |
| `email` | yes | Their email address. |
| `name` | no | Up to 100 characters. |
| `password` | no | 10+ characters. Without it, the answer has a sign-in link. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/admins" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "email": "sam@acme.example",
  "name": "Sam"
}'
```
```ts [TypeScript]
type AddDashboardAccountRequest = {
  /** Their email address. */
  email: string;
  /** Up to 100 characters. */
  name?: string;
  /** 10+ characters. Without it, the answer has a sign-in link. */
  password?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/admins`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'sam@acme.example',
    name: 'Sam'
  } satisfies AddDashboardAccountRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AddDashboardAccountResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "email": "sam@acme.example",
  "name": "Sam",
  "createdAt": 1760000000000,
  "signInLink": "https://helppuff.example.workers.dev/admin/#/signin/9xQ…",
  "signInLinkExpiresAt": 1760604800000
}
```
```ts [Type]
type AddDashboardAccountResponse = {
  email: string;
  name: string;
  createdAt: number;
  signInLink: string;
  signInLinkExpiresAt: number;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `conflict` | The email can already sign in. |

## Remove a dashboard account

`DELETE /admins/:email` · scope `team:write`

They are signed out at their next request. The owner (set in the Worker's config) cannot be removed here.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `email` | path | yes | The email. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/admins/EMAIL" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const email = 'sam@acme.example';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/admins/${email}`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as RemoveDashboardAccountResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "email": "sam@acme.example",
  "deleted": true
}
```
```ts [Type]
type RemoveDashboardAccountResponse = {
  email: string;
  deleted: boolean;
};
```
<!-- /tabs -->

## Make a one-time sign-in link

`POST /admins/:email/sign-in-link` · scope `team:write`

Valid 15 minutes, once. The way back in after a lost password.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `email` | path | yes | The email. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/admins/EMAIL/sign-in-link" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const email = 'sam@acme.example';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/admins/${email}/sign-in-link`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as MakeOneTimeSignInLinkResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "email": "sam@acme.example",
  "url": "https://helppuff.example.workers.dev/admin/#/signin/7bR…",
  "expiresAt": 1760000900000
}
```
```ts [Type]
type MakeOneTimeSignInLinkResponse = {
  email: string;
  url: string;
  expiresAt: number;
};
```
<!-- /tabs -->
