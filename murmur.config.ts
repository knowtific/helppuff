import { defineConfig } from '@murmur/server';

/**
 * The development config: one site on the `echo` connector, which needs no
 * API key and can drive every widget feature. `scripts/setup.sh` rewrites this
 * file for a real deployment — see `murmur.config.example.ts` for the shape of
 * a production site.
 */
export default defineConfig({
  sites: {
    demo: {
      origins: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8787'],

      connector: {
        type: 'echo',
        options: {
          greeting: 'Hi — this is the echo connector. Try /options, /card, /carousel, /links, /form, /slow, /long or /error.',
        },
      },

      security: {
        limits: {
          messagesPerIpPerMinute: 30,
          sessionsPerIpPerHour: 60,
          messagesPerSession: 60,
          messagesPerSitePerDay: 2000,
          maxMessageLength: 1000,
        },
        sessionTtlHours: 24,
      },

      widget: {
        brand: {
          name: 'Murmur',
          agentName: 'Echo',
          accent: '#5B5BF7',
          theme: 'auto',
        },
        home: {
          title: 'Hi there',
          subtitle: 'Ask anything, or pick a shortcut.',
          shortcuts: [
            {
              id: 'quote',
              label: 'Get a quote',
              description: 'A few quick questions.',
              icon: 'quote',
              action: { id: 'quote', kind: 'reply', label: 'Get a quote', value: '/options' },
            },
            {
              id: 'card',
              label: 'See an example card',
              description: 'Image, text and actions.',
              icon: 'book',
              action: { id: 'card', kind: 'reply', label: 'Show me a card', value: '/card' },
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
          fallbackContact: { phone: '+61400000000', email: 'hello@example.com' },
        },
      },
    },
  },
});
