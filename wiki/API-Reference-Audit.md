<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Audit API

What changed, when, and who (or which key) changed it. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Audit log|API-Reference-Audit#audit-log]]: `GET /audit`

## Audit log

`GET /audit` · scope `audit:read`

Every change made through the API or the dashboard, newest first, kept 90 days. Pass `next` as `before` for the next page.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `before` | query | no | Cursor: the `next` of the previous page. |
| `limit` | query | no | 1–200, default 50. |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/audit" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/audit`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as AuditLogResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "items": [
    {
      "id": "au_1",
      "at": 1760000000000,
      "actor": "key:k7m3p9q2r4s8",
      "action": "PATCH /leads/:id",
      "target": "lead_5e3f0c8a-1f7b-4f8e-9a51-0e2b7c4d1a90",
      "site": "acme",
      "status": 200
    }
  ],
  "next": null
}
```
```ts [Type]
type AuditLogResponse = {
  items: Array<{
    id: string;
    at: number;
    actor: string;
    action: string;
    target: string;
    site: string;
    status: number;
  }>;
  next: string | null;
};
```
<!-- /tabs -->
