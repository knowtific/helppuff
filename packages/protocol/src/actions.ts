import { z } from 'zod';
import { safeUrl } from './url-schema.js';

const id = z.string().min(1).max(64);
const label = z.string().min(1).max(120);

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('reply'), label, value: z.string().min(1).max(500) }),
  z.object({ id, kind: z.literal('url'), label, url: safeUrl, newTab: z.boolean().optional() }),
  z.object({ id, kind: z.literal('tel'), label, phone: z.string().min(1).max(40) }),
  z.object({ id, kind: z.literal('email'), label, email: z.string().min(3).max(200) }),
  z.object({ id, kind: z.literal('flow'), label, flowId: id }),
  z.object({ id, kind: z.literal('form'), label, formId: id }),
]);

export type Action = z.infer<typeof actionSchema>;
export type ActionKind = Action['kind'];
