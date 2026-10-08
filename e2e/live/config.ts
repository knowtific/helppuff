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

export default defineConfig({
  sites: {
    demo: {
      ...site,
      // One machine plays every visitor here: the per-visitor live-chat limits would trip after three hand-overs.
      security: { ...site.security, limits: { ...site.security?.limits, handoversPerIpPerDay: 1000, waitingPerSite: 1000, liveSocketsPerIp: 100 } },
      origins: [...new Set([...site.origins, 'http://localhost:5173', 'http://127.0.0.1:5173', ...ports.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`])])],
    },
  },
});
