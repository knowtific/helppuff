import { defineConfig } from '@murmur/server';

/**
 * A production example. Copy over `murmur.config.ts`, adjust, then run
 * `pnpm deploy:worker`. Secrets are referenced by environment variable name and set
 * with `wrangler secret put` — never written here.
 */
/*
 * Swapping backends is a change to `connector` and nothing else — the widget
 * never learns which one is behind it.
 *
 *   // Gemini with File Search, as the RAG layer:
 *   connector: {
 *     type: 'gemini',
 *     options: {
 *       apiKey: { env: 'GEMINI_API_KEY' },
 *       model: 'gemini-3-flash',
 *       fileSearchStores: ['fileSearchStores/knowtific-kb'],
 *       // Edited live in KV, so changing it is not a deploy.
 *       systemInstruction: { kv: 'prompt:knowtific' },
 *     },
 *   },
 *
 *   // OpenAI, with the prompt stored and versioned on their side:
 *   connector: {
 *     type: 'openai',
 *     options: {
 *       apiKey: { env: 'OPENAI_API_KEY' },
 *       model: 'gpt-5',
 *       promptRef: { id: 'pmpt_abc123', version: '4' },
 *     },
 *   },
 *
 *   // DeepSeek, or anything else speaking the OpenAI wire format:
 *   connector: {
 *     type: 'openai',
 *     options: {
 *       apiKey: { env: 'DEEPSEEK_API_KEY' },
 *       baseUrl: 'https://api.deepseek.com/v1',
 *       model: 'deepseek-chat',
 *       instructions: { url: 'https://cms.example.com/prompt.txt' },
 *     },
 *   },
 *
 * See docs/prompts.md for where a prompt belongs, and docs/connectors.md for
 * the verified API references behind each of these.
 */
export default defineConfig({
  sites: {
    knowtific: {
      origins: ['https://knowtific.com', 'https://www.knowtific.com', 'http://localhost:3000'],

      connector: {
        type: 'retell',
        options: {
          apiKey: { env: 'RETELL_API_KEY' },
          agentId: 'agent_xxx',
          dynamicVariables: {
            customer_name: '{{lead.name}}',
            customer_phone: '{{lead.phone}}',
            page_url: '{{context.pageUrl}}',
          },
        },
      },

      sinks: [{ type: 'webhook', options: { url: { env: 'LEAD_WEBHOOK_URL' } } }],

      security: {
        captcha: { provider: 'turnstile', siteKey: '0x4AAA...', secret: { env: 'TURNSTILE_SECRET' } },
        limits: {
          messagesPerIpPerMinute: 10,
          sessionsPerIpPerHour: 5,
          messagesPerSession: 60,
          messagesPerSitePerDay: 500,
          maxMessageLength: 1000,
        },
        sessionTtlHours: 24,
      },

      widget: {
        brand: { name: 'Knowtific', agentName: 'Alex', accent: '#5B5BF7', theme: 'auto' },
        launcher: { position: 'bottom-right', label: 'Ask us' },
        home: {
          title: 'Hi there',
          subtitle: 'Ask anything, or pick a shortcut.',
          shortcuts: [
            {
              id: 'quote',
              label: 'Get a quote',
              description: 'Three quick questions.',
              icon: 'quote',
              action: { id: 'quote', kind: 'flow', label: 'Get a quote', flowId: 'quote' },
            },
          ],
          links: {
            title: 'Might help',
            items: [{ label: 'Pricing', url: 'https://knowtific.com/pricing', description: 'What it costs.' }],
          },
        },
        leadForm: {
          enabled: true,
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' },
            { name: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel' },
            { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
          ],
          submitLabel: 'Start chat',
          privacy: { text: 'We only use this to reply to you.', url: 'https://knowtific.com/privacy' },
          askFirstMessage: true,
        },
        chat: {
          placeholder: 'Type a message…',
          fallbackContact: { phone: '+61400000000', email: 'hello@knowtific.com' },
        },
        teaser: { text: 'Questions? Ask away.', delayMs: 8000, oncePerSession: true },
        flows: [
          {
            id: 'quote',
            steps: [
              { field: 'job', ask: 'What do you need done?', input: 'text', required: true },
              { field: 'suburb', ask: 'Which suburb?', input: 'text', required: true },
              { field: 'when', ask: 'When suits?', input: 'choice', choices: ['Today', 'This week', 'Just pricing'] },
            ],
            submit: { as: 'message', template: "I'd like a quote for {{job}} in {{suburb}}, {{when}}." },
          },
        ],
        captcha: { provider: 'turnstile', siteKey: '0x4AAA...' },
      },
    },
  },
});
