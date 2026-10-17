<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { withBase } from 'vitepress';
import Zoom from './Zoom.vue';

/**
 * The landing page. Every picture of the widget is a real screenshot
 * (`scripts/screenshots.mjs`) and the demo is the real widget, answered in the
 * page by the playground's scripted showcase, so nothing here is a mock-up.
 */

const REPO = 'https://github.com/knowtific/helppuff';
const shot = (name: string) => withBase(`/shots/${name}.png`);
/** The live demos a screenshot can open, always in a new tab. */
const WIDGET_DEMO = { href: withBase('/playground/'), label: 'Open the live demo' };
const dashDemo = (route: string) => ({ href: withBase(`/dashboard-demo/#/${route}`), label: 'Open the live demo' });
const docs = (page: string) => withBase(`/docs/${page}`);

// ---------------------------------------------------------------------------
// Copy-to-clipboard for the install command and the agent prompt

const INSTALL = 'npx @knowtific/helppuff';
const AGENT_PROMPT =
  'Follow the HelpPuff instructions at https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md and set up HelpPuff in this folder. Complete setup automatically with the recommended free defaults. Ask me only for information you cannot determine safely or authorization I must complete. Continue until it is deployed, added to the website when possible, tested with real questions, and you have given me the dashboard, embed and preview links.';
/** What people ask their agent once it is set up: each one a setting or a command it already has. */
const ASKS = [
  'Make the chat button orange and call the assistant Sam.',
  'Don’t ask for details before the chat starts.',
  'Never quote prices; offer a callback instead.',
  'Turn on live chat so my team can answer.',
  'When someone asks where their order is, check our order API.',
  'Go through my HelpPuff settings with me.',
];
const copied = ref('');
// The tour on YouTube: a thumbnail until clicked, so the page stays fast and YouTube loads only for people who play it.
const TOUR = 'OhpyStdl-js';
const tourPlaying = ref(false);
function copy(text: string, key: string) {
  void navigator.clipboard?.writeText(text).then(() => {
    copied.value = key;
    setTimeout(() => (copied.value = ''), 1600);
  });
}

// ---------------------------------------------------------------------------
// The live demo: the playground's preview page, configured by its URL

const shortcuts = [
  { id: 'price', label: 'Prices', description: 'Callouts from $180.', icon: 'quote', action: { id: 'p', kind: 'reply', label: 'How much is a blocked drain?', value: 'How much is a blocked drain?' } },
  { id: 'urgent', label: 'Emergencies', description: '24/7, within the hour.', icon: 'clock', action: { id: 'e', kind: 'reply', label: 'Do you do emergency callouts?', value: 'Do you do emergency callouts?' } },
  { id: 'services', label: 'Services', description: 'Drains, hot water, leaks.', icon: 'wrench', action: { id: 's', kind: 'reply', label: 'What services do you offer?', value: 'What services do you offer?' } },
  { id: 'call', label: 'Call us', description: 'Talk to a plumber.', icon: 'phone', action: { id: 'c', kind: 'tel', label: 'Call us', phone: '+61400000000' } },
];

const LOOKS = [
  {
    id: 'light',
    label: 'Indigo, light',
    widget: { brand: { name: 'Harbour Plumbing', agentName: 'Sam', accent: '#5B5BF7', theme: 'light' }, launcher: { shape: 'pill', label: 'Ask Sam' } },
  },
  {
    id: 'dark',
    label: 'Orange, dark',
    widget: { brand: { name: 'Harbour Plumbing', agentName: 'Jess', accent: '#F97316', theme: 'dark', tokens: { 'radius-panel': '18px' } }, launcher: { icon: 'wrench', shape: 'orb' } },
  },
  {
    id: 'soft',
    label: 'Teal, serif',
    widget: {
      brand: { name: 'Harbour Plumbing', agentName: 'Mia', accent: '#0F766E', theme: 'light', tokens: { font: 'Georgia, "Times New Roman", serif', 'radius-panel': '32px' } },
      launcher: { icon: 'chat', shape: 'pill', label: 'Questions?' },
    },
  },
];

const look = ref(LOOKS[0]!.id);
const mounted = ref(false);
onMounted(() => (mounted.value = true));

function encode(value: unknown): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const demoSrc = computed(() => {
  const chosen = LOOKS.find((l) => l.id === look.value) ?? LOOKS[0]!;
  const widget = {
    ...chosen.widget,
    home: { title: 'Hi, how can we help?', subtitle: 'Prices, bookings and emergencies, any time.', shortcuts },
    leadForm: { enabled: false },
    chat: { initialMessages: ['Hi! Ask me about prices, bookings or an emergency.'], placeholder: 'Ask about prices, bookings…', fallbackContact: { phone: '+61400000000' } },
  };
  return withBase(`/playground/preview.html?demo=showcase&open=1&setup=${encode({ widget })}`);
});

// ---------------------------------------------------------------------------
// Content

const STATS = [
  { value: '$0', label: 'to start, on Cloudflare’s Workers Free plan' },
  { value: '~300', label: 'typical AI answers a day within the free allowance' },
  { value: '~41 KB', label: 'gzipped in all: a 6 KB loader, then the chat once your page is idle' },
  { value: '1', label: 'prompt to your AI agent to set up, deploy and test it' },
];

type Cell = boolean | string;
const COMPARE: { row: string; hosted: Cell; diy: Cell; us: Cell }[] = [
  { row: 'Monthly subscription', hosted: 'Per seat or per message', diy: 'Your hosting bill', us: 'None. Free plan to start' },
  { row: 'Where conversations and leads live', hosted: 'Their platform', diy: 'Wherever you build it', us: 'Your Cloudflare account' },
  { row: 'Learns your website and files', hosted: 'Often a paid tier', diy: 'You build retrieval', us: true },
  { row: 'Lead capture and CRM dashboard', hosted: 'Higher plans', diy: 'You build it', us: true },
  { row: 'Live chat with your team', hosted: 'Higher plans', diy: 'You build it', us: true },
  { row: 'Quotes and jobs board', hosted: 'A separate tool', diy: 'You build it', us: true },
  { row: 'Choose the AI model and knowledge base', hosted: false, diy: true, us: 'Any, one command each' },
  { row: 'Servers to patch', hosted: false, diy: 'Yes', us: false },
  { row: 'Set up by your coding agent', hosted: false, diy: false, us: true },
  { row: 'Open source', hosted: false, diy: true, us: 'MIT' },
];

