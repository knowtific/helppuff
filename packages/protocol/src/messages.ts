import { z } from 'zod';
import { actionSchema } from './actions.js';
import { httpUrl, safeUrl } from './url-schema.js';

export const roleSchema = z.enum(['user', 'agent', 'system']);
export type Role = z.infer<typeof roleSchema>;

/** Optional connector-supplied display metadata (agent identity). */
export const messageMetaSchema = z
  .object({
    agentName: z.string().min(1).max(80).optional(),
    avatar: httpUrl.optional(),
  })
  .strict();

const base = {
  id: z.string().min(1).max(64),
  ts: z.number().int().nonnegative(),
  role: roleSchema,
  meta: messageMetaSchema.optional(),
};

export const optionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
});
export type Option = z.infer<typeof optionSchema>;

export const imgSchema = z.object({
  src: httpUrl,
  alt: z.string().max(200),
  aspect: z.enum(['1:1', '16:9', '4:3']).optional(),
});
export type Img = z.infer<typeof imgSchema>;

export const cardItemSchema = z.object({
  title: z.string().min(1).max(160),
  body: z.string().max(600).optional(),
  image: imgSchema.optional(),
  actions: z.array(actionSchema).max(3).optional(),
});
export type CardItem = z.infer<typeof cardItemSchema>;

export const linkItemSchema = z.object({
  label: z.string().min(1).max(160).describe('The link text.'),
  url: safeUrl.describe('Where it goes (https).'),
  description: z.string().max(300).optional().describe('A line under the link.'),
});
export type LinkItem = z.infer<typeof linkItemSchema>;

export const fieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .describe('The key the answer is stored under. `name`, `email`, `phone` and `message` mean something to the assistant (a `message` opens the chat).'),
  label: z.string().min(1).max(160).describe('What the visitor sees.'),
  type: z.enum(['text', 'email', 'tel', 'textarea', 'select']).describe('The kind of input. `select` needs `options`.'),
  required: z.boolean().optional().describe('Must be filled in.'),
  placeholder: z.string().max(160).optional().describe('Hint text inside the empty field.'),
  options: z.array(z.string().min(1).max(120)).max(50).optional().describe('The choices of a `select`.'),
  pattern: z.string().max(200).optional().describe('A regular expression the answer must match.'),
  autocomplete: z.string().max(64).optional().describe('The HTML autocomplete hint, e.g. `email`, `tel`.'),
});
export type Field = z.infer<typeof fieldSchema>;

export const messageSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('text'), text: z.string().min(1).max(8000) }),
  z.object({
    ...base,
    type: z.literal('notice'),
    text: z.string().min(1).max(600),
    tone: z.enum(['info', 'warn']).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('options'),
    text: z.string().max(2000).optional(),
    options: z.array(optionSchema).min(1).max(10),
    multi: z.boolean().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('card'),
    title: z.string().min(1).max(160),
    body: z.string().max(600).optional(),
    image: imgSchema.optional(),
    actions: z.array(actionSchema).max(3).optional(),
  }),
  z.object({ ...base, type: z.literal('carousel'), cards: z.array(cardItemSchema).min(1).max(10) }),
  z.object({
    ...base,
    type: z.literal('links'),
    title: z.string().max(160).optional(),
    links: z.array(linkItemSchema).min(1).max(10),
  }),
  z.object({
    ...base,
    type: z.literal('form'),
    title: z.string().max(160).optional(),
    fields: z.array(fieldSchema).min(1).max(12),
    submitLabel: z.string().max(60).optional(),
  }),
]);

export type Message = z.infer<typeof messageSchema>;
export type MessageType = Message['type'];

export const messagesSchema = z.array(messageSchema).max(20);

/**
 * Drop anything a connector returned that does not satisfy the protocol.
 * Returns the surviving messages plus the indexes that were dropped so
 * the caller can log a count without logging content.
 */
export function sanitizeMessages(input: unknown): { messages: Message[]; dropped: number } {
  if (!Array.isArray(input)) return { messages: [], dropped: 0 };
  const messages: Message[] = [];
  let dropped = 0;
  for (const candidate of input.slice(0, 20)) {
    const result = messageSchema.safeParse(candidate);
    if (result.success) messages.push(result.data);
    else dropped += 1;
  }
  return { messages, dropped };
}

/**
 * `Omit` distributed over the message union, so a helper can accept "a message
 * without its envelope fields" for any variant.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A message's payload, without the `id`/`ts`/`role` envelope. */
export type MessageBody = DistributiveOmit<Message, 'id' | 'ts' | 'role' | 'meta'>;
