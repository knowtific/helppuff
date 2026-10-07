import { localFormOf, type Message, type SendRequest } from '@helppuff/protocol';
import { isCallbackForm } from '@helppuff/connector-types';
import { MAX_TOKEN_FORMS } from './token.js';

/**
 * Form submissions are honoured only for forms this chat was shown. Without
 * this, a script holding any session token could post a "callback request"
 * with someone else's phone number, or a stream of fake leads, by sending an
 * action that merely looks like a submitted form.
 *
 * Shown forms are the `form` messages the server sent (their ids ride in the
 * signed session token, so the check needs no storage) plus the site's own
 * `widget.forms`, which the widget opens under `localFormId`.
 */

/** The ids the token should carry after a reply: the earlier ones, then any form in it, latest last. */
export function offeredForms(previous: readonly string[] | undefined, messages: readonly Message[]): string[] {
  const ids = [...(previous ?? [])];
  for (const message of messages) {
    if (message.type === 'form' && !ids.includes(message.id)) ids.push(message.id);
  }
  return ids.slice(-MAX_TOKEN_FORMS);
}

/** Whether a request is a form submission: the callback form, or an action carrying a JSON object of answers. */
export function isFormSubmission(request: SendRequest): request is Extract<SendRequest, { kind: 'action' }> {
  return request.kind === 'action' && (isCallbackForm(request.actionId) || request.value.trim().startsWith('{'));
}

export function formWasOffered(actionId: string, offered: readonly string[] | undefined, configured: Record<string, unknown> | undefined): boolean {
  if (offered?.includes(actionId)) return true;
  return localFormOf(actionId, Object.keys(configured ?? {})) !== null;
}