const FEATURES = [
  { icon: 'book', title: 'Learns your website and files', text: 'Crawls the pages you choose and reads PDF, Word, Markdown and text files. Hybrid semantic and keyword search finds the right passage.', link: 'Knowledge-Base' },
  { icon: 'message', title: 'Rich conversations', text: 'Streaming replies, suggested questions, option chips, cards, carousels, links and forms, right inside the chat.', link: 'Widget' },
  { icon: 'form', title: 'Pre-chat and inline forms', text: 'Ask for a name, phone, email or anything custom before the chat, with the fields and wording you choose.', link: 'Leads' },
  { icon: 'users', title: 'Built-in CRM', text: 'One contact per person across repeat chats: company, address, custom attributes, private notes, labels and CSV export.', link: 'Leads' },
  { icon: 'headset', title: 'Live chat with your team', text: 'Hand any chat to a person, answered from the dashboard or Telegram, with alerts and sounds. Nobody free? The callback form.', link: 'Live-Chat' },
  { icon: 'briefcase', title: 'Quotes and jobs', text: 'Requests from the chat or a “Get a quote” button land on a board with your own stages, set up from your website by the AI.', link: 'Jobs' },
  { icon: 'calendar', title: 'Booking in the chat', text: 'Visitors pick a free time in a calendar in the chat and HelpPuff books it, synced with Cal.com, Calendly, Google Calendar or Outlook. Or just offer your booking link.', link: 'Bookings' },
  { icon: 'wrench', title: 'Your APIs as tools', text: 'Paste a curl and the assistant can check an order or a booking. Look visitors up before the chat, and send each finished chat to your CRM.', link: 'Tools' },
  { icon: 'sparkles', title: 'Conversation intelligence', text: 'Automatic summaries with intent, sentiment, lead quality, outcome, topics, next steps and unanswered questions.', link: 'Dashboard#conversations' },
  { icon: 'phone', title: 'Callback requests', text: '“Please call me” becomes a task your team can complete, dismiss or reopen.', link: 'Leads#callbacks' },
  { icon: 'chart', title: 'Analytics and ratings', text: 'Conversation and lead trends, conversion, top pages, countries and thumbs-up feedback.', link: 'Dashboard#analytics' },
  { icon: 'webhook', title: 'Signed webhooks', text: 'Send leads, callbacks, summaries and ratings to Zapier, Make, n8n, your CRM or your API, with retries.', link: 'Webhooks' },
  { icon: 'shield', title: 'Safety and cost controls', text: 'Origin allowlists, signed sessions, daily budgets, rate limits, optional Turnstile and graceful fallbacks.', link: 'Security' },
  { icon: 'zap', title: 'Fast and isolated', text: 'A shadow-root widget your CSS cannot break and that cannot break your page. Accessible and mobile-first.', link: 'Widget' },
  { icon: 'plug', title: 'Any model', text: 'Workers AI free by default, or OpenAI, Gemini, Claude, DeepSeek, OpenRouter, any OpenAI-compatible API, or your own code.', link: 'Models-and-Providers' },
  { icon: 'database', title: 'Any knowledge base', text: 'Your site and files by default, or Cloudflare AI Search, an OpenAI vector store, your own search API or your own code.', link: 'Providers' },
  { icon: 'refresh', title: 'Safe upgrades', text: 'Additive database migrations, compatibility checks, restore points and downgrade protection.', link: 'Upgrading' },
];

const DASH_TABS = [
  { id: 'conversation', label: 'Conversations', caption: 'Every chat summarised and labelled: intent, sentiment, lead quality, next step, and the questions it could not answer.' },
  { id: 'live', label: 'Live chat', caption: 'A visitor asked for a person: see who is waiting and for how long, take the chat, reply, or hand it back to the assistant.' },
  { id: 'jobs', label: 'Jobs', caption: 'Quote requests and work on a board with your own stages: drag to move, spot what has gone stale, and every update in its history.' },
  { id: 'calendar', label: 'Calendar', caption: 'Every appointment by month, week or day: booked in the chat, added by hand, or read from your synced calendar, each on its job.' },
  { id: 'leads', label: 'Contacts', caption: 'One contact per person across repeat chats, moved from new to won, with notes, attributes and CSV export.' },
  { id: 'callbacks', label: 'Callbacks', caption: '“Please call me” becomes a task: tap to call, mark it done with a note, or dismiss it.' },
  { id: 'analytics', label: 'Analytics', caption: 'Conversations, leads and conversion against the previous period, top pages, countries and the latest questions.' },
  { id: 'knowledge', label: 'Knowledge', caption: 'What it learned from your site, the files you gave it, your own answers, and a box to test any question.' },
];
const dashTab = ref(DASH_TABS[0]!.id);
const dashCaption = computed(() => DASH_TABS.find((t) => t.id === dashTab.value)?.caption ?? '');
/** The demo's route for a tab: the screenshot names a single conversation, the dashboard calls the page `conversations`. */
const dashRoute = computed(() => (dashTab.value === 'conversation' || dashTab.value === 'live' ? 'conversations' : dashTab.value));

const STACK = [
  { name: 'Workers', role: 'Chat API, widget and dashboard from one deployment' },
  { name: 'Workers AI', role: 'Answers, summaries, embeddings and reranking' },
  { name: 'D1', role: 'Conversations, leads, CRM, analytics and knowledge text' },
  { name: 'Vectorize', role: 'Finds passages by meaning' },
  { name: 'KV', role: 'Live configuration and prompt updates' },
  { name: 'Workflows + Cron', role: 'Crawls, file learning, summaries, retries, and re-learning on a schedule' },
  { name: 'Durable Objects', role: 'Live chat between visitors and your team' },
  { name: 'Rate Limiting', role: 'Protects the public chat endpoint' },
];

const MODELS = [
  { name: 'Workers AI', note: 'default, no key', page: 'Provider-Workers-AI' },
  { name: 'OpenAI', page: 'Models-and-Providers' },
  { name: 'Gemini', page: 'Models-and-Providers' },
  { name: 'Claude', page: 'Models-and-Providers' },
  { name: 'DeepSeek, OpenRouter, Groq…', page: 'Models-and-Providers' },
  { name: 'Cloudflare and Vercel AI Gateway', page: 'Models-and-Providers' },
  { name: 'Your own code', page: 'Custom-Model' },
];
const KNOWLEDGE = [
  { name: 'Your site and files', note: 'default', page: 'Knowledge-Base' },
  { name: 'Cloudflare AI Search', page: 'Provider-Cloudflare-AI-Search' },
  { name: 'OpenAI vector store', page: 'Providers' },
  { name: 'Your search API', page: 'Custom-Knowledge-Base' },
  { name: 'Your own code', page: 'Custom-Knowledge-Base' },
];

/** The first questions people ask; the full list is the wiki's FAQ page. */
const FAQ = [
  { q: 'Is it really free?', a: 'HelpPuff is free and open source (MIT). You pay Cloudflare, and your AI provider if you pick one. The default setup fits the Workers Free plan: about 300 answers a day.', page: 'Costs-and-Limits' },
  { q: 'What does it cost with more traffic?', a: 'On Workers Paid ($5 a month) with the default model, roughly $12 a month at 1,000 messages a day, $55 at 5,000 and $108 at 10,000. Every model and provider is in the table.', page: 'Costs-and-Limits#costs-at-higher-volume' },
  { q: 'Where is my data stored?', a: 'Only in your Cloudflare account: conversations and leads in your D1 database, knowledge in D1 and Vectorize, settings in KV. HelpPuff receives none of it.', page: 'Security' },
  { q: 'Can I use ChatGPT, Claude or Gemini?', a: 'Yes. Workers AI is the default (no key), and one command switches to OpenAI, Claude, Gemini, DeepSeek or any OpenAI-compatible API. The knowledge base, tools and guardrails stay the same.', page: 'Models-and-Providers' },
  { q: 'Does it make things up?', a: 'It answers only from your site, your files and your own answers. When nothing matches, it says it is not sure and offers a person, instead of guessing.', page: 'Knowledge-Base' },
  { q: 'Can I use my own domain?', a: 'Yes: helppuff domain add chat.yourdomain.com. It starts on workers.dev, which keeps working after you add a domain.', page: 'Deployment#your-own-domain' },
];

