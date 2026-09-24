import { defineConfig } from '@murmur/server';

/**
 * The demo config, and the only one in git.
 *
 * `murmur.config.ts` — the file the Worker actually loads — is gitignored, so
 * your sites, origins and agent ids never enter the repository. It is created
 * from this file the first time you run `pnpm dev`, `pnpm build` or the tests,
 * which is what lets a fresh clone start with no setup at all.
 *
 * So: edit `murmur.config.ts`, not this file. Edit this one only to change
 * what a fresh clone gets — one site on the `echo` connector, which needs no
 * API key and drives every widget feature.
 *
 * See `murmur.config.example.ts` for the shape of a production site, and
 * `docs/deployment.md` for putting config in KV so changing it is not a
 * deploy either.
 */
export default defineConfig({
  sites: {
    demo: {
      origins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8787'],

      connector: {
        type: 'echo',
        options: {
          greeting: 'Hi — this is the echo connector. Try /options, /card, /carousel, /links, /form, /slow, /long or /error.',
          // Replies stream a word at a time, the way a model's would.
          stream: true,
        },
      },

      /*
       * Development values. The whole test suite and every playground reload
       * come from one IP, so the per-IP limits sit well above anything a real
       * visitor would reach. `murmur.config.example.ts` carries the numbers a
       * production site should actually use.
       */
      security: {
        limits: {
          messagesPerIpPerMinute: 600,
          sessionsPerIpPerHour: 1000,
          messagesPerSession: 60,
          messagesPerSitePerDay: 100_000,
          maxMessageLength: 1000,
        },
        sessionTtlHours: 24,
      },

      // No lead destination in development — a webhook pointing at a port
      // with nothing on it just logs a failure on every session. See
      // `murmur.config.example.ts` for how to configure one.
      sinks: [],

      widget: {
        brand: {
          name: 'Murmur',
          agentName: 'Echo',
          accent: '#5B5BF7',
          theme: 'auto',
        },

        launcher: {
          position: 'bottom-right',
          // Any of the 20 built-in icons (§9.6) — 'wrench', 'phone', 'heart'…
          icon: 'chat',
          shape: 'pill',
          label: 'Chat with us!',
        },

        // Whichever trigger fires first shows the bubble.
        teaser: {
          text: 'Questions? Ask away — we usually reply in a minute.',
          delayMs: 8000,
          afterScroll: 25,
          oncePerSession: true,
        },
        home: {
          title: 'Hi there',
          subtitle: 'Ask anything, or pick a shortcut.',
          links: {
            title: 'Might help',
            items: [
              { label: 'Pricing', url: 'https://example.com/pricing', description: 'What a callout costs.' },
              { label: 'Service areas', url: 'https://example.com/areas', description: 'Suburbs we cover.' },
            ],
          },
          shortcuts: [
            {
              id: 'quote',
              label: 'Get a quote',
              description: 'A few quick questions.',
              icon: 'quote',
              action: { id: 'quote', kind: 'flow', label: 'Get a quote', flowId: 'quote' },
            },
            {
              id: 'card',
              label: 'See an example card',
              description: 'Image, text and actions.',
              icon: 'book',
              action: { id: 'card', kind: 'reply', label: 'Show me a card', value: '/card' },
            },
            {
              id: 'booking',
              label: 'Book a visit',
              description: 'Opens an inline form.',
              icon: 'calendar',
              action: { id: 'booking', kind: 'form', label: 'Book a visit', formId: 'booking' },
            },
            {
              id: 'docs',
              label: 'Read the docs',
              description: 'Opens in a new tab.',
              icon: 'book',
              action: { id: 'docs', kind: 'url', label: 'Docs', url: 'https://example.com/docs' },
            },
          ],
        },
        leadForm: {
          enabled: true,
          title: 'Before we start',
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' },
            { name: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel' },
          ],
          submitLabel: 'Start chat',
          askFirstMessage: true,
        },
        chat: {
          placeholder: 'Type a message…',
          shortcuts: [
            { id: 'sc-options', label: 'Show options', action: { id: 'a1', kind: 'reply', label: 'Show options', value: '/options' } },
            { id: 'sc-card', label: 'Show a card', action: { id: 'a2', kind: 'reply', label: 'Show a card', value: '/card' } },
            { id: 'sc-quote', label: 'Get a quote', action: { id: 'a3', kind: 'flow', label: 'Get a quote', flowId: 'quote' } },
            { id: 'sc-call', label: 'Call us', action: { id: 'a4', kind: 'tel', label: 'Call us', phone: '+61400000000' } },
          ],
          fallbackContact: { phone: '+61400000000', email: 'hello@example.com' },
        },

        forms: {
          booking: {
            title: 'Book a visit',
            submitLabel: 'Request booking',
            fields: [
              { name: 'suburb', label: 'Suburb', type: 'text', required: true, placeholder: 'Richmond' },
              { name: 'when', label: 'When', type: 'select', required: true, options: ['Today', 'Tomorrow', 'This week'] },
            ],
          },
        },

        flows: [
          {
            id: 'quote',
            steps: [
              { field: 'job', ask: 'What do you need done?', input: 'text', required: true },
              { field: 'suburb', ask: 'Which suburb are you in?', input: 'text', required: true },
              { field: 'when', ask: 'When suits?', input: 'choice', choices: ['Today', 'This week', 'Just pricing'] },
            ],
            submit: { as: 'message', template: "I'd like a quote for {{job}} in {{suburb}}, {{when}}." },
          },
        ],
      },
    },
  },
});
