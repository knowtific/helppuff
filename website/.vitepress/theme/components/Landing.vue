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
  'Follow the HelpPuff instructions at https://raw.githubusercontent.com/knowtific/helppuff/main/instructions.md and install it in this project. Complete setup automatically with the recommended free defaults. Ask me only for information you cannot determine safely or authorization I must complete. Continue until it is deployed, added to the website when possible, tested with real questions, and you have given me the dashboard, embed and preview links.';
const copied = ref('');
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
      poweredBy: false,
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
  { value: '6 KB', label: 'gzipped to load, the rest only when a visitor opens it' },
  { value: '1', label: 'command to set up, deploy and connect everything' },
];

type Cell = boolean | string;
const COMPARE: { row: string; hosted: Cell; diy: Cell; us: Cell }[] = [
  { row: 'Monthly subscription', hosted: 'Per seat or per message', diy: 'Your hosting bill', us: 'None. Free plan to start' },
  { row: 'Where conversations and leads live', hosted: 'Their platform', diy: 'Wherever you build it', us: 'Your Cloudflare account' },
  { row: 'Learns your website and files', hosted: 'Often a paid tier', diy: 'You build retrieval', us: true },
  { row: 'Lead capture and CRM dashboard', hosted: 'Higher plans', diy: 'You build it', us: true },
  { row: 'Switch AI provider', hosted: false, diy: true, us: 'One setting' },
  { row: 'Servers to patch', hosted: false, diy: 'Yes', us: false },
  { row: 'Set up by your coding agent', hosted: false, diy: false, us: true },
  { row: 'Open source', hosted: false, diy: true, us: 'MIT' },
];

const FEATURES = [
  { icon: 'book', title: 'Learns your website and files', text: 'Crawls the pages you choose and reads PDF, Word, Markdown and text files. Hybrid semantic and keyword search finds the right passage.', link: 'Knowledge-Base' },
  { icon: 'message', title: 'Rich conversations', text: 'Streaming replies, suggested questions, option chips, cards, carousels, links and forms, right inside the chat.', link: 'Widget' },
  { icon: 'form', title: 'Pre-chat and inline forms', text: 'Ask for a name, phone, email or anything custom before the chat, with the fields and wording you choose.', link: 'Leads' },
  { icon: 'users', title: 'Built-in CRM', text: 'One lead per person across repeat conversations, pipeline stages, notes, custom answers and CSV export.', link: 'Dashboard#leads' },
  { icon: 'sparkles', title: 'Conversation intelligence', text: 'Automatic summaries with intent, sentiment, lead quality, outcome, topics, next steps and unanswered questions.', link: 'Dashboard#conversations' },
  { icon: 'phone', title: 'Callback requests', text: '“Please call me” becomes a task your team can complete, dismiss or reopen.', link: 'Leads#callbacks' },
  { icon: 'chart', title: 'Analytics and ratings', text: 'Conversation and lead trends, conversion, top pages, countries and thumbs-up feedback.', link: 'Dashboard#analytics' },
  { icon: 'webhook', title: 'Signed webhooks', text: 'Send leads, callbacks, summaries and ratings to Zapier, Make, n8n, your CRM or your API, with retries.', link: 'Webhooks' },
  { icon: 'shield', title: 'Safety and cost controls', text: 'Origin allowlists, signed sessions, daily budgets, rate limits, optional Turnstile and graceful fallbacks.', link: 'Security' },
  { icon: 'zap', title: 'Fast and isolated', text: 'A shadow-root widget your CSS cannot break and that cannot break your page. Accessible and mobile-first.', link: 'Widget' },
  { icon: 'plug', title: 'Any AI backend', text: 'Workers AI by default; OpenAI, Gemini, Claude, Cloudflare AI Search, Retell or your own API with one setting.', link: 'Providers' },
  { icon: 'refresh', title: 'Safe upgrades', text: 'Additive database migrations, compatibility checks, restore points and downgrade protection.', link: 'Upgrading' },
];