/** Lucide-style outline icons, 24px grid. */
const ICONS: Record<string, string> = {
  book: 'M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5Zm0 0A2.5 2.5 0 0 1 6.5 17H19M8 7h7M8 11h5',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2ZM8 9h8M8 13h5',
  form: 'M9 3h6v4H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  webhook: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9Z',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z',
  plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8Z',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  headset: 'M3 14v-2a9 9 0 0 1 18 0v2M21 16a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2ZM3 16a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2ZM18 18v.5a3 3 0 0 1-3 3h-3',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM4 10h16M8 2v4M16 2v4M9 15l2 2 4-4',
  briefcase: 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z',
  bot: 'M12 8V4H8M4 8h16v12H4zM2 14h2M20 14h2M9 13v2M15 13v2',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6 9 17l-5-5',
  arrow: 'M5 12h14M13 5l7 7-7 7',
  github: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
};
</script>

<template>
  <div class="hp">
    <!-- Hero -->
    <section class="hero">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <a class="eyebrow" :href="REPO" target="_blank" rel="noopener">
            <span class="dot" /> AI-agent first · Open source · Runs on Cloudflare’s free plan
          </a>
          <h1>
            Your website’s AI assistant.<br />
            <span class="hp-emph">Owned by you.</span>
          </h1>
          <p class="lede">
            HelpPuff learns your website, answers visitors, captures leads, hands chats to your team and
            turns requests into jobs, all inside <strong>your own Cloudflare account</strong>. No subscription, no server to patch,
            no chatbot vendor holding your customers.
          </p>
          <p class="lede agent-lede">
            <strong>Your AI agent sets it up.</strong> Make a folder, open Claude Code, Codex or Cursor in it and paste one prompt.
            Nothing to configure by hand, unless you want to.
          </p>
          <button class="agent-prompt" type="button" aria-label="Copy the prompt for your AI agent" @click="copy(AGENT_PROMPT, 'hero-agent')">
            <span class="ap-head">
              <svg viewBox="0 0 24 24"><path :d="ICONS.bot" /></svg>
              Paste into your AI agent
              <span class="copy-state">
                <svg viewBox="0 0 24 24"><path :d="copied === 'hero-agent' ? ICONS.check : ICONS.copy" /></svg>
                {{ copied === 'hero-agent' ? 'Copied' : 'Copy' }}
              </span>
            </span>
            <span class="ap-text">{{ AGENT_PROMPT }}</span>
          </button>
          <p class="sub-note">
            Prefer the terminal?
            <button class="inline-copy" type="button" :aria-label="`Copy ${INSTALL}`" @click="copy(INSTALL, 'install')">
              <code>{{ INSTALL }}</code>
              <svg viewBox="0 0 24 24"><path :d="copied === 'install' ? ICONS.check : ICONS.copy" /></svg>
            </button>
          </p>
          <div class="ctas">
            <a class="btn primary" :href="docs('Getting-Started')">Get started <svg viewBox="0 0 24 24"><path :d="ICONS.arrow" /></svg></a>
            <a class="btn ghost" :href="WIDGET_DEMO.href" target="_blank" rel="noopener">Try every option live</a>
          </div>
        </div>

        <div class="hero-art">
          <svg class="shapes" viewBox="0 0 700 720" aria-hidden="true" focusable="false">
            <path class="blob-soft" transform="translate(-30 380) scale(.6)" d="M409 514C352 549 248 568 192 538C135 509 113 421 96 351C80 281 65 198 101 148C137 99 222 78 295 74C368 70 467 80 506 128C544 177 527 274 510 343C492 412 466 479 409 514Z" />
            <path class="blob" transform="translate(96 -30) scale(1.08)" d="M539 374C519 428 457 458 400 490C343 522 277 565 223 550C168 535 131 466 98 406C66 347 23 272 42 220C61 168 144 146 204 118C264 90 318 50 373 63C428 76 481 133 511 189C540 245 559 320 539 374Z" />
            <circle class="ring" cx="96" cy="112" r="44" />
            <g class="puffs">
              <circle cx="606" cy="660" r="10" />
              <circle cx="636" cy="622" r="15" />
              <circle cx="672" cy="572" r="22" />
            </g>
          </svg>
          <Zoom class="art back" :src="shot('card-dark')" alt="The widget in dark mode with an orange accent, showing an emergency callout card" width="464" height="816" :demo="WIDGET_DEMO" />
          <Zoom class="art front" :src="shot('chat-light')" alt="The widget answering a pricing question with a list and booking options" width="464" height="816" :demo="WIDGET_DEMO" />
        </div>
      </div>
    </section>

    <!-- Stats -->
    <section class="wrap stats" aria-label="At a glance">
      <div v-for="s in STATS" :key="s.value" class="stat">
        <b>{{ s.value }}</b>
        <span>{{ s.label }}</span>
      </div>
    </section>

    <!-- Agents -->
    <section class="agents" id="agents">
      <div class="wrap agents-grid">
        <div>
          <p class="kicker">AI-agent first</p>
          <h2>Make a folder. Paste one prompt. <span class="hp-emph">Your agent does the rest.</span></h2>
          <p>
            You don’t configure HelpPuff by hand (though you can). Claude Code, Codex, Cursor or OpenCode takes an empty
            folder to a tested assistant on your site: it deploys it, learns your website, asks a real question and hands
            you the links. You only tell it your website and sign in to Cloudflare.
          </p>
          <ol class="steps">
            <li><code>mkdir my-assistant &amp;&amp; cd my-assistant</code></li>
            <li>Open your agent there: <code>claude</code> <code>codex</code> <code>cursor .</code></li>
            <li>Paste the prompt</li>
          </ol>
          <ul class="ticks">
            <li><svg viewBox="0 0 24 24"><path :d="ICONS.check" /></svg> Shared instructions for every agent: no plugin, skill or MCP server</li>
            <li><svg viewBox="0 0 24 24"><path :d="ICONS.check" /></svg> Everything the dashboard does is in the CLI and admin API</li>
            <li><svg viewBox="0 0 24 24"><path :d="ICONS.check" /></svg> Any model or knowledge base with one command, even your own code</li>
            <li><svg viewBox="0 0 24 24"><path :d="ICONS.check" /></svg> You step in only for sign-in or a real business decision</li>
          </ul>
          <button class="btn primary" type="button" @click="copy(AGENT_PROMPT, 'agent')">
            <svg viewBox="0 0 24 24"><path :d="copied === 'agent' ? ICONS.check : ICONS.copy" /></svg>
            {{ copied === 'agent' ? 'Prompt copied' : 'Copy the agent prompt' }}
          </button>
          <p class="asks-label">Then change anything by asking:</p>
          <ul class="asks">
            <li v-for="a in ASKS" :key="a">“{{ a }}”</li>
          </ul>
        </div>
        <div class="terminal" role="img" aria-label="An example agent session: init, a question for you, knowledge status, a test question, then the embed added to your site">
          <div class="term-bar"><i /><i /><i /><span>claude — my-site</span></div>
          <pre><span class="t-dim">›</span> Follow the HelpPuff instructions … set up HelpPuff in this folder

