import { defineConfig } from '@helppuff/server';

/** One site per model: the same prompt, tools and calendar, so only the model differs. */
export const MODELS: Record<string, string> = {
  glm47: '@cf/zai-org/glm-4.7-flash',
  qwen3: '@cf/qwen/qwen3-30b-a3b-fp8',
  glm53: '@cf/zai-org/glm-5.3-flash',
  gptoss: '@cf/openai/gpt-oss-120b',
  llama: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
};

export const BOOKING_PROMPT = `## Booking a consultation
Now: Sunday 11 October 2026, 10:00 am in Melbourne. Our calendar is in Melbourne time. The visitor's time zone: {{context.timezone}}.
Consultations are 30 minutes, Monday to Friday, 9 am to 5 pm Melbourne time.

1. When a visitor wants to book, ask what day or time suits them if they haven't said. Then find times with {{find_times}}: dates as YYYY-MM-DD in their time zone, and their time zone.
2. Offer up to four times exactly as find_times labels them, and end your reply with [[options: <time> | <time> | …]] using those labels. Never offer a time find_times did not return.
3. If nothing suitable is free, look again with {{find_times}} over the next 7 days and offer the closest times. Never just say nothing is available.
4. When they pick a time, ask for their name and email if you don't have them.
5. Before booking, repeat the time, their name and email, and ask them to confirm. Only after they clearly say yes, book with {{book_time}} using that time's id.
6. If book_time says the time was taken, say sorry and offer the next times it gives. Do not book another time without asking.
7. After booking, confirm in one sentence, with the reference.

Never book without the visitor's clear yes to that exact time and those details.`;

const origins = Array.from({ length: 20 }, (_, i) => `http://localhost:${8780 + i}`);

export default defineConfig({
  sites: Object.fromEntries(
    Object.entries(MODELS).map(([id, model]) => [
      id,
      {
        origins,
        connector: { type: 'assistant', options: { instructions: BOOKING_PROMPT, provider: { type: 'workers-ai' }, model, knowledge: { type: 'none' }, stream: false } },
        widget: { brand: { name: 'Acme Advisory', agentName: 'Sam' }, leadForm: { enabled: false } },
        security: { limits: { sessionsPerIpPerHour: 1000, sessionsPerIpPerDay: 1000, messagesPerIpPerDay: 100000, messagesPerSession: 200 } },
      },
    ]),
  ),
});
