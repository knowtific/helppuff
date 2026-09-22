import { z } from 'zod';

export const echoOptionsSchema = z
  .object({
    /** Greeting returned by `start`. */
    greeting: z.string().min(1).max(2000).default('Hi — this is the echo connector. Try /options, /card, /carousel, /links, /form, /slow, /long or /error.'),
    /** Artificial delay applied to every reply, for testing the typing indicator. */
    delayMs: z.number().int().min(0).max(10_000).default(0),
  })
  .default({});

export type EchoOptions = z.infer<typeof echoOptionsSchema>;