<span class="t-acc">●</span> helppuff init --url https://harbour.example --deploy --json
  <span class="t-dim">{ "status": "needs_input", "questions": [ … ] }</span>
<span class="t-acc">●</span> Asked you the one thing it could not detect, re-ran
  <span class="t-dim">{ "status": "created", "deploy": { … } }</span>
<span class="t-acc">●</span> helppuff knowledge status --json
  <span class="t-ok">✓</span> Website learned
<span class="t-acc">●</span> helppuff ask "Do you do emergency callouts?" --json
  <span class="t-ok">✓</span> Reply cites /services/emergency
<span class="t-acc">●</span> Added the embed script to app/layout.tsx

  Done: your dashboard, embed and preview links.</pre>
        </div>
      </div>
    </section>

    <!-- Why -->
    <section class="wrap block">
      <header class="section-head">
        <p class="kicker">Why HelpPuff</p>
        <h2>The convenience of a hosted chatbot, <span class="hp-emph">without renting one.</span></h2>
        <p>
          Hosted chatbots charge monthly, put features behind higher plans and keep your conversations.
          Building your own means wiring a model, retrieval, storage, a widget and a dashboard by hand.
          HelpPuff is the third option.
        </p>
      </header>
      <div class="video">
        <iframe
          v-if="tourPlaying"
          :src="`https://www.youtube-nocookie.com/embed/${TOUR}?autoplay=1&rel=0`"
          title="HelpPuff: the 4-minute tour"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
        />
        <button v-else class="video-facade" type="button" aria-label="Play the 4-minute tour of HelpPuff (plays from YouTube)" @click="tourPlaying = true">
          <img :src="`https://i.ytimg.com/vi/${TOUR}/maxresdefault.jpg`" alt="" width="1280" height="720" loading="lazy" />
          <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
        </button>
      </div>
      <p class="video-note">Plays from YouTube · <a :href="`https://www.youtube.com/watch?v=${TOUR}`" target="_blank" rel="noopener">Open on YouTube</a></p>
      <div class="compare" role="table" aria-label="HelpPuff compared with hosted chatbots and building your own">
        <div class="c-row c-head" role="row">
          <span role="columnheader" />
          <span role="columnheader">Hosted chatbots</span>
          <span role="columnheader">Build it yourself</span>
          <span role="columnheader" class="us">HelpPuff</span>
        </div>
        <div v-for="r in COMPARE" :key="r.row" class="c-row" role="row">
          <span role="rowheader" class="c-label">{{ r.row }}</span>
          <span v-for="(cell, i) in [r.hosted, r.diy, r.us]" :key="i" role="cell" :class="{ us: i === 2 }">
            <template v-if="cell === true"><svg class="yes" viewBox="0 0 24 24" aria-label="Yes"><path :d="ICONS.check" /></svg></template>
            <template v-else-if="cell === false"><span class="no" aria-label="No">—</span></template>
            <template v-else>{{ cell }}</template>
          </span>
        </div>
      </div>
    </section>

    <!-- Showcase -->
    <section class="showcase">
      <div class="wrap">
        <header class="section-head">
          <p class="kicker">Make it yours</p>
          <h2>Looks like your brand. <span class="hp-emph">Not like a plugin.</span></h2>
          <p>
            Colour, theme, fonts, corners, launcher, greeting, shortcuts, forms and wording are all settings,
            with readable contrast worked out for you. Every picture on this page is a real screenshot.
          </p>
        </header>
        <div class="gallery">
          <figure>
            <Zoom :src="shot('home-teal')" alt="A home screen with four shortcuts in a serif font and teal accent" lazy width="464" height="816" caption="A home screen that sells: questions, calls and useful pages, suggested from your website and edited in the dashboard." :demo="WIDGET_DEMO" />
            <figcaption><b>A home screen that sells</b>Questions, calls and useful pages, suggested from your website and yours to edit.</figcaption>
          </figure>
          <figure>
            <Zoom :src="shot('lead-form')" alt="A pre-chat form asking for name, email and occasion, with a privacy note" lazy width="464" height="816" caption="Leads before the first message: your fields, your wording, a privacy note." :demo="WIDGET_DEMO" />
            <figcaption><b>Leads before the first message</b>Your fields, your wording, a privacy note.</figcaption>
          </figure>
          <figure class="phone">
            <Zoom :src="shot('mobile')" alt="The widget full screen on a phone, with a carousel of services" lazy width="390" height="780" caption="Made for phones: full screen, thumb-friendly, keyboard-aware." :demo="WIDGET_DEMO" />
            <figcaption><b>Made for phones</b>Full screen, thumb-friendly, keyboard-aware.</figcaption>
          </figure>
        </div>
        <div class="playground-card">
          <Zoom :src="shot('playground')" alt="The HelpPuff playground: a panel of every widget option beside a live preview" lazy width="1440" height="880" caption="The playground: every widget option beside the real widget, with a button for every message type." :demo="WIDGET_DEMO" />
          <div class="pg-cta">
            <b>Every option, live, in the playground</b>
            <span>Change anything and see it instantly, then copy the config.</span>
            <a :href="WIDGET_DEMO.href" target="_blank" rel="noopener">Open the playground →</a>
          </div>
        </div>
      </div>
    </section>

    <!-- Booking -->
    <section class="wrap block booking" id="booking">
      <header class="section-head">
        <p class="kicker">Booking in the chat</p>
        <h2>The AI finds the time. <span class="hp-emph">HelpPuff books it.</span></h2>
        <p>
          Visitors pick a free time in a calendar right in the chat, and HelpPuff books it, on a job, in your calendar too.
          The assistant suggests times but never books: we tested AI models booking by themselves, and even the best
          sometimes booked the wrong time, or booked twice.
        </p>
      </header>
      <div class="booking-grid">
        <figure>
          <Zoom :src="shot('booking-picker')" alt="A calendar in the chat: days along the top, free times below" lazy width="464" height="816" caption="The real free times, in the visitor's own time zone. Days, then times, then their name and email." :demo="WIDGET_DEMO" />
          <figcaption><b>Free times, in their time zone</b>From your hours, or from Cal.com, Calendly, Google Calendar or Outlook.</figcaption>
        </figure>
        <figure>
          <Zoom :src="shot('booking-booked')" alt="A booked appointment in the chat, with Change time and Cancel booking" lazy width="464" height="816" caption="Booked once, even on a double click, and the visitor can move or cancel it from the chat." :demo="WIDGET_DEMO" />
          <figcaption><b>Booked once, changeable</b>No double bookings, whichever model you use.</figcaption>
        </figure>
        <ul class="booking-points">
          <li><b>Three choices.</b> No appointments, your booking link, or the date picker. A booking link on your site is found for you.</li>
          <li><b>Synced both ways.</b> Bookings are written to your calendar, and events made there show in HelpPuff.</li>
          <li><b>On a job, on the calendar.</b> Each appointment joins the contact's job, with reminders and webhooks.</li>
          <li><a :href="docs('Bookings')">How booking works →</a></li>
          <li><a :href="docs('AI-Booking-Tests')">Why the AI never books: our tests →</a></li>
        </ul>
      </div>
    </section>

    <!-- Live demo -->
    <section class="wrap block" id="demo">
      <header class="section-head">
        <p class="kicker">Live demo</p>
        <h2>Go on, <span class="hp-emph">ask it something.</span></h2>
        <p>The real widget for a made-up plumbing business. Pick a look, then use the buttons on the page: questions, every message type and the JavaScript API.</p>
      </header>
      <div class="demo">
        <div class="demo-controls">
          <div class="looks" role="radiogroup" aria-label="Look">
            <button v-for="l in LOOKS" :key="l.id" type="button" role="radio" :aria-checked="look === l.id" @click="look = l.id">{{ l.label }}</button>
          </div>
        </div>
        <div class="browser">
          <div class="browser-bar" aria-hidden="true"><i /><i /><i /><span>harbourplumbing.example</span></div>
          <iframe v-if="mounted" :key="demoSrc" :src="demoSrc" title="Live HelpPuff demo" loading="lazy" />
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="wrap block">
      <header class="section-head">
        <p class="kicker">Everything included</p>
        <h2>More than a chat bubble.</h2>
        <p>The visitor experience, the tools your team works in and the follow-up, in every deployment, on the free plan.</p>
      </header>
      <div class="features">
        <a v-for="f in FEATURES" :key="f.title" class="feature" :href="docs(f.link)">
          <span class="f-icon"><svg viewBox="0 0 24 24"><path :d="ICONS[f.icon]" /></svg></span>
          <b>{{ f.title }}</b>
          <span>{{ f.text }}</span>
        </a>
      </div>
    </section>

    <!-- Dashboard -->
    <section class="wrap block" id="dashboard">
      <header class="section-head">
        <p class="kicker">The dashboard</p>
        <h2>A CRM that <span class="hp-emph">fills itself.</span></h2>
        <p>
          Every deployment includes a dashboard for your team: conversations arrive summarised, contact details become
          leads, and callback requests become tasks. Its data lives in your own D1 database.
        </p>
      </header>
      <div class="dash">
        <div class="dash-tabs" role="tablist" aria-label="Dashboard pages">
          <button
            v-for="t in DASH_TABS"
            :id="`dash-tab-${t.id}`"
            :key="t.id"
            type="button"
            role="tab"
            :aria-selected="dashTab === t.id"
            aria-controls="dash-panel"
            @click="dashTab = t.id"
          >
            {{ t.label }}
          </button>
        </div>
        <div id="dash-panel" class="dash-panel" role="tabpanel" :aria-labelledby="`dash-tab-${dashTab}`">
          <div class="browser">
            <div class="browser-bar" aria-hidden="true"><i /><i /><i /><span>your-assistant.workers.dev/admin</span></div>
            <Zoom
              :src="shot(`dash-${dashTab}`)"
              :alt="`The ${dashTab} page of the HelpPuff dashboard, with sample data`"
              width="1440"
              height="900"
              :caption="dashCaption"
              :demo="dashDemo(dashRoute)"
            />
          </div>
          <p class="dash-caption">{{ dashCaption }}</p>
        </div>
        <div class="ctas center">
          <a class="btn primary" :href="withBase('/dashboard-demo/')" target="_blank" rel="noopener">Open the live dashboard demo</a>
          <a class="btn ghost" :href="withBase('/dashboard')">Take the tour</a>
        </div>
      </div>
    </section>

    <!-- Stack -->
    <section class="wrap block">
      <header class="section-head">
        <p class="kicker">One stack, your account</p>
        <h2>Runs at the edge. <span class="hp-emph">Nothing to maintain.</span></h2>
        <p>
          One Worker and a handful of managed Cloudflare services, created and connected for you.
          Stay free while traffic is small, then grow on Cloudflare’s usage-based pricing with the same architecture.
        </p>
      </header>
      <div class="stack">
        <div class="stack-flow" aria-hidden="true">
          <span class="node">Your website</span>
          <span class="line" />
          <span class="node strong"><svg viewBox="0 0 24 24"><path :d="ICONS.cloud" /></svg> HelpPuff Worker, in your Cloudflare account</span>
        </div>
        <div class="stack-grid">
          <div v-for="s in STACK" :key="s.name" class="svc">
            <b>{{ s.name }}</b>
            <span>{{ s.role }}</span>
          </div>
        </div>
        <p class="stack-note">
          Optional when you want them: Browser Rendering for JavaScript-heavy pages, Turnstile, AI Gateway.
          <a :href="docs('Cloudflare-Free-Plan')">Every free-plan limit, and what happens at each one →</a>
        </p>
      </div>
    </section>

    <!-- Data + providers -->
    <section class="wrap block split">
      <div class="panel own">
        <span class="f-icon big"><svg viewBox="0 0 24 24"><path :d="ICONS.lock" /></svg></span>
        <h3>Your data stays yours</h3>
        <p>
          Transcripts, leads and customer details live in your D1 database. Website knowledge lives in D1 and Vectorize.
          Configuration lives in your KV. HelpPuff has no hosted control plane and receives none of it.
        </p>
        <a :href="docs('Security')">How it is secured →</a>
      </div>
      <div class="panel">
        <span class="f-icon big"><svg viewBox="0 0 24 24"><path :d="ICONS.plug" /></svg></span>
        <h3>Any model. Any knowledge base.</h3>
        <p>
          Keep the widget, dashboard, leads, tools and guardrails. Choose who writes the answers and what they come from,
          separately, with one command each.
        </p>
        <p class="chips-label">Who writes the answers</p>
        <div class="chips">
          <a v-for="p in MODELS" :key="p.name" :href="docs(p.page)" class="chip">
            {{ p.name }}<small v-if="p.note">{{ p.note }}</small>
          </a>
        </div>
        <p class="chips-label">What they come from</p>
        <div class="chips">
          <a v-for="p in KNOWLEDGE" :key="p.name" :href="docs(p.page)" class="chip">
            {{ p.name }}<small v-if="p.note">{{ p.note }}</small>
          </a>
        </div>
        <a class="whole" :href="docs('Providers')">Or a whole agent: Retell, or your own API →</a>
      </div>
    </section>

    <!-- FAQ -->
    <section class="wrap block" id="faq">
      <header class="section-head">
        <p class="kicker">Questions</p>
        <h2>Asked <span class="hp-emph">before every install.</span></h2>
      </header>
      <div class="faq">
        <details v-for="item in FAQ" :key="item.q">
          <summary>{{ item.q }}</summary>
          <p>{{ item.a }} <a :href="docs(item.page)">More →</a></p>
        </details>
      </div>
      <p class="faq-more"><a :href="docs('FAQ')">Every question, answered →</a></p>
    </section>

    <!-- Final CTA -->
    <section class="wrap">
      <div class="final">
        <h2>Put an assistant on your site this afternoon.</h2>
        <p>Free to start. Yours to keep.</p>
        <div class="ctas center">
          <a class="btn primary" :href="docs('Getting-Started')">Get started</a>
          <a class="btn ghost" :href="REPO" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24"><path :d="ICONS.github" /></svg> Star on GitHub
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hp {
  --ink: var(--hp-text);
  --ink-2: var(--hp-text-muted);
  --line: var(--hp-border);
  --control: var(--hp-control-border);
  --card: var(--hp-surface);
  --soft: var(--hp-inset);
  overflow-x: clip;
  padding-bottom: 96px;
}
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
a { text-decoration: none; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 8px; height: 46px; padding: 0 22px; border-radius: 999px;
  font-weight: 600; font-size: 15px; border: 1px solid transparent; cursor: pointer; transition: transform 160ms, box-shadow 160ms, background 160ms;
}
.btn:active { transform: translateY(1px); }
.btn.primary { background: var(--hp-accent); color: var(--hp-on-accent); border-color: var(--hp-accent-edge); }
.btn.primary:hover { background: var(--hp-accent-hover); transform: translateY(-1px); }
.btn.primary:active { background: var(--hp-accent-active); }
.btn.ghost { color: var(--ink); border-color: var(--control); background: transparent; }
.btn.ghost:hover { border-color: var(--ink); background: var(--card); }

