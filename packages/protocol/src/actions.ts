import { z } from 'zod';
import { safeUrl } from './url-schema.js';

const id = z.string().min(1).max(64).describe('An id, unique within its list.');
const label = z.string().min(1).max(120).describe('What the button says.');

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('reply').describe('Send a message as the visitor.'), label, value: z.string().min(1).max(500).describe('The message sent.') }),
  z.object({ id, kind: z.literal('url').describe('Open a page.'), label, url: safeUrl.describe('The page to open.'), newTab: z.boolean().optional().describe('Open in a new tab.') }),
  z.object({ id, kind: z.literal('tel').describe('Call a number.'), label, phone: z.string().min(1).max(40).describe('The number to call.') }),
  z.object({ id, kind: z.literal('email').describe('Write an email.'), label, email: z.string().min(3).max(200).describe('The address to write to.') }),
  z.object({ id, kind: z.literal('flow').describe('Start one of `widget.flows`.'), label, flowId: id.describe('The flow\'s id.') }),
  z.object({ id, kind: z.literal('form').describe('Open one of `widget.forms`.'), label, formId: id.describe('The form\'s id.') }),
]).describe('What happens when the button is pressed. `kind` picks it.');

export type Action = z.infer<typeof actionSchema>;
export type ActionKind = Action['kind'];