const DASH_TABS = [
  { id: 'conversation', label: 'Conversations', caption: 'Every chat summarised and labelled: intent, sentiment, lead quality, next step, and the questions it could not answer.' },
  { id: 'leads', label: 'Leads', caption: 'One lead per person, moved through your pipeline from new to won, with notes and CSV export.' },
  { id: 'callbacks', label: 'Callbacks', caption: '“Please call me” becomes a task: tap to call, mark it done with a note, or dismiss it.' },
  { id: 'analytics', label: 'Analytics', caption: 'Conversations, leads and conversion against the previous period, top pages, countries and the latest questions.' },
  { id: 'knowledge', label: 'Knowledge', caption: 'What it learned from your site, the files you gave it, your own answers, and a box to test any question.' },
];
const dashTab = ref(DASH_TABS[0]!.id);
const dashCaption = computed(() => DASH_TABS.find((t) => t.id === dashTab.value)?.caption ?? '');
/** The demo's route for a tab: the screenshot names a single conversation, the dashboard calls the page `conversations`. */
const dashRoute = computed(() => (dashTab.value === 'conversation' ? 'conversations' : dashTab.value));

const STACK = [
  { name: 'Workers', role: 'Chat API, widget and dashboard from one deployment' },
  { name: 'Workers AI', role: 'Answers, summaries, embeddings and reranking' },
  { name: 'D1', role: 'Conversations, leads, CRM, analytics and knowledge text' },
  { name: 'Vectorize', role: 'Finds passages by meaning' },
  { name: 'KV', role: 'Live configuration and prompt updates' },
  { name: 'Workflows', role: 'Crawls, file learning, summaries and retries' },
  { name: 'Cron Triggers', role: 'Re-learns your website on a schedule' },
  { name: 'Rate Limiting', role: 'Protects the public chat endpoint' },
];