/* Hero */
.hero { position: relative; padding: 72px 0 40px; }

.hero-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1.05fr 1fr; gap: 40px; align-items: center; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
  color: var(--ink-2); border: 1px solid var(--line); background: color-mix(in srgb, var(--card) 75%, transparent); backdrop-filter: blur(8px);
}
.eyebrow:hover { color: var(--ink); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.18); }
h1 { text-wrap: balance; margin: 22px 0 18px; font-size: clamp(40px, 6.2vw, 72px); line-height: 1.03; letter-spacing: -0.04em; font-weight: 800; color: var(--ink); }

.lede { font-size: clamp(17px, 1.6vw, 19px); line-height: 1.6; color: var(--ink-2); max-width: 560px; margin: 0; }
.lede strong { color: var(--ink); font-weight: 600; }
.ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.ctas.center { justify-content: center; }
.copy-state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); padding: 4px 10px; border-radius: 8px; background: var(--card); }
.copy-state svg { width: 14px; height: 14px; }
.sub-note { margin: 12px 0 0; font-size: 14px; color: var(--ink-2); }
.sub-note a { color: var(--hp-link); font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }

.agent-lede { margin-top: 14px; }
/* The agent prompt, the first thing to copy: a card showing its first lines. */
.agent-prompt {
  margin-top: 24px; display: grid; gap: 8px; width: 100%; max-width: 560px; padding: 12px 14px 14px; border-radius: 14px; text-align: left;
  border: 1px solid var(--line); background: var(--soft); cursor: pointer; font: inherit; color: var(--ink); transition: border-color 160ms;
}
.agent-prompt:hover { border-color: var(--ink); }
.agent-prompt:focus-visible, .inline-copy:focus-visible { outline: 2px solid var(--hp-link); outline-offset: 2px; }
.ap-head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.ap-head > svg { color: var(--hp-heading-accent); }
.ap-head .copy-state { margin-left: auto; }
.ap-text {
  font-family: var(--vp-font-family-mono); font-size: 13px; line-height: 1.55; color: var(--ink-2);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.inline-copy {
  display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; padding: 2px 8px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--soft); color: var(--ink); cursor: pointer; font: inherit; vertical-align: middle;
}
.inline-copy:hover { border-color: var(--ink); }
.inline-copy code { font-family: var(--vp-font-family-mono); font-size: 13px; }
.inline-copy svg { width: 14px; height: 14px; }

