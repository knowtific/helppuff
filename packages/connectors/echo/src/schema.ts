import { z } from 'zod';

export const echoOptionsSchema = z
  .object({
    /** Greeting returned by `start`. */
    greeting: z.string().min(1).max(2000).default('Hi — this is the echo connector. Try /options, /card, /carousel, /links, /form, /slow, /long or /error.'),
    /** Artificial delay applied to every reply, for testing the typing indicator. */
    delayMs: z.number().int().min(0).max(10_000).default(0),
    /**
     * Stream text replies a word at a time, for testing streaming without a
     * paid backend. Rich messages arrive whole, as they do from a real model.
     */
    stream: z.boolean().default(false),
  })
  .default({});

export type EchoOptions = z.infer<typeof echoOptionsSchema>;