const PROVIDERS = [
  { name: 'Workers AI', note: 'default, no key', page: 'Provider-Workers-AI' },
  { name: 'OpenAI', page: 'Provider-OpenAI' },
  { name: 'Gemini', page: 'Provider-Gemini' },
  { name: 'Claude', page: 'Provider-Anthropic' },
  { name: 'Cloudflare AI Search', page: 'Provider-Cloudflare-AI-Search' },
  { name: 'Retell', page: 'Provider-Retell' },
  { name: 'Your own API', page: 'Provider-Your-Own-API' },
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
  plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8Z',
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
      <div class="aurora" aria-hidden="true"><span /><span /><span /></div>
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <a class="eyebrow" :href="REPO" target="_blank" rel="noopener">
            <span class="dot" /> Open source · MIT · Runs on Cloudflare’s free plan
          </a>
          <h1>
            Your website’s AI assistant.
            <span class="grad">Owned by you.</span>
          </h1>
          <p class="lede">
            HelpPuff learns your website, answers visitors, captures leads and gives your team a CRM,
            all inside <strong>your own Cloudflare account</strong>. No subscription, no server to patch,
            no chatbot vendor holding your customers.
          </p>
          <div class="ctas">
            <a class="btn primary" :href="docs('Getting-Started')">Get started <svg viewBox="0 0 24 24"><path :d="ICONS.arrow" /></svg></a>
            <a class="btn ghost" :href="WIDGET_DEMO.href" target="_blank" rel="noopener">Try every option live</a>
          </div>
          <button class="install" type="button" :aria-label="`Copy ${INSTALL}`" @click="copy(INSTALL, 'install')">
            <span class="prompt">$</span>
            <code>{{ INSTALL }}</code>
            <span class="copy-state">
              <svg viewBox="0 0 24 24"><path :d="copied === 'install' ? ICONS.check : ICONS.copy" /></svg>
              {{ copied === 'install' ? 'Copied' : 'Copy' }}
            </span>
          </button>
          <p class="sub-note">or let Claude Code, Codex or Cursor do it: <a href="#agents">one prompt</a>.</p>
        </div>

        <div class="hero-art">
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

    <!-- Why -->
    <section class="wrap block">
      <header class="section-head">
        <p class="kicker">Why HelpPuff</p>
        <h2>The convenience of a hosted chatbot, <span class="grad">without renting one.</span></h2>
        <p>
          Hosted chatbots charge monthly, put features behind higher plans and keep your conversations.
          Building your own means wiring a model, retrieval, storage, a widget and a dashboard by hand.
          HelpPuff is the third option.
        </p>
      </header>
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
          <h2>Looks like your brand. <span class="grad">Not like a plugin.</span></h2>
          <p>
            Colour, theme, fonts, corners, launcher, greeting, shortcuts, forms and wording are all settings,
            with readable contrast worked out for you. Every picture on this page is a real screenshot.
          </p>
        </header>
        <div class="gallery">
          <figure>
            <Zoom :src="shot('home-teal')" alt="A home screen with four shortcuts in a serif font and teal accent" lazy width="464" height="816" caption="A home screen that sells: shortcuts for the questions you get most, calls and links." :demo="WIDGET_DEMO" />
            <figcaption><b>A home screen that sells</b>Shortcuts for the questions you get most, calls and links.</figcaption>
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

    <!-- Live demo -->
    <section class="wrap block" id="demo">
      <header class="section-head">
        <p class="kicker">Live demo</p>
        <h2>Go on, <span class="grad">ask it something.</span></h2>
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
        <h2>A CRM that <span class="grad">fills itself.</span></h2>
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

    <!-- Agents -->
    <section class="agents" id="agents">
      <div class="wrap agents-grid">
        <div>
          <p class="kicker light">Built for AI agents</p>
          <h2>Paste one prompt. <span class="grad">Your agent does the rest.</span></h2>
          <p>
            Claude Code, Codex, Cursor or OpenCode can take a folder from empty to a tested assistant on your site.
            The CLI answers in JSON, asks only what it cannot work out as structured questions, never echoes a secret,
            and tests real answers without touching your visitors’ limits.
          </p>
          <ul class="ticks">
            <li><svg viewBox="0 0 24 24"><path :d="ICONS.check" /></svg> Shared instructions for every agent: no plugin, skill or MCP server</li>
            <li><svg viewBox="0 0 24 24"><path :d="ICONS.check" /></svg> Everything the dashboard does is in the CLI and admin API</li>
            <li><svg viewBox="0 0 24 24"><path :d="ICONS.check" /></svg> You step in only for sign-in or a real business decision</li>
          </ul>
          <button class="btn primary" type="button" @click="copy(AGENT_PROMPT, 'agent')">
            <svg viewBox="0 0 24 24"><path :d="copied === 'agent' ? ICONS.check : ICONS.copy" /></svg>
            {{ copied === 'agent' ? 'Prompt copied' : 'Copy the agent prompt' }}
          </button>
        </div>
        <div class="terminal" role="img" aria-label="An example agent session: init, a question for you, knowledge status, a test question, then the embed added to your site">
          <div class="term-bar"><i /><i /><i /><span>claude — my-site</span></div>
          <pre><span class="t-dim">›</span> Install HelpPuff in this project (prompt from the README)

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

    <!-- Stack -->
    <section class="wrap block">
      <header class="section-head">
        <p class="kicker">One stack, your account</p>
        <h2>Runs at the edge. <span class="grad">Nothing to maintain.</span></h2>
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
        <h3>Works with the AI you choose</h3>
        <p>Keep the widget, dashboard, leads and webhooks. Change only the model behind them.</p>
        <div class="chips">
          <a v-for="p in PROVIDERS" :key="p.name" :href="docs(p.page)" class="chip">
            {{ p.name }}<small v-if="p.note">{{ p.note }}</small>
          </a>
        </div>
      </div>
    </section>

    <!-- Final CTA -->
    <section class="wrap">
      <div class="final">
        <div class="aurora small" aria-hidden="true"><span /><span /></div>
        <h2>Put an assistant on your site this afternoon.</h2>
        <p>Free to start. Yours to keep.</p>
        <div class="ctas center">
          <a class="btn white" :href="docs('Getting-Started')">Get started</a>
          <a class="btn outline" :href="REPO" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24"><path :d="ICONS.github" /></svg> Star on GitHub
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hp {
  --ink: var(--vp-c-text-1);
  --ink-2: var(--vp-c-text-2);
  --line: var(--vp-c-divider);
  --card: var(--vp-c-bg);
  --soft: var(--vp-c-bg-soft);
  overflow-x: clip;
  padding-bottom: 96px;
}
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
.grad { background: var(--hp-gradient); -webkit-background-clip: text; background-clip: text; color: transparent; }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
a { text-decoration: none; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 8px; height: 46px; padding: 0 22px; border-radius: 999px;
  font-weight: 600; font-size: 15px; border: 1px solid transparent; cursor: pointer; transition: transform 160ms, box-shadow 160ms, background 160ms;
}
.btn:active { transform: translateY(1px); }
.btn.primary { background: var(--hp-gradient); color: #fff; box-shadow: 0 8px 24px -8px rgba(91, 91, 247, 0.65); }
.btn.primary:hover { box-shadow: 0 12px 32px -8px rgba(91, 91, 247, 0.8); transform: translateY(-1px); }
.btn.ghost { color: var(--ink); border-color: var(--line); background: color-mix(in srgb, var(--card) 70%, transparent); backdrop-filter: blur(8px); }
.btn.ghost:hover { border-color: var(--hp-indigo); }
.btn.white { background: #fff; color: #2b2b8f; }
.btn.outline { color: #fff; border-color: rgba(255, 255, 255, 0.45); }
.btn.outline:hover { background: rgba(255, 255, 255, 0.1); }

/* Hero */
.hero { position: relative; padding: 72px 0 40px; }
.aurora { position: absolute; inset: -160px 0 auto; height: 760px; pointer-events: none; z-index: 0; filter: blur(70px); opacity: 0.55; }
.aurora span { position: absolute; border-radius: 50%; animation: drift 18s ease-in-out infinite alternate; }
.aurora span:nth-child(1) { width: 520px; height: 520px; left: 52%; top: 120px; background: #7c7cff; }
.aurora span:nth-child(2) { width: 420px; height: 420px; left: 72%; top: 260px; background: #e879f9; animation-delay: -6s; }
.aurora span:nth-child(3) { width: 380px; height: 380px; left: 8%; top: 40px; background: #93c5fd; opacity: 0.6; animation-delay: -11s; }
/* Not `:global(.dark) .aurora`: Vue compiles that to a bare `.dark`, which dims the whole page. */
.dark .aurora { opacity: 0.32; }
@keyframes drift { to { transform: translate(-60px, 40px) scale(1.12); } }

.hero-grid { position: relative; z-index: 1; display: grid; grid-template-columns: 1.05fr 1fr; gap: 40px; align-items: center; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 500;
  color: var(--ink-2); border: 1px solid var(--line); background: color-mix(in srgb, var(--card) 75%, transparent); backdrop-filter: blur(8px);
}
.eyebrow:hover { color: var(--ink); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.18); }
h1 { text-wrap: balance; margin: 22px 0 18px; font-size: clamp(40px, 6.2vw, 72px); line-height: 1.03; letter-spacing: -0.04em; font-weight: 800; color: var(--ink); }
h1 .grad { display: block; padding-bottom: 6px; }
.lede { font-size: clamp(17px, 1.6vw, 19px); line-height: 1.6; color: var(--ink-2); max-width: 560px; margin: 0; }
.lede strong { color: var(--ink); font-weight: 600; }
.ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.ctas.center { justify-content: center; }
.install {
  margin-top: 22px; display: inline-flex; align-items: center; gap: 12px; padding: 10px 12px 10px 18px; border-radius: 14px;
  border: 1px solid var(--line); background: var(--soft); cursor: pointer; font: inherit; color: var(--ink); transition: border-color 160ms;
}
.install:hover { border-color: var(--hp-indigo); }
.install code { font-family: var(--vp-font-family-mono); font-size: 15px; }
.prompt { color: var(--hp-indigo); font-family: var(--vp-font-family-mono); font-weight: 700; }
.copy-state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); padding: 4px 10px; border-radius: 8px; background: var(--card); }
.copy-state svg { width: 14px; height: 14px; }
.sub-note { margin: 12px 0 0; font-size: 14px; color: var(--ink-2); }
.sub-note a { color: var(--vp-c-brand-1); font-weight: 500; }

.hero-art { position: relative; height: 640px; }
.art { position: absolute; height: auto; filter: drop-shadow(0 30px 50px rgba(30, 30, 80, 0.22)); }
.art.front { width: 360px; right: 40px; top: 10px; z-index: 2; animation: float 7s ease-in-out infinite; }
.art.back { width: 320px; right: 290px; top: 90px; z-index: 1; transform: rotate(-6deg); opacity: 0.97; animation: float-back 8s ease-in-out infinite; }
@keyframes float { 50% { transform: translateY(-12px); } }
@keyframes float-back { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(-6deg) translateY(10px); } }

/* Stats */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 24px; }
.stat { padding: 22px 22px 20px; border: 1px solid var(--line); border-radius: 18px; background: color-mix(in srgb, var(--card) 85%, transparent); }
.stat b { display: block; font-size: 38px; letter-spacing: -0.04em; line-height: 1.1; background: var(--hp-gradient); -webkit-background-clip: text; background-clip: text; color: transparent; }
.stat span { display: block; margin-top: 6px; font-size: 14px; line-height: 1.45; color: var(--ink-2); }

/* Sections */
.block { margin-top: 120px; }
.section-head { max-width: 760px; margin: 0 auto 48px; text-align: center; }
.kicker { margin: 0 0 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vp-c-brand-1); }
.kicker.light { color: #b4b4ff; }
h2 { margin: 0; text-wrap: balance; font-size: clamp(30px, 4.2vw, 48px); line-height: 1.08; letter-spacing: -0.035em; font-weight: 800; color: var(--ink); border: 0; padding: 0; }
.section-head p:not(.kicker) { margin: 18px auto 0; font-size: 18px; line-height: 1.6; color: var(--ink-2); max-width: 640px; }
h3 { margin: 18px 0 8px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); }

/* Compare */
.compare { border: 1px solid var(--line); border-radius: 22px; overflow: hidden; background: var(--card); }
.c-row { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; }
.c-row > span { padding: 16px 20px; font-size: 15px; color: var(--ink-2); border-top: 1px solid var(--line); display: flex; align-items: center; }
.c-head > span { border-top: 0; font-weight: 600; color: var(--ink); font-size: 14px; }
.c-label { color: var(--ink) !important; font-weight: 500; }
.us { background: color-mix(in srgb, var(--hp-indigo) 7%, transparent); color: var(--ink) !important; font-weight: 600; }
.c-head .us { background: var(--hp-gradient); color: #fff !important; }
.yes { color: #16a34a; width: 22px; height: 22px; stroke-width: 2.6; }
.no { color: var(--vp-c-text-3); }

/* Showcase */
.showcase { margin-top: 120px; padding: 96px 0 8px; background: linear-gradient(180deg, transparent, var(--soft) 18%, var(--soft) 82%, transparent); }
.showcase .section-head { margin-bottom: 40px; }
.gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; align-items: end; }
.gallery figure { margin: 0; text-align: center; }
.gallery .hp-zoom { width: 100%; max-width: 330px; margin: 0 auto; filter: drop-shadow(0 24px 40px rgba(30, 30, 80, 0.16)); transition: transform 300ms; }
.gallery figure:hover .hp-zoom { transform: translateY(-6px); }
.gallery .phone .hp-zoom { max-width: 250px; }
.gallery .phone :deep(img) { border-radius: 34px; border: 9px solid #18181f; background: #18181f; }
figcaption { margin-top: 18px; font-size: 14px; color: var(--ink-2); }
figcaption b { display: block; font-size: 16px; color: var(--ink); margin-bottom: 2px; }

.playground-card {
  display: grid; grid-template-columns: 1.6fr 1fr; align-items: center; gap: 32px; margin-top: 72px; padding: 18px; border-radius: 26px;
  border: 1px solid var(--line); background: var(--card); color: inherit; transition: border-color 200ms, box-shadow 200ms;
}
.playground-card:hover { border-color: var(--hp-indigo); box-shadow: 0 30px 60px -30px rgba(91, 91, 247, 0.45); }
.playground-card :deep(img) { border-radius: 14px; border: 1px solid var(--line); }
.pg-cta a { display: inline-block; margin-top: 14px; font-weight: 600; color: var(--vp-c-brand-1); }
.pg-cta b { display: block; font-size: 26px; line-height: 1.2; letter-spacing: -0.025em; color: var(--ink); }
.pg-cta span { display: block; margin-top: 10px; font-size: 16px; color: var(--ink-2); line-height: 1.6; }

/* Demo */
.demo { display: grid; gap: 18px; }
.demo-controls { display: flex; justify-content: center; }
.looks { display: inline-flex; padding: 4px; border-radius: 999px; border: 1px solid var(--line); background: var(--soft); }
.looks button { padding: 7px 16px; border-radius: 999px; font-size: 14px; font-weight: 500; color: var(--ink-2); }
.looks button[aria-checked='true'] { background: var(--card); color: var(--ink); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.browser { border-radius: 18px; overflow: hidden; border: 1px solid var(--line); background: var(--card); box-shadow: 0 40px 80px -40px rgba(30, 30, 80, 0.4); }
.browser-bar { display: flex; align-items: center; gap: 7px; height: 42px; padding: 0 16px; border-bottom: 1px solid var(--line); background: var(--soft); }
.browser-bar i { width: 11px; height: 11px; border-radius: 50%; background: var(--vp-c-gray-2, #ddd); }
.browser-bar span { margin: 0 auto; padding: 3px 14px; border-radius: 8px; font-size: 12px; color: var(--ink-2); background: var(--card); }
.browser iframe { display: block; width: 100%; height: 720px; border: 0; background: #f4f4f1; }

/* Features */
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.feature {
  display: flex; flex-direction: column; gap: 6px; padding: 24px; border-radius: 20px; border: 1px solid var(--line); background: var(--card); color: inherit;
  transition: border-color 200ms, transform 200ms, box-shadow 200ms;
}
.feature:hover { border-color: color-mix(in srgb, var(--hp-indigo) 60%, var(--line)); transform: translateY(-3px); box-shadow: 0 20px 40px -24px rgba(91, 91, 247, 0.4); }
.feature b { margin-top: 10px; font-size: 17px; color: var(--ink); letter-spacing: -0.01em; }
.feature span:last-child { font-size: 14.5px; line-height: 1.6; color: var(--ink-2); }
.f-icon { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); }
.f-icon svg { width: 20px; height: 20px; }
.f-icon.big { width: 52px; height: 52px; border-radius: 15px; }
.f-icon.big svg { width: 24px; height: 24px; }

/* Dashboard */
.dash { display: grid; gap: 20px; }
.dash-tabs { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; padding: 4px; margin: 0 auto; border-radius: 999px; border: 1px solid var(--line); background: var(--soft); width: fit-content; max-width: 100%; }
.dash-tabs button { padding: 8px 18px; border-radius: 999px; font-size: 14px; font-weight: 500; color: var(--ink-2); }
.dash-tabs button[aria-selected='true'] { background: var(--card); color: var(--ink); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.dash-panel .hp-zoom { width: 100%; }
.dash-caption { margin: 16px auto 0; max-width: 680px; text-align: center; color: var(--ink-2); font-size: 15.5px; line-height: 1.6; }

/* Agents */
.agents { margin-top: 120px; padding: 100px 0; background: radial-gradient(1200px 500px at 80% 0%, rgba(124, 124, 255, 0.35), transparent 60%), #0e0e1a; color: #e9e9f5; }
.agents h2 { color: #fff; }
.agents p:not(.kicker) { color: #b9b9cc; font-size: 17px; line-height: 1.65; margin: 18px 0 0; }
.agents-grid { display: grid; grid-template-columns: 1fr 1.1fr; gap: 56px; align-items: center; }
.ticks { list-style: none; padding: 0; margin: 24px 0 30px; display: grid; gap: 12px; }
.ticks li { display: flex; gap: 10px; align-items: flex-start; color: #dedeee; font-size: 15px; }
.ticks svg { color: #8ef0b0; margin-top: 2px; }
.terminal { border-radius: 18px; border: 1px solid rgba(255, 255, 255, 0.12); background: #121220; box-shadow: 0 40px 90px -30px rgba(0, 0, 0, 0.7); overflow: hidden; }
.term-bar { display: flex; align-items: center; gap: 7px; height: 40px; padding: 0 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.term-bar i { width: 11px; height: 11px; border-radius: 50%; background: rgba(255, 255, 255, 0.18); }
.term-bar span { margin: 0 auto; font-size: 12px; color: #8b8ba0; font-family: var(--vp-font-family-mono); }
.terminal pre { margin: 0; padding: 22px 24px 26px; font-family: var(--vp-font-family-mono); font-size: 13px; line-height: 1.75; color: #dcdcef; white-space: pre; overflow-x: auto; }
.t-dim { color: #7d7d96; }
.t-acc { color: #a5a5ff; }
.t-ok { color: #8ef0b0; }

/* Stack */
.stack { border: 1px solid var(--line); border-radius: 26px; padding: 36px; background: var(--card); }
.stack-flow { display: flex; align-items: center; justify-content: center; gap: 0; margin-bottom: 32px; flex-wrap: wrap; row-gap: 12px; }
.node { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px; border: 1px solid var(--line); font-weight: 600; font-size: 14px; color: var(--ink); background: var(--soft); }
.node.strong { background: var(--hp-gradient); color: #fff; border: 0; }
.line { width: 80px; height: 2px; background: repeating-linear-gradient(90deg, var(--hp-indigo) 0 8px, transparent 8px 14px); opacity: 0.7; }
.stack-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.svc { padding: 18px; border-radius: 16px; background: var(--soft); }
.svc b { display: block; font-size: 15px; color: var(--ink); }
.svc span { display: block; margin-top: 4px; font-size: 13.5px; line-height: 1.5; color: var(--ink-2); }
.stack-note { margin: 24px 0 0; text-align: center; font-size: 14px; color: var(--ink-2); }
.stack-note a, .panel a:not(.chip) { color: var(--vp-c-brand-1); font-weight: 500; }

/* Split */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.panel { padding: 36px; border-radius: 26px; border: 1px solid var(--line); background: var(--card); }
.panel.own { background: linear-gradient(160deg, color-mix(in srgb, var(--hp-indigo) 9%, var(--card)), var(--card) 60%); }
.panel p { color: var(--ink-2); font-size: 15.5px; line-height: 1.65; margin: 0 0 16px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); font-size: 14px; font-weight: 500; color: var(--ink); transition: border-color 160ms; }
.chip:hover { border-color: var(--hp-indigo); }
.chip small { font-size: 11px; color: var(--vp-c-brand-1); font-weight: 600; }

/* Final */
.final { position: relative; overflow: hidden; margin-top: 120px; padding: 80px 32px; border-radius: 32px; text-align: center; background: var(--hp-gradient); color: #fff; }
.final h2 { position: relative; color: #fff; max-width: 760px; margin: 0 auto; }
.final p { position: relative; margin: 14px 0 0; font-size: 18px; color: rgba(255, 255, 255, 0.85); }
.final .ctas { position: relative; }
.aurora.small { inset: -100px; height: auto; opacity: 0.5; }
.aurora.small span:nth-child(1) { left: 60%; top: -60px; width: 380px; height: 380px; background: #f0abfc; }
.aurora.small span:nth-child(2) { left: -5%; top: 80px; width: 340px; height: 340px; background: #a5b4fc; }

@media (prefers-reduced-motion: reduce) {
  .aurora span, .art { animation: none !important; }
}

@media (max-width: 960px) {
  .hero { padding-top: 40px; }
  .hero-grid, .agents-grid, .split, .playground-card { grid-template-columns: 1fr; }
  .hero-art { height: 520px; max-width: 520px; width: 100%; margin: 0 auto; }
  .art.front { width: 290px; right: 10px; }
  .art.back { width: 250px; right: 200px; top: 70px; }
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
  .features, .gallery, .stack-grid { grid-template-columns: 1fr; }
  .gallery .phone { grid-column: auto; }
  .stats { grid-template-columns: 1fr 1fr; gap: 10px; }
  .stat { padding: 16px; }
  .stat b { font-size: 30px; }
  .compare { overflow-x: auto; }
  .c-row { min-width: 620px; }
  .stack, .panel { padding: 24px; }
  .browser iframe { height: 620px; }
  .install code { font-size: 13px; }
  .final { padding: 56px 20px; border-radius: 24px; }
}
</style>