.hero-copy { position: relative; z-index: 1; }
.hero-art { position: relative; height: 640px; }
/* Citron shapes behind the product visual: one blob, a softer one, a ring and the logo's rising puffs. */
.shapes { position: absolute; right: -80px; top: -40px; width: 700px; height: 720px; z-index: 0; stroke: none; pointer-events: none; overflow: visible; }
.shapes .blob { fill: var(--hp-accent); transform-box: fill-box; transform-origin: center; animation: drift 16s ease-in-out infinite; }
.shapes .blob-soft { fill: var(--hp-glow); }
.shapes .ring { fill: none; stroke: var(--hp-accent); stroke-width: 3; }
.shapes .puffs { fill: var(--hp-accent); animation: rise 7s ease-in-out infinite; }
@keyframes drift { 50% { rotate: 5deg; scale: 1.03; } }
@keyframes rise { 50% { translate: 0 -8px; } }
.art { position: absolute; height: auto; filter: drop-shadow(0 30px 50px var(--hp-shadow)); }
.art.front { width: 360px; right: 40px; top: 10px; z-index: 2; animation: float 7s ease-in-out infinite; }
.art.back { width: 320px; right: 290px; top: 90px; z-index: 1; transform: rotate(-6deg); opacity: 0.97; animation: float-back 8s ease-in-out infinite; }
@keyframes float { 50% { transform: translateY(-12px); } }
@keyframes float-back { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(-6deg) translateY(10px); } }

/* Stats */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 24px; }
.stat { padding: 22px 22px 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--card); }
.stat b { display: block; font-size: 38px; letter-spacing: -0.04em; line-height: 1.1; color: var(--hp-heading-accent); }
.stat span { display: block; margin-top: 6px; font-size: 14px; line-height: 1.45; color: var(--ink-2); }
.video { max-width: 640px; margin: 0 auto; aspect-ratio: 16 / 9; border-radius: 18px; overflow: hidden; border: 1px solid var(--line); background: #16000b; box-shadow: 0 30px 70px -30px var(--hp-shadow); }
.video iframe, .video-facade { display: block; width: 100%; height: 100%; border: 0; }
.video-facade { position: relative; padding: 0; background: none; cursor: pointer; }
.video-facade img { display: block; width: 100%; height: 100%; object-fit: cover; }
.video-facade .play { position: absolute; left: 50%; top: 86.4%; width: 72px; height: 72px; margin: -36px 0 0 -36px; border-radius: 50%; display: grid; place-items: center; background: var(--hp-accent); border: 1px solid var(--hp-accent-edge); box-shadow: 0 10px 26px -6px rgba(0, 0, 0, 0.6); transition: transform 0.15s ease; }
.video-facade .play svg { width: 30px; height: 30px; margin-left: 4px; fill: var(--hp-on-accent); }
.video-facade:hover .play { transform: scale(1.08); }
.video-facade:focus-visible { outline: 3px solid var(--hp-link); outline-offset: -3px; }
.video-note { margin: 12px 0 40px; text-align: center; font-size: 14px; color: var(--ink-2); }
.video-note a { color: var(--hp-link); font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 640px) { .video { border-radius: 12px; } .video-facade .play { width: 54px; height: 54px; margin: -27px 0 0 -27px; } .video-facade .play svg { width: 22px; height: 22px; } }

/* Sections */
.block { margin-top: 120px; }
.section-head { max-width: 760px; margin: 0 auto 48px; text-align: center; }
.kicker { margin: 0 0 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hp-heading-accent); }
h2 { margin: 0; text-wrap: balance; font-size: clamp(30px, 4.2vw, 48px); line-height: 1.08; letter-spacing: -0.035em; font-weight: 800; color: var(--ink); border: 0; padding: 0; }
.section-head p:not(.kicker) { margin: 18px auto 0; font-size: 18px; line-height: 1.6; color: var(--ink-2); max-width: 640px; }
h3 { margin: 18px 0 8px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); }

