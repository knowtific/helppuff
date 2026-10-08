<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Team API

Who can sign in to the dashboard. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[List dashboard accounts|API-Reference-Team#list-dashboard-accounts]]: `GET /admins`
- [[Add a dashboard account|API-Reference-Team#add-a-dashboard-account]]: `POST /admins`
- [[Change a role or name|API-Reference-Team#change-a-role-or-name]]: `PATCH /admins/:email`
- [[Remove a dashboard account|API-Reference-Team#remove-a-dashboard-account]]: `DELETE /admins/:email`
- [[Make a one-time sign-in link|API-Reference-Team#make-a-one-time-sign-in-link]]: `POST /admins/:email/sign-in-link`

## List dashboard accounts

`GET /admins` · scope `team:read`

Each account's `role`: `admin` (everything) or `member` (conversations, contacts, callbacks and live chat only).

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
      "role": "member",
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
    role: string;
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
| `role` | no | `admin` (default: everything) or `member` (conversations, contacts, callbacks and live chat; no settings). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/admins" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "email": "sam@acme.example",
  "name": "Sam",
  "role": "member"
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
  /**
   * `admin` (default: everything) or `member` (conversations, contacts,
   * callbacks and live chat; no settings).
   */
  role?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/admins`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'sam@acme.example',
    name: 'Sam',
    role: 'member'
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
  "role": "member",
  "createdAt": 1760000000000,
  "signInLink": "https://helppuff.example.workers.dev/admin/#/signin/9xQ…",
  "signInLinkExpiresAt": 1760604800000
}
```
```ts [Type]
type AddDashboardAccountResponse = {
  email: string;
  name: string;
  role: string;
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

## Change a role or name

`PATCH /admins/:email` · scope `team:write`

`role`: `admin` or `member`. The owner always has full access.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `email` | path | yes | The email. |

| Body field | Required | Description |
| --- | --- | --- |
| `role` | no | `admin` or `member`. |
| `name` | no | Up to 100 characters: the first name visitors see in live chat. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/admins/EMAIL" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "role": "admin"
}'
```
```ts [TypeScript]
type ChangeRoleNameRequest = {
  /** `admin` or `member`. */
  role?: string;
  /** Up to 100 characters: the first name visitors see in live chat. */
  name?: string;
};

const email = 'sam@acme.example';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/admins/${email}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    role: 'admin'
  } satisfies ChangeRoleNameRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangeRoleNameResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "email": "sam@acme.example",
  "name": "Sam",
  "role": "admin",
  "createdAt": 1760000000000,
  "lastLoginAt": 1760000000000
}
```
```ts [Type]
type ChangeRoleNameResponse = {
  email: string;
  name: string | null;
  role: string;
  createdAt: number;
  lastLoginAt: number | null;
};
```
<!-- /tabs -->

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
