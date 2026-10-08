import { z } from 'zod';
import { CALLBACK_FORM, message, messageId, type ConnectorContext } from '@helppuff/connector-types';
import type { Message } from '@helppuff/protocol';
import { localTime, openNow } from './hours.js';
import type { ToolCall, ToolDef } from './chat.js';
import type { WorkersAiOptions } from './options.js';

/**
 * The assistant's tools, kept to what a small business needs:
 *
 *  - `request_callback` — the default way to a person: the team calls or
 *    emails back.
 *  - `request_person` — only when the site has live chat on: a person on the
 *    team joins this chat. The server decides whether anyone is free; if not,
 *    the visitor gets the callback form. Details the
 *    visitor already gave (the pre-chat form, an earlier callback) are reused;
 *    only what is missing is asked for, with a short form.
 *  - `get_business_hours` — the hours, the local time, and whether it is open.
 *
 * Arguments are validated before anything runs.
 */

export type Business = { name?: string; phone?: string; email?: string; address?: string; hours: string[]; serviceAreas: string[] };

/** What we already know about the visitor: from the pre-chat form or an earlier callback request. */
export type Contact = { name?: string; phone?: string; email?: string };

export type ToolEnv = {
  ctx: ConnectorContext<WorkersAiOptions>;
  business: Business;
  contact: Contact;
  now: number;
  /** Remember details the visitor gave, so they are never asked twice. */
  remember: (contact: Contact) => Promise<void>;
};

export type ToolResult = { content: string; messages: Message[] };

const callbackArgs = z
  .object({
    name: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().max(200).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .passthrough();

export const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
export const PHONE = /^[+()\-.\s\d]{6,40}$/;

export function toolDefinitions(options: WorkersAiOptions, live = false): ToolDef[] {
  const tools: ToolDef[] = [];
  if (live) {
    tools.push({
      type: 'function',
      function: {
        name: 'request_person',
        description:
          'Bring a person from the team into this chat, live. Use it when the visitor asks to talk to a person, a human or someone from the team, or when they are upset, or need something only the team can do. If nobody is free, a callback form is shown instead.',
        parameters: {
          type: 'object',
          properties: { reason: { type: 'string', description: 'What they need, in one sentence.' } },
        },
      },
    });
  }
  if (options.tools.callback) {
    tools.push({
      type: 'function',
      function: {
        name: 'request_callback',
        description:
          'Arrange for the team to call or email the visitor back: when they ask for a person, a quote, a booking, or anything you cannot answer from the passages. Pass the name, phone and email only if the visitor gave them; never invent them. If details are missing, a short form is shown to the visitor.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            reason: { type: 'string', description: 'What they need, in one sentence.' },
          },
        },
      },
    });
  }
  if (options.tools.businessHours) {
    tools.push({
      type: 'function',
      function: {
        name: 'get_business_hours',
        description: 'The opening hours, the current local time and whether the business is open right now.',
        parameters: { type: 'object', properties: {} },
      },
    });
  }
  return tools;
}

/** The callback form: only the fields still missing, plus what it is about. */
export function callbackForm(contact: Contact = {}): Message {
  const fields = [
    ...(contact.name ? [] : [{ name: 'name', label: 'Name', type: 'text' as const, required: true, autocomplete: 'name' }]),
    { name: 'phone', label: 'Phone', type: 'tel' as const, autocomplete: 'tel' },
    { name: 'email', label: 'Email', type: 'email' as const, autocomplete: 'email' },
    { name: 'message', label: 'What can we help with?', type: 'textarea' as const },
  ];
  return message({ type: 'form', title: 'Request a callback', fields, submitLabel: 'Request callback' }, { id: messageId(CALLBACK_FORM) });
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

export async function runTool(call: ToolCall, env: ToolEnv): Promise<ToolResult> {
  const args = parseArgs(call.arguments);
  switch (call.name) {
    case 'request_callback': {
      const parsed = callbackArgs.safeParse(args);
      if (!parsed.success) return { content: 'Invalid arguments.', messages: [] };
      const given = parsed.data;
      const contact: Contact = {
        ...env.contact,
        ...(given.name ? { name: given.name } : {}),
        ...(given.phone && PHONE.test(given.phone) ? { phone: given.phone } : {}),
        ...(given.email && EMAIL.test(given.email) ? { email: given.email } : {}),
      };
      if (!contact.phone && !contact.email) {
        return {
          content: 'A short callback form is now shown to the visitor. Tell them in one sentence to leave a phone number or email there.',
          messages: [callbackForm(contact)],
        };
      }
      env.ctx.reportLead?.({
        ...(contact.name ? { name: contact.name } : {}),
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(contact.email ? { email: contact.email } : {}),
        request: 'callback',
        ...(given.reason ? { message: given.reason } : {}),
      });
      await env.remember(contact);
      return {
        content: `Callback requested for ${contact.phone ?? contact.email}. Confirm briefly that the team will be in touch soon; do not ask for details again.`,
        messages: [],
      };
    }
    case 'request_person': {
      const reason = (args as { reason?: unknown } | null)?.reason;
      const outcome = env.ctx.handover ? await env.ctx.handover(typeof reason === 'string' ? reason.slice(0, 500) : undefined) : 'unavailable';
      if (outcome === 'started') {
        return { content: 'The team was notified and someone will join this chat shortly. Tell the visitor that in one short sentence; do not ask for contact details.', messages: [] };
      }
      return {
        content: 'Nobody from the team is free right now. A callback form is shown to the visitor. Tell them in one sentence to leave their details there.',
        messages: [],
      };
    }
    case 'get_business_hours': {
      const hours = env.business.hours;
      const tz = env.ctx.options.timezone;
      return {
        content: JSON.stringify({ hours: hours.length ? hours : 'not published', localTime: localTime(env.now, tz).label, openNow: openNow(hours, env.now, tz) }),
        messages: [],
      };
    }
    default:
      return { content: `Unknown tool ${call.name}.`, messages: [] };
  }
}