/* Compare */
.compare { border: 1px solid var(--line); border-radius: 22px; overflow: hidden; background: var(--card); }
.c-row { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; }
.c-row > span { padding: 16px 20px; font-size: 15px; color: var(--ink-2); border-top: 1px solid var(--line); display: flex; align-items: center; }
.c-head > span { border-top: 0; font-weight: 600; color: var(--ink); font-size: 14px; }
.c-label { color: var(--ink) !important; font-weight: 500; }
.us { background: var(--hp-inset); color: var(--ink) !important; font-weight: 600; }
.c-head .us { background: var(--hp-accent); color: var(--hp-on-accent) !important; }
.yes { color: var(--hp-heading-accent); width: 22px; height: 22px; stroke-width: 2.6; }
.no { color: var(--vp-c-text-3); }

/* Showcase */
.showcase { margin-top: 120px; padding: 96px 0 8px; background: linear-gradient(180deg, transparent, var(--soft) 18%, var(--soft) 82%, transparent); }
.showcase .section-head { margin-bottom: 40px; }
.gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; align-items: end; }
.gallery figure { margin: 0; text-align: center; }
.gallery .hp-zoom { width: 100%; max-width: 330px; margin: 0 auto; filter: drop-shadow(0 24px 40px var(--hp-shadow)); transition: transform 300ms; }
.gallery figure:hover .hp-zoom { transform: translateY(-6px); }
.gallery .phone .hp-zoom { max-width: 250px; }
.gallery .phone :deep(img) { border-radius: 34px; border: 9px solid #18181f; background: #18181f; }
figcaption { margin-top: 18px; font-size: 14px; color: var(--ink-2); }
figcaption b { display: block; font-size: 16px; color: var(--ink); margin-bottom: 2px; }

.booking-grid { display: grid; grid-template-columns: 1fr 1fr 1.1fr; gap: 28px; align-items: center; }
.booking-grid figure { margin: 0; text-align: center; }
.booking-grid .hp-zoom { width: 100%; max-width: 300px; margin: 0 auto; filter: drop-shadow(0 24px 40px var(--hp-shadow)); }
.booking-points { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; font-size: 15px; color: var(--ink-2); }
.booking-points b { color: var(--ink); }
.booking-points a { font-weight: 600; color: var(--hp-link); text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 900px) {
  .booking-grid { grid-template-columns: 1fr 1fr; }
  .booking-points { grid-column: 1 / -1; }
}
@media (max-width: 560px) {
  .booking-grid { grid-template-columns: 1fr; }
}

.playground-card {
  display: grid; grid-template-columns: 1.6fr 1fr; align-items: center; gap: 32px; margin-top: 72px; padding: 18px; border-radius: 26px;
  border: 1px solid var(--line); background: var(--card); color: inherit; transition: border-color 200ms, box-shadow 200ms;
}
.playground-card:hover { border-color: var(--control); box-shadow: 0 30px 60px -30px var(--hp-shadow); }
.playground-card :deep(img) { border-radius: 14px; border: 1px solid var(--line); }
.pg-cta a { display: inline-block; margin-top: 14px; font-weight: 600; color: var(--hp-link); text-decoration: underline; text-underline-offset: 3px; }
.pg-cta b { display: block; font-size: 26px; line-height: 1.2; letter-spacing: -0.025em; color: var(--ink); }
.pg-cta span { display: block; margin-top: 10px; font-size: 16px; color: var(--ink-2); line-height: 1.6; }

/* Demo */
.demo { display: grid; gap: 18px; }
.demo-controls { display: flex; justify-content: center; }
.looks { display: inline-flex; padding: 4px; border-radius: 999px; border: 1px solid var(--line); background: var(--soft); }
.looks button { padding: 7px 16px; border-radius: 999px; font-size: 14px; font-weight: 500; color: var(--ink-2); }
.looks button[aria-checked='true'] { background: var(--hp-accent); color: var(--hp-on-accent); font-weight: 600; box-shadow: inset 0 0 0 1px var(--hp-accent-edge); }
.browser { border-radius: 18px; overflow: hidden; border: 1px solid var(--line); background: var(--card); box-shadow: 0 40px 80px -40px var(--hp-shadow); }
.browser-bar { display: flex; align-items: center; gap: 7px; height: 42px; padding: 0 16px; border-bottom: 1px solid var(--line); background: var(--soft); }
.browser-bar i { width: 11px; height: 11px; border-radius: 50%; background: var(--line); }
.browser-bar span { margin: 0 auto; padding: 3px 14px; border-radius: 8px; font-size: 12px; color: var(--ink-2); background: var(--card); }
.browser iframe { display: block; width: 100%; height: 720px; border: 0; background: var(--card); }

/* Features */
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.feature {
  display: flex; flex-direction: column; gap: 6px; padding: 24px; border-radius: 20px; border: 1px solid var(--line); background: var(--card); color: inherit;
  transition: border-color 200ms, transform 200ms, box-shadow 200ms;
}
.feature:hover { border-color: var(--control); transform: translateY(-3px); box-shadow: 0 20px 40px -24px var(--hp-shadow); }
.feature b { margin-top: 10px; font-size: 17px; color: var(--ink); letter-spacing: -0.01em; }
.feature span:last-child { font-size: 14.5px; line-height: 1.6; color: var(--ink-2); }
.f-icon { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: var(--hp-heading-accent); background: var(--hp-accent-soft); }
.f-icon svg { width: 20px; height: 20px; }
.f-icon.big { width: 52px; height: 52px; border-radius: 15px; }
.f-icon.big svg { width: 24px; height: 24px; }

/* Dashboard */
.dash { display: grid; gap: 20px; }
.dash-tabs { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; padding: 4px; margin: 0 auto; border-radius: 999px; border: 1px solid var(--line); background: var(--soft); width: fit-content; max-width: 100%; }
.dash-tabs button { padding: 8px 18px; border-radius: 999px; font-size: 14px; font-weight: 500; color: var(--ink-2); }
.dash-tabs button[aria-selected='true'] { background: var(--hp-accent); color: var(--hp-on-accent); font-weight: 600; box-shadow: inset 0 0 0 1px var(--hp-accent-edge); }
.dash-panel .hp-zoom { width: 100%; }
.dash-caption { margin: 16px auto 0; max-width: 680px; text-align: center; color: var(--ink-2); font-size: 15.5px; line-height: 1.6; }

/* Agents */
.agents { margin-top: 120px; padding: 100px 0; background: var(--hp-surface); color: var(--ink); }
.agents p:not(.kicker) { color: var(--ink-2); font-size: 17px; line-height: 1.65; margin: 18px 0 0; }
.agents-grid { display: grid; grid-template-columns: 1fr 1.1fr; gap: 56px; align-items: center; }
.ticks { list-style: none; padding: 0; margin: 24px 0 30px; display: grid; gap: 12px; }
.ticks li { display: flex; gap: 10px; align-items: flex-start; color: var(--ink); font-size: 15px; }
.ticks svg { color: var(--hp-heading-accent); margin-top: 2px; }
.steps { margin: 22px 0 0; padding: 0; list-style: none; counter-reset: step; display: grid; gap: 10px; color: var(--ink); font-size: 15px; }
.steps li { counter-increment: step; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.steps li::before {
  content: counter(step); display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 4px; border-radius: 50%;
  font-size: 12px; font-weight: 700; background: var(--hp-accent); color: var(--hp-on-accent);
}
.steps code, .asks code { font-family: var(--vp-font-family-mono); font-size: 13px; padding: 1px 6px; border-radius: 6px; background: var(--card); }
.agents p.asks-label { margin: 28px 0 10px; font-size: 14px; font-weight: 600; color: var(--ink); }
.asks { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.asks li { font-size: 13px; padding: 6px 10px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); }
/* The terminal is dark in both themes: deep oxblood, porcelain type, citron for what you type. */
.terminal { --t-bg: color-mix(in srgb, var(--hp-oxblood) 82%, var(--hp-ink)); --t-text: var(--hp-porcelain); border-radius: 18px; border: 1px solid color-mix(in srgb, var(--t-text) 14%, var(--t-bg)); background: var(--t-bg); box-shadow: 0 40px 90px -30px var(--hp-shadow); overflow: hidden; }
.term-bar { display: flex; align-items: center; gap: 7px; height: 40px; padding: 0 16px; border-bottom: 1px solid color-mix(in srgb, var(--t-text) 10%, var(--t-bg)); }
.term-bar i { width: 11px; height: 11px; border-radius: 50%; background: color-mix(in srgb, var(--t-text) 22%, var(--t-bg)); }
.term-bar span { margin: 0 auto; font-size: 12px; color: color-mix(in srgb, var(--t-text) 66%, var(--t-bg)); font-family: var(--vp-font-family-mono); }
.terminal pre { margin: 0; padding: 22px 24px 26px; font-family: var(--vp-font-family-mono); font-size: 13px; line-height: 1.75; color: var(--t-text); white-space: pre; overflow-x: auto; }
.t-dim { color: color-mix(in srgb, var(--t-text) 66%, var(--t-bg)); }
.t-acc { color: var(--hp-citron); }
.t-ok { color: #8ef0b0; }

/* Stack */
.stack { border: 1px solid var(--line); border-radius: 26px; padding: 36px; background: var(--card); }
.stack-flow { display: flex; align-items: center; justify-content: center; gap: 0; margin-bottom: 32px; flex-wrap: wrap; row-gap: 12px; }
.node { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px; border: 1px solid var(--line); font-weight: 600; font-size: 14px; color: var(--ink); background: var(--soft); }
.node.strong { background: var(--hp-accent); color: var(--hp-on-accent); border: 1px solid var(--hp-accent-edge); }
.line { width: 80px; height: 2px; background: repeating-linear-gradient(90deg, var(--control) 0 8px, transparent 8px 14px); }
.stack-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.svc { padding: 18px; border-radius: 16px; background: var(--soft); }
.svc b { display: block; font-size: 15px; color: var(--ink); }
.svc span { display: block; margin-top: 4px; font-size: 13.5px; line-height: 1.5; color: var(--ink-2); }
.stack-note { margin: 24px 0 0; text-align: center; font-size: 14px; color: var(--ink-2); }
.stack-note a, .panel a:not(.chip) { color: var(--hp-link); font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }

/* Split */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.panel { padding: 36px; border-radius: 26px; border: 1px solid var(--line); background: var(--card); }
.panel.own { background: linear-gradient(160deg, var(--hp-accent-soft), var(--card) 60%); }
.panel p { color: var(--ink-2); font-size: 15.5px; line-height: 1.65; margin: 0 0 16px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); font-size: 14px; font-weight: 500; color: var(--ink); transition: border-color 160ms; }
.chip:hover { border-color: var(--ink); }
.chip small { font-size: 11px; color: var(--hp-heading-accent); font-weight: 600; }
.panel .chips-label { margin: 18px 0 10px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.panel .whole { display: inline-block; margin-top: 18px; font-size: 14px; }

/* FAQ */
.faq { max-width: 820px; margin: 0 auto; border: 1px solid var(--line); border-radius: 22px; background: var(--card); overflow: hidden; }
.faq details + details { border-top: 1px solid var(--line); }
.faq summary { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 24px; cursor: pointer; list-style: none; font-size: 17px; font-weight: 600; color: var(--ink); }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: '+'; flex: none; font-size: 22px; font-weight: 400; line-height: 1; color: var(--ink-2); transition: transform 160ms; }
.faq details[open] summary::after { transform: rotate(45deg); }
.faq summary:focus-visible { outline: 2px solid var(--hp-heading-accent); outline-offset: -2px; }
.faq p { margin: 0; padding: 0 24px 22px; font-size: 15.5px; line-height: 1.65; color: var(--ink-2); }
.faq-more { margin: 20px 0 0; text-align: center; font-size: 15px; }
@media (max-width: 600px) { .faq summary { padding: 18px; font-size: 16px; } .faq p { padding: 0 18px 20px; } }

/* Final */
.final { position: relative; overflow: hidden; margin-top: 120px; padding: 80px 32px; border-radius: 32px; text-align: center; background: var(--hp-surface); border: 1px solid var(--line); color: var(--ink); }
.final h2 { position: relative; max-width: 760px; margin: 0 auto; }
.final p { position: relative; margin: 14px 0 0; font-size: 18px; color: var(--ink-2); }
.final .ctas { position: relative; }

@media (prefers-reduced-motion: reduce) {
  .art, .shapes * { animation: none !important; }
}

@media (max-width: 1200px) {
  .art.front { width: 320px; right: 20px; }
  .art.back { width: 260px; right: 220px; }
  .shapes { right: -60px; top: -30px; width: 620px; height: 638px; }
}

@media (max-width: 960px) {
  .hero { padding-top: 40px; }
  .hero-grid, .agents-grid, .split, .playground-card { grid-template-columns: 1fr; }
  .hero-art { height: 520px; max-width: 520px; width: 100%; margin: 0 auto; }
  .art.front { width: 290px; right: 10px; }
  .art.back { width: 250px; right: 200px; top: 70px; }
  .shapes { right: -60px; top: -30px; width: 540px; height: 556px; }
  .stats, .stack-grid { grid-template-columns: repeat(2, 1fr); }
  .features { grid-template-columns: repeat(2, 1fr); }
  .gallery { grid-template-columns: 1fr 1fr; }
  .gallery .phone { grid-column: span 2; }
  .c-row { grid-template-columns: 1.2fr 1fr 1fr 1fr; }
  .c-row > span { padding: 12px; font-size: 13px; }
  .block, .showcase, .agents, .final { margin-top: 88px; }
}

@media (max-width: 600px) {
  .wrap { padding: 0 16px; }
  .hero-art { height: 470px; }
  .art.back { display: none; }
  .art.front { width: 260px; left: 50%; right: auto; margin-left: -130px; }
  .shapes { left: 50%; right: auto; margin-left: -251px; top: -22px; width: 440px; height: 453px; }
  .features, .gallery, .stack-grid { grid-template-columns: 1fr; }
  .gallery .phone { grid-column: auto; }
  .stats { grid-template-columns: 1fr 1fr; gap: 10px; }
  .stat { padding: 16px; }
  .stat b { font-size: 30px; }
  .compare { overflow-x: auto; }
  .c-row { min-width: 620px; }
  .stack, .panel { padding: 24px; }
  .browser iframe { height: 620px; }
  .final { padding: 56px 20px; border-radius: 24px; }
}
</style>
