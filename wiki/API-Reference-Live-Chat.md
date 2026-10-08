<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Live chat API

A person on the team answers instead of the assistant: reply, take, give, close and hand back a live chat, and see who is available. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Live chat now|API-Reference-Live-Chat#live-chat-now]]: `GET /live/status`
- [[Reply in a live chat|API-Reference-Live-Chat#reply-in-a-live-chat]]: `POST /conversations/:id/reply`
- [[Take or give a conversation|API-Reference-Live-Chat#take-or-give-a-conversation]]: `POST /conversations/:id/assign`
- [[Close a conversation|API-Reference-Live-Chat#close-a-conversation]]: `POST /conversations/:id/close`
- [[Hand back to the assistant|API-Reference-Live-Chat#hand-back-to-the-assistant]]: `POST /conversations/:id/handback`
- [[Telegram|API-Reference-Live-Chat#telegram]]: `GET /live/telegram`
- [[Connect Telegram|API-Reference-Live-Chat#connect-telegram]]: `POST /live/telegram`
- [[Change Telegram options|API-Reference-Live-Chat#change-telegram-options]]: `PATCH /live/telegram`
- [[Send a Telegram test|API-Reference-Live-Chat#send-a-telegram-test]]: `POST /live/telegram/test`
- [[Disconnect Telegram|API-Reference-Live-Chat#disconnect-telegram]]: `DELETE /live/telegram`

## Live chat now

`GET /live/status` · scope `conversations:read`

Whether live chat is on, who on the team can take chats (an open dashboard set to available), whether Telegram is linked, and how many live chats there are: unassigned, waiting for a reply, and waiting for you.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/live/status" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/live/status`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as LiveChatNowResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "enabled": true,
  "hub": true,
  "available": 1,
  "agents": [
    {
      "email": "sam@acme.example",
      "name": "Sam",
      "available": true
    }
  ],
  "telegram": {
    "connected": true,
    "linked": true
  },
  "live": 2,
  "unassigned": 1,
  "waiting": 1,
  "mine": 0
}
```
```ts [Type]
type LiveChatNowResponse = {
  enabled: boolean;
  hub: boolean;
  available: number;
  agents: Array<{
    email: string;
    name: string;
    available: boolean;
  }>;
  telegram: {
    connected: boolean;
    linked: boolean;
  };
  live: number;
  unassigned: number;
  waiting: number;
  mine: number;
};
```
<!-- /tabs -->

## Reply in a live chat

`POST /conversations/:id/reply` · scope `conversations:write`

A person on the team answers the visitor (shown with their first name, `live.showAgentName`). Only a live chat (handed over to the team) can be answered; replying takes it if nobody has. Sends `message.sent` with `author`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `text` | yes | Up to 4000 characters. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/reply" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "Hi Ada, Sam here. Tomorrow at 9 works — shall I book it?"
}'
```
```ts [TypeScript]
type ReplyInLiveChatRequest = {
  /** Up to 4000 characters. */
  text: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/reply`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'Hi Ada, Sam here. Tomorrow at 9 works — shall I book it?'
  } satisfies ReplyInLiveChatRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ReplyInLiveChatResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "h_mfx2k1a9",
  "ts": 1760000000000,
  "role": "agent",
  "type": "text",
  "text": "Hi Ada, Sam here. Tomorrow at 9 works — shall I book it?",
  "meta": {
    "human": true,
    "agentName": "Sam"
  }
}
```
```ts [Type]
type ReplyInLiveChatResponse = {
  id: string;
  ts: number;
  role: string;
  type: string;
  text: string;
  meta: {
    human: boolean;
    agentName: string;
  };
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `conflict` | The chat is not live: the assistant has it, or it closed. |

## Take or give a conversation

`POST /conversations/:id/assign` · scope `conversations:write`

`to`: `"me"` (a signed-in person takes it), a team member's email (give it; admins only), or `null` (unassign). The visitor of a live chat sees who joined. Sends `conversation.assigned`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `to` | yes | `"me"`, an email on the team, or null. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/assign" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "to": "sam@acme.example"
}'
```
```ts [TypeScript]
type TakeGiveConversationRequest = {
  /** `"me"`, an email on the team, or null. */
  to: string;
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/assign`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    to: 'sam@acme.example'
  } satisfies TakeGiveConversationRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as TakeGiveConversationResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "assignedTo": "sam@acme.example",
  "assignedName": "Sam"
}
```
```ts [Type]
type TakeGiveConversationResponse = {
  conversationId: string;
  assignedTo: string | null;
  assignedName: string | null;
};
```
<!-- /tabs -->

## Close a conversation

`POST /conversations/:id/close` · scope `conversations:write`

Closes it (conversations also close after `live.closeAfterMinutes` without a message). The visitor of a live chat is told; if they write again, the assistant answers. Sends `conversation.closed`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/close" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/close`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as CloseConversationResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "status": "closed",
  "closedAt": 1760000000000
}
```
```ts [Type]
type CloseConversationResponse = {
  conversationId: string;
  status: string;
  closedAt: number;
};
```
<!-- /tabs -->

## Hand back to the assistant

`POST /conversations/:id/handback` · scope `conversations:write`

Ends the live part: the assistant answers the visitor's next message. Sends `handover.ended`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/handback" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/handback`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as HandBackToAssistantResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "conversationId": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "status": "bot"
}
```
```ts [Type]
type HandBackToAssistantResponse = {
  conversationId: string;
  status: string;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 409 | `conflict` | The assistant already has it. |

## Telegram

`GET /live/telegram` · scope `settings:read`

Whether a Telegram bot is connected and linked to a chat; until linked, the `linkCode` to send there as `/link <code>`.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl "$HELPPUFF_URL/api/v1/live/telegram" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/live/telegram`, {
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as TelegramResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "connected": true,
  "linked": true,
  "bot": {
    "name": "Acme Desk",
    "username": "acme_desk_bot"
  },
  "chat": {
    "title": "Acme team",
    "topics": true
  },
  "linkCode": null,
  "shareContact": true,
  "status": "ok",
  "lastError": null,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type TelegramResponse = {
  connected: boolean;
  linked: boolean;
  bot: {
    name: string;
    username: string;
  } | null;
  chat: {
    title: string;
    topics: boolean;
  } | null;
  linkCode: string | null;
  shareContact: boolean;
  status: string | null;
  lastError: string | null;
  updatedAt: number | null;
};
```
<!-- /tabs -->

## Connect Telegram

`POST /live/telegram` · scope `settings:write`

Connects the bot made with @BotFather by its token (checked with `getMe`, stored encrypted), and points its webhook here. Then add the bot to your team's group (Topics on, the bot an admin with "Manage topics"), or open a private chat with it, and send `/link <linkCode>` there.

| Body field | Required | Description |
| --- | --- | --- |
| `token` | yes | The bot token from @BotFather. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/live/telegram" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "token": "7123456789:AAH3k…"
}'
```
```ts [TypeScript]
type ConnectTelegramRequest = {
  /** The bot token from @BotFather. */
  token: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/live/telegram`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    token: '7123456789:AAH3k…'
  } satisfies ConnectTelegramRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ConnectTelegramResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "connected": true,
  "linked": false,
  "bot": {
    "name": "Acme Desk",
    "username": "acme_desk_bot"
  },
  "chat": null,
  "linkCode": "9f3a1c2e",
  "shareContact": true,
  "status": "linking",
  "lastError": null,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type ConnectTelegramResponse = {
  connected: boolean;
  linked: boolean;
  bot: {
    name: string;
    username: string;
  } | null;
  chat: string | null;
  linkCode: string | null;
  shareContact: boolean;
  status: string | null;
  lastError: string | null;
  updatedAt: number | null;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Telegram refused the token, or the webhook. |

## Change Telegram options

`PATCH /live/telegram` · scope `settings:write`

| Body field | Required | Description |
| --- | --- | --- |
| `shareContact` | no | Include visitors' email and phone in what goes to Telegram. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X PATCH "$HELPPUFF_URL/api/v1/live/telegram" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "shareContact": false
}'
```
```ts [TypeScript]
type ChangeTelegramOptionsRequest = {
  /** Include visitors' email and phone in what goes to Telegram. */
  shareContact?: boolean;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/live/telegram`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    shareContact: false
  } satisfies ChangeTelegramOptionsRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as ChangeTelegramOptionsResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "connected": true,
  "linked": true,
  "bot": {
    "name": "Acme Desk",
    "username": "acme_desk_bot"
  },
  "chat": {
    "title": "Acme team",
    "topics": true
  },
  "linkCode": null,
  "shareContact": false,
  "status": "ok",
  "lastError": null,
  "updatedAt": 1760000000000
}
```
```ts [Type]
type ChangeTelegramOptionsResponse = {
  connected: boolean;
  linked: boolean;
  bot: {
    name: string;
    username: string;
  } | null;
  chat: {
    title: string;
    topics: boolean;
  } | null;
  linkCode: string | null;
  shareContact: boolean;
  status: string | null;
  lastError: string | null;
  updatedAt: number | null;
};
```
<!-- /tabs -->

## Send a Telegram test

`POST /live/telegram/test` · scope `settings:write`

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/live/telegram/test" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/live/telegram/test`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SendTelegramTestResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "ok": true
}
```
```ts [Type]
type SendTelegramTestResponse = {
  ok: boolean;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | No chat is linked yet. |

## Disconnect Telegram

`DELETE /live/telegram` · scope `settings:write`

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `site` | query | no | The site (a key always uses its own). |

**Request**

<!-- tabs -->
```bash [curl]
curl -X DELETE "$HELPPUFF_URL/api/v1/live/telegram" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/live/telegram`, {
  method: 'DELETE',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
  },
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as DisconnectTelegramResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "connected": false
}
```
```ts [Type]
type DisconnectTelegramResponse = {
  connected: boolean;
};
```
<!-- /tabs -->
