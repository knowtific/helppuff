import type { Message } from '@murmur/protocol';
import { OWNER_HEADER, ownerToken } from '@murmur/server';
import { CliError } from '../errors.js';

/**
 * Talk to a deployed (or local) assistant through the real protocol — the
 * same requests the widget makes — so a passing `murmur chat` means a
 * visitor would get the same answer.
 *
 * A conversation continues by passing the returned `session` token back.
 */

export type ChatTurn = {
  session: string;
  sessionId: string;
  messages: Message[];
  /** The reply flattened to text, for a quick read. */
  reply: string;
};

type Field = { name: string; type?: string; required?: boolean };

const SAMPLE: Record<string, string> = {
  email: 'test@example.com',
  tel: '+10000000000',
  number: '1',
  url: 'https://example.com',
};

/** Values for a lead form, so a site that requires one can still be tested. */
function sampleLead(fields: Field[]): Record<string, string> {
  const lead: Record<string, string> = {};
  for (const field of fields) {
    if (!field.required) continue;
    lead[field.name] = SAMPLE[field.type ?? 'text'] ?? (field.name === 'name' ? 'Murmur Test' : 'test');
  }
  return lead;
}

async function call(doFetch: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await doFetch(url, init);
  } catch (thrown) {
    throw new CliError('unreachable', `Could not reach ${new URL(url).origin}: ${(thrown as Error).message}`, {
      hint: 'Is it deployed (`murmur status`)? For a local server, run `murmur dev` first.',
    });
  }
}

async function envelope(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return body;
  const error = (body['error'] ?? {}) as { code?: string; message?: string };
  const hints: Record<string, string> = {
    forbidden_origin: 'The origin is not allowed. Redeploy with `murmur deploy` so the preview origin is added.',
    captcha_failed: 'Turnstile is on for this site, so scripted chats are refused. Test in the preview page instead.',
    not_found: 'Unknown site id — check `site` in murmur.json, then `murmur deploy`.',
    connector_error: 'The backend failed. `murmur doctor` checks its keys and knowledge.',
    internal: 'Usually a missing secret. `murmur doctor` lists what the Worker is missing.',
    rate_limited: 'Rate limited — wait a minute and try again.',
  };
  throw new CliError(`chat_${error.code ?? response.status}`, `The assistant answered ${response.status}: ${error.message ?? 'no message'}`, {
    ...(error.code && hints[error.code] ? { hint: hints[error.code] } : {}),
  });
}

export function flatten(messages: Message[]): string {
  return messages
    .map((m) => {
      switch (m.type) {
        case 'text':
        case 'notice':
          return m.text;
        case 'options':
          return `${m.text ? `${m.text}\n` : ''}[choices: ${m.options.map((o) => o.label).join(' | ')}]`;
        case 'card':
          return `[card: ${m.title}${m.body ? ` — ${m.body}` : ''}]`;
        case 'carousel':
          return `[cards: ${m.cards.map((c) => c.title).join(' | ')}]`;
        case 'links':
          return `[links: ${m.links.map((l) => `${l.label} <${l.url}>`).join(' | ')}]`;
        case 'form':
          return `[form: ${m.fields.map((f) => f.label).join(', ')}]`;
      }
    })
    .join('\n\n');
}

export async function chat(input: {
  url: string;
  site: string;
  origin: string;
  message: string;
  session?: string | undefined;
  /** MURMUR_SECRET, when known: proves this is the owner testing, exempt from per-IP limits. */
  secret?: string | undefined;
  fetch?: typeof fetch;
}): Promise<ChatTurn> {
  const doFetch = input.fetch ?? fetch;
  const base = input.url.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: input.origin,
    ...(input.secret && input.secret.length >= 32 ? { [OWNER_HEADER]: await ownerToken(input.secret) } : {}),
  };

  if (input.session) {
    const response = await call(doFetch, `${base}/v1/sessions/messages`, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${input.session}` },
      body: JSON.stringify({ kind: 'text', text: input.message, clientId: `cli-${Date.now()}` }),
    });
    const body = await envelope(response);
    const messages = (body['messages'] ?? []) as Message[];
    const session = response.headers.get('X-Murmur-Token') ?? input.session;
    return { session, sessionId: sessionIdOf(session), messages, reply: flatten(messages) };
  }

  const config = await envelope(await call(doFetch, `${base}/v1/sites/${input.site}/config`, { headers }));
  const leadForm = (config['widget'] as { leadForm?: { enabled?: boolean; fields?: Field[] } } | undefined)?.leadForm;
  const lead = leadForm?.enabled ? sampleLead(leadForm.fields ?? []) : undefined;

  const response = await call(doFetch, `${base}/v1/sites/${input.site}/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      context: { pageUrl: `${input.origin}/`, pageTitle: 'murmur chat (CLI test)' },
      firstMessage: input.message,
      ...(lead ? { lead } : {}),
    }),
  });
  const body = await envelope(response);
  const messages = (body['messages'] ?? []) as Message[];
  const session = String(body['sessionToken'] ?? '');
  return { session, sessionId: String(body['sessionId'] ?? sessionIdOf(session)), messages, reply: flatten(messages) };
}

function sessionIdOf(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8')) as { sid?: string; sessionId?: string };
    return payload.sid ?? payload.sessionId ?? '';
  } catch {
    return '';
  }
}
