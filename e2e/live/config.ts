import { defineConfig } from '@helppuff/server';
import demo from '../../helppuff.config.demo.js';

/**
 * The live-chat Worker's config: the committed demo site (the echo backend,
 * no keys), so it never depends on a developer's own helppuff.config.ts, and
 * allowed on any localhost port from 8780 to 8799 as well as the widget's dev
 * server: an editor forwarding :8788 from a remote machine may pick another
 * local port, and the page's Origin is whatever the browser sees.
 */
const ports = Array.from({ length: 20 }, (_, i) => 8780 + i);
const site = demo.sites['demo']!;
// One machine plays every visitor and every teammate here: the per-IP limits (live chat's hand-overs,
// the dashboard's sign-ins) would trip after a few tests.
const security = {
  ...site.security,
  limits: { ...site.security?.limits, handoversPerIpPerDay: 1000, waitingPerSite: 1000, liveSocketsPerIp: 100 },
  signIn: { ...site.security?.signIn, attemptsPerIp: 1000 },
};
const origins = [...new Set([...site.origins, 'http://localhost:5173', 'http://127.0.0.1:5173', ...ports.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`])])];

export default defineConfig({
  sites: {
    demo: {
      ...site,
      security,
      origins,
    },
    /**
     * HelpPuff's assistant with another model and knowledge base: an
     * OpenAI-compatible API (a fake one, served by this Worker at
     * `/fake-llm/v1`, its address and key passed as variables by serve.mjs)
     * and the site's own retriever (`e2e-docs`, in index.ts).
     */
    models: {
      origins,
      connector: {
        type: 'assistant',
        options: {
          instructions: 'You help Acme Plumbing.',
          provider: { type: 'openai-compatible', baseUrl: { env: 'FAKE_LLM_URL' }, apiKey: { env: 'FAKE_LLM_KEY' }, label: 'fake' },
          model: 'fake-model',
          knowledge: { type: 'custom', id: 'e2e-docs' },
        },
      },
      widget: { brand: { name: 'Acme Plumbing', agentName: 'Sam' }, leadForm: { enabled: false } },
      // The dashboard's sign-in limit is the strictest of all sites on the Worker: the same as the demo's.
      security,
    },
  },
});
