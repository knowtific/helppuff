<!-- Generated from packages/server/src/api/registry.ts by `pnpm sync:docs`. Do not edit by hand. -->

# Chat API

Talk to the assistant as a visitor, from your own server: start a conversation, send messages (JSON or streamed), close it. Part of the [[API reference|API-Reference]]: setup, shared types and errors are there.

- [[Start a conversation|API-Reference-Chat#start-a-conversation]]: `POST /conversations`
- [[Send a message|API-Reference-Chat#send-a-message]]: `POST /conversations/:id/messages`
- [[Close a conversation|API-Reference-Chat#close-a-conversation]]: `POST /conversations/:id/end`

## Start a conversation

`POST /conversations` · scope `chat`

Starts a conversation as a visitor would, with the same assistant, knowledge, limits and recording as the widget. With `message`, the answer has the assistant's reply; send `Accept: text/event-stream` to stream it: `delta` events with `{ text }` as it is written, then `done` with this body (or `error` with the error), when the AI backend streams; otherwise the answer is plain JSON. `contact` becomes (or joins, by email) a lead. Counts against the site's daily cap.

| Body field | Required | Description |
| --- | --- | --- |
| `message` | no | The visitor's first message (up to 4000 characters). Without one, the answer is the greeting, if any. |
| `contact` | no | What you know about the visitor: `name`, `email`, `phone` and any other fields (up to 20). Becomes, or joins by email, a lead. |
| `user` | no | A signed-in visitor, as your server knows them: `id` (your user id) and any fields (`email`, `plan`, up to 20). Trusted, since the key is the proof: tools and the prompt read it as `{{user.*}}`, and its email and name become the lead's. From a browser, use a signed token instead (`HelpPuff.identify({ token })`). |
| `context` | no | `pageUrl`, `pageTitle`, `referrer`, `locale`, `timezone`, `utm`: where the visitor is. The assistant may use it. |
| `externalId` | no | Your own id for this conversation or visitor (up to 128 characters), to find it again. |
| `metadata` | no | Up to 20 string values you want back later. Never shown to the assistant. |
| `site` | no | Only with the admin key and several sites; a key uses its own. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "message": "How much is a blocked drain?",
  "contact": {
    "name": "Ada Lovelace",
    "email": "ada@example.com"
  },
  "context": {
    "pageUrl": "https://app.example.com/help",
    "locale": "en-AU"
  },
  "externalId": "user-123",
  "metadata": {
    "plan": "pro"
  }
}'
```
```ts [TypeScript]
type StartConversationRequest = {
  /**
   * The visitor's first message (up to 4000 characters). Without one, the
   * answer is the greeting, if any.
   */
  message?: string;
  /**
   * What you know about the visitor: `name`, `email`, `phone` and any other
   * fields (up to 20). Becomes, or joins by email, a lead.
   */
  contact?: Record<string, string>;
  /**
   * A signed-in visitor, as your server knows them: `id` (your user id) and
   * any fields (`email`, `plan`, up to 20). Trusted, since the key is the
   * proof: tools and the prompt read it as `{{user.*}}`, and its email and
   * name become the lead's. From a browser, use a signed token instead
   * (`HelpPuff.identify({ token })`).
   */
  user?: string;
  /**
   * `pageUrl`, `pageTitle`, `referrer`, `locale`, `timezone`, `utm`: where the
   * visitor is. The assistant may use it.
   */
  context?: {
    pageUrl?: string;
    locale?: string;
  };
  /**
   * Your own id for this conversation or visitor (up to 128 characters), to
   * find it again.
   */
  externalId?: string;
  /**
   * Up to 20 string values you want back later. Never shown to the assistant.
   */
  metadata?: Record<string, string>;
  /** Only with the admin key and several sites; a key uses its own. */
  site?: string;
};

const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: 'How much is a blocked drain?',
    contact: {
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    },
    context: {
      pageUrl: 'https://app.example.com/help',
      locale: 'en-AU'
    },
    externalId: 'user-123',
    metadata: {
      plan: 'pro'
    }
  } satisfies StartConversationRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as StartConversationResponse;
```
<!-- /tabs -->

**Response** `201`

<!-- tabs -->
```json [Example]
{
  "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "messages": [
    {
      "id": "m_mfx2k1",
      "ts": 1760000000000,
      "role": "agent",
      "type": "text",
      "text": "A blocked drain is usually $180–$250, including the first hour. Would you like a callback to book it in?"
    }
  ],
  "externalId": "user-123",
  "metadata": {
    "plan": "pro"
  }
}
```
```ts [Type]
type StartConversationResponse = {
  id: string;
  messages: Message[];
  externalId: string | null;
  metadata: Record<string, string> | null;
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 429 | `quota_exceeded` | The site used its daily cap (`security.limits.messagesPerSitePerDay`). |
| 502 | `connector_error` | The AI backend failed; try again. |

## Send a message

`POST /conversations/:id/messages` · scope `chat`

The visitor's next message: `{ "text" }`, or `{ "action": { id, value, label? } }` to answer options, a card button or a form (a form's answers are a JSON object string in `value`; forms are honoured only when this conversation was shown them). Only conversations started over the API can be continued here. `Accept: text/event-stream` streams the reply.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

| Body field | Required | Description |
| --- | --- | --- |
| `text` | no | What the visitor typed (up to `maxMessageLength`). Or, instead: |
| `action` | no | `{ id, value, label? }`: an answer to options, a card button or a form. `id` is the message (or action) id; a form's answers are a JSON object string in `value`. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/messages" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "text": "Can someone come tomorrow morning?"
}'
```
```ts [TypeScript]
type SendMessageRequest = {
  /** What the visitor typed (up to `maxMessageLength`). Or, instead: */
  text?: string;
  /**
   * `{ id, value, label? }`: an answer to options, a card button or a form.
   * `id` is the message (or action) id; a form's answers are a JSON object
   * string in `value`.
   */
  action?: { id: string; value: string; label?: string };
};

const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/messages`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.HELPPUFF_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'Can someone come tomorrow morning?'
  } satisfies SendMessageRequest),
});
if (!response.ok) throw new Error(((await response.json()) as ApiError).error.message);
const data = (await response.json()) as SendMessageResponse;
```
<!-- /tabs -->

**Response** `200`

<!-- tabs -->
```json [Example]
{
  "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "messages": [
    {
      "id": "m_mfx2k1",
      "ts": 1760000000000,
      "role": "agent",
      "type": "text",
      "text": "Tomorrow morning works. What is the best number to reach you on?"
    }
  ]
}
```
```ts [Type]
type SendMessageResponse = {
  id: string;
  messages: Message[];
};
```
<!-- /tabs -->

**Errors**

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | Empty or too long (`maxMessageLength`), or a form this conversation was not shown. |
| 404 | `not_found` | No conversation started over the API with this id. |
| 429 | `quota_exceeded` | The conversation reached `messagesPerSession`, or the site its daily cap. |

## Close a conversation

`POST /conversations/:id/end` · scope `chat`

Ends it for the AI backend and sends `conversation.ended` (once). It stays readable.

| Parameter | In | Required | Description |
| --- | --- | --- | --- |
| `id` | path | yes | The record's id. |

**Request**

<!-- tabs -->
```bash [curl]
curl -X POST "$HELPPUFF_URL/api/v1/conversations/ID/end" \
  -H "Authorization: Bearer $HELPPUFF_API_KEY"
```
```ts [TypeScript]
const id = '…';
const response = await fetch(`${process.env.HELPPUFF_URL}/api/v1/conversations/${id}/end`, {
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
  "id": "1b0f6a52-3c1e-4c55-9f0e-2d1c7a9e5b10",
  "ended": true
}
```
```ts [Type]
type CloseConversationResponse = {
  id: string;
  ended: boolean;
};
```
<!-- /tabs -->
