import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The website's pictures of the widget: real screenshots of the production
 * bundle, not mock-ups, so they are only ever as good as the widget is.
 *
 *   pnpm build:playground && pnpm --filter @helppuff/website screenshots
 *
 * Each shot boots the playground's preview page with a setup in its URL,
 * talks to it through `showcase.ts`'s scripted answers, and crops the
 * widget on a transparent background. Output: `website/public/shots/`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '../../packages/widget/dist-playground');
const out = join(here, '../public/shots');
if (!existsSync(join(site, 'preview.html'))) {
  console.error('Build the playground first: pnpm build:playground');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(site, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const origin = `http://localhost:${server.address().port}`;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const previewUrl = (setup) => `${origin}/preview.html?demo=showcase&setup=${encode({ stream: false, open: true, ...setup })}`;

/** Hide the stand-in page so only the widget, and its shadow, is captured. */
const ISOLATE = 'html, body { background: transparent !important; } body > :not(helppuff-widget) { visibility: hidden !important; }';

const browser = await chromium.launch();

async function shot(name, { widget, viewport = { width: 1280, height: 900 }, mobile = false, transparent = true, steps }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: mobile ? 3 : 2, isMobile: mobile, hasTouch: mobile });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: widget.brand?.theme === 'dark' ? 'dark' : 'light' });
  await page.goto(previewUrl({ widget, open: !widget.teaser }), { waitUntil: 'networkidle' });
  if (transparent) await page.addStyleTag({ content: ISOLATE });
  const w = (selector) => page.locator(`helppuff-widget ${selector}`);
  await steps?.(w, page);
  // Opening on load focuses the close button; a focus ring is not part of the look.
  await page.evaluate(() => {
    let node = document.activeElement;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
    if (node instanceof HTMLElement) node.blur();
  });
  await page.waitForTimeout(900);

  const file = join(out, `${name}.png`);
  if (!transparent) {
    await page.screenshot({ path: file });
  } else {
    const boxes = [];
    for (const selector of ['.hp-panel', '.hp-orb', '.hp-teaser']) {
      const box = await w(selector).first().boundingBox().catch(() => null);
      if (box && (await w(selector).first().isVisible())) boxes.push(box);
    }
    const pad = 40;
    const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
    const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
    const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
    const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
    await page.screenshot({ path: file, omitBackground: true, clip: { x, y, width: right - x, height: bottom - y } });
  }
  console.log(`  ✓ ${name}.png`);
  await page.close();
}

const startChat = async (w) => {
  await w('.hp-panel').waitFor();
  await w('.hp-btn').last().click();
};
const ask = async (w, page, question) => {
  await w('.hp-composer textarea').fill(question);
  await w('.hp-send').click();
  await page.waitForTimeout(1200);
};

const plumbing = {
  brand: { name: 'Harbour Plumbing', agentName: 'Sam', accent: '#5B5BF7', theme: 'light' },
  launcher: { icon: 'chat', shape: 'orb' },
  leadForm: { enabled: false },
  chat: { initialMessages: ['Hi, I’m Sam from Harbour Plumbing. How can I help today?'], placeholder: 'Ask about prices, bookings…' },
};

await shot('chat-light', {
  widget: plumbing,
  steps: async (w, page) => {
    await startChat(w);
    await ask(w, page, 'How much is a blocked drain?');
  },
});

await shot('card-dark', {
  widget: {
    ...plumbing,
    brand: { name: 'Northside Plumbing', agentName: 'Jess', accent: '#F97316', theme: 'dark', tokens: { 'radius-panel': '18px' } },
    chat: { initialMessages: ['Hey, I’m Jess. Burst pipe, blocked drain, or just a quote?'] },
  },
  steps: async (w, page) => {
    await startChat(w);
    await ask(w, page, 'Do you do emergency callouts?');
  },
});

await shot('home-teal', {
  widget: {
    brand: { name: 'Harbour Physio', agentName: 'Mia', accent: '#0F766E', theme: 'light', tokens: { font: 'Georgia, "Times New Roman", serif' } },
    home: {
      title: 'Welcome to Harbour Physio',
      subtitle: 'Ask about treatments, or book a session.',
      shortcuts: [
        { id: 'book', label: 'Book a session', description: 'See this week’s openings.', icon: 'calendar', action: { id: 'b', kind: 'reply', label: 'Book a session', value: 'book' } },
        { id: 'price', label: 'Prices', description: 'Consults from $95.', icon: 'quote', action: { id: 'p', kind: 'reply', label: 'Prices', value: 'price' } },
        { id: 'call', label: 'Call the clinic', description: 'Mon–Sat, 7am–7pm.', icon: 'phone', action: { id: 'c', kind: 'tel', label: 'Call', phone: '+61400000000' } },
        { id: 'find', label: 'Find us', description: '12 Wharf St, Balmain.', icon: 'pin', action: { id: 'f', kind: 'url', label: 'Map', url: 'https://example.com/map' } },
      ],
      links: { title: 'Popular', items: [{ label: 'Sports injuries', url: 'https://example.com/sports', description: 'Assessment and rehab plans.' }] },
    },
    leadForm: { enabled: false },
  },
});

await shot('lead-form', {
  widget: {
    brand: { name: 'Bloom & Co', agentName: 'Ivy', accent: '#DB2777', theme: 'light', tokens: { 'radius-panel': '22px' } },
    home: { title: 'Fresh flowers, same day', subtitle: 'Ask us anything about orders and delivery.' },
    leadForm: {
      enabled: true,
      title: 'So we can follow up',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' },
        { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
        { name: 'occasion', label: 'Occasion', type: 'select', options: ['Birthday', 'Anniversary', 'Sympathy', 'Just because'] },
      ],
      submitLabel: 'Start chat',
      privacy: { text: 'We only use this to reply to you.', url: 'https://example.com/privacy' },
      askFirstMessage: true,
    },
  },
  steps: async (w) => {
    await startChat(w);
    await w('form input').first().fill('Ada Lovelace');
    await w('form input[type="email"]').fill('ada@example.com');
  },
});

await shot('teaser', {
  widget: {
    brand: { name: 'Harbour Plumbing', agentName: 'Sam', accent: '#5B5BF7', theme: 'light' },
    launcher: { icon: 'chat', shape: 'pill', label: 'Chat with us' },
    teaser: { text: 'Need a plumber today? Ask me for a quote in seconds.', delayMs: 2000 },
  },
  steps: async (w) => {
    await w('.hp-teaser').waitFor({ timeout: 8000 });
  },
});

await shot('mobile', {
  mobile: true,
  transparent: false,
  viewport: { width: 390, height: 780 },
  widget: { ...plumbing, brand: { ...plumbing.brand, accent: '#7C3AED' } },
  steps: async (w, page) => {
    await startChat(w);
    await ask(w, page, 'Do you do emergency callouts?');
    await ask(w, page, 'What services do you offer?');
  },
});

// The playground itself, for the "make it yours" section.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 }, deviceScaleFactor: 2 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`${origin}/#p=trades`, { waitUntil: 'networkidle' });
  const frame = page.frameLocator('iframe[title="Widget preview"]');
  await frame.locator('helppuff-widget .hp-orb').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, 'playground.png') });
  console.log('  ✓ playground.png');
  await page.close();
}

await browser.close();
server.close();
