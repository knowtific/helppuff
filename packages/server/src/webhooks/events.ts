import { summarizeReply } from '@helppuff/connector-types';
import type { Message, SendRequest, VisitorContext } from '@helppuff/protocol';
import type { RequestCtx } from '../core/request.js';
import { emit } from './deliver.js';

/**
 * The webhook events a conversation produces, built from what the recording
 * code already has. Each is sent after the response (`emit` uses
 * `waitUntil`), so a visitor never waits on an endpoint.
 */

type LeadSource = 'form' | 'chat' | 'ai';

/** `{ name, email, phone, …custom fields }` → contact details apart from everything else the form or tool sent. */
function contactOf(lead: Record<string, string>) {
  const { name, email, phone, message, request, ...fields } = lead;
  return {
    contact: { name: name ?? null, email: email?.toLowerCase() ?? null, phone: phone ?? null },
    ...(message ? { message } : {}),
    ...(request ? { request } : {}),
    fields,
  };
}

export function leadCaptured(ctx: RequestCtx, input: { siteId: string; sessionId: string; lead: Record<string, string>; source: LeadSource }): void {
  const { contact, message, fields } = contactOf(input.lead);
  if (!contact.name && !contact.email && !contact.phone && !Object.keys(fields).length) return;
  emit(ctx, input.siteId, 'lead.captured', { conversationId: input.sessionId, source: input.source, ...contact, fields, ...(message ? { message } : {}) });
  // callback.requested is sent once the request is saved, with its id (`admin/record.ts`).
}

function sent(ctx: RequestCtx, siteId: string, sessionId: string, messages: Message[]): void {
  if (!messages.length) return;
  emit(ctx, siteId, 'message.sent', { conversationId: sessionId, text: summarizeReply(messages), messages });
}

export function conversationStarted(
  ctx: RequestCtx,
  input: {
    siteId: string;
    sessionId: string;
    lead: Record<string, string>;
    context: VisitorContext;
    firstMessage?: string | undefined;
    messages: Message[];
    country: string | null;
    typed: { email?: string; phone?: string };
    data?: Record<string, unknown> | undefined;
  },
): void {
  emit(ctx, input.siteId, 'conversation.started', {
    conversationId: input.sessionId,
    page: { url: input.context.pageUrl ?? null, title: input.context.pageTitle ?? null, referrer: input.context.referrer ?? null, utm: input.context.utm ?? null },
    locale: input.context.locale ?? null,
    country: input.country,
    form: Object.keys(input.lead).length ? input.lead : null,
    firstMessage: input.firstMessage ?? null,
    /** What the site's tools returned before the chat, by tool name. */
    data: input.data && Object.keys(input.data).length ? input.data : null,
  });
  if (input.firstMessage) {
    emit(ctx, input.siteId, 'message.received', { conversationId: input.sessionId, kind: 'text', text: input.firstMessage });
    sent(ctx, input.siteId, input.sessionId, input.messages);
  }
  const fromForm = Object.keys(input.lead).length > 0;
  if (fromForm || input.typed.email || input.typed.phone) {
    leadCaptured(ctx, { siteId: input.siteId, sessionId: input.sessionId, lead: { ...input.typed, ...input.lead }, source: fromForm ? 'form' : 'chat' });
  }
}

export function turn(
  ctx: RequestCtx,
  input: { siteId: string; sessionId: string; request: SendRequest; text: string; messages: Message[]; typed: { email?: string; phone?: string } },
): void {
  emit(ctx, input.siteId, 'message.received', {
    conversationId: input.sessionId,
    kind: input.request.kind,
    text: input.text,
    ...(input.request.kind === 'action' ? { action: { id: input.request.actionId, value: input.request.value } } : {}),
  });
  sent(ctx, input.siteId, input.sessionId, input.messages);
  if (input.typed.email || input.typed.phone) leadCaptured(ctx, { siteId: input.siteId, sessionId: input.sessionId, lead: input.typed, source: 'chat' });
}
