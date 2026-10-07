<script setup lang="ts">
import { withBase } from 'vitepress';

/**
 * The dashboard page: what the team works in after the widget goes live.
 * Every picture is the real dashboard running on sample data
 * (`packages/dashboard/demo/`), and so is the demo it links to.
 */

const shot = (name: string) => withBase(`/shots/${name}.png`);
const docs = (page: string) => withBase(`/docs/${page}`);
const DEMO = withBase('/dashboard-demo/');

const AREAS = [
  {
    id: 'conversations',
    kicker: 'Conversations',
    title: 'Every chat, read for you.',
    text: 'Five minutes after a chat goes quiet, HelpPuff summarises and labels it, so you can scan a day of conversations in a minute.',
    points: [
      'What the visitor wanted, intent, sentiment and lead quality (hot, warm, cold)',
      'The outcome, topics and the next step to take',
      'Questions it could not answer, each with a link to add the answer',
      'The full transcript, the page it started on, country and ratings on replies',
      'Search everything; filter by leads, waiting callbacks or unsummarised',
    ],
    image: 'dash-conversation',
    alt: 'A conversation in the dashboard: the AI summary with labels, the transcript and the visitor’s contact details beside it',
    route: 'conversations',
    doc: 'Dashboard#conversations',
  },
  {
    id: 'leads',
    kicker: 'Leads',
    title: 'A pipeline that fills itself.',
    text: 'Contact details from the pre-chat form, typed in the chat or found by the assistant become one lead per person, keyed by email.',
    points: [
      'Status from new to contacted, qualified, won or lost, changed in one click',
      'Notes, the form’s answers and every chat that person has had',
      'Repeat visitors join the lead they already have',
      'Export to CSV, or send each new lead to your CRM with a webhook',
    ],
    image: 'dash-leads',
    alt: 'The leads table: names, contact details, pipeline status, where each lead came from and when it was last active',
    route: 'leads',
    doc: 'Leads',
  },
  {
    id: 'callbacks',
    kicker: 'Callbacks',
    title: '“Please call me” becomes a task.',
    text: 'When a visitor asks to be called back, it lands on a to-do list, oldest first, so nobody waits longest.',
    points: [
      'Name, tap-to-call phone, email, what they want and the conversation',
      'Mark it done with a note, dismiss it, or reopen it',
      'The sidebar shows how many are waiting',
      'Webhooks get callback.requested and callback.updated',
    ],
    image: 'dash-callbacks',
    alt: 'Callback requests waiting, each with a phone number, the reason and Done and Dismiss buttons',
    route: 'callbacks',
    doc: 'Leads#callbacks',
  },
  {
    id: 'analytics',
    kicker: 'Analytics',
    title: 'See what visitors ask, and what it brings in.',
    text: 'Conversations and leads over 7, 30 or 90 days, compared with the period before.',
    points: [
      'Conversations, leads, the share that became a lead, messages per chat',
      'Daily activity, top pages and countries',
      'The latest questions and the newest leads',
      'Today’s use of the free AI allowance, so there are no surprises',
    ],
    image: 'dash-analytics',
    alt: 'Analytics: totals with change against the previous period, a daily activity chart, latest questions and new leads',
    route: 'analytics',
    doc: 'Dashboard#analytics',
  },
  {
    id: 'knowledge',
    kicker: 'Knowledge',
    title: 'Know exactly what it knows.',
    text: 'Every page it learned from your site, every file you gave it and the answers you wrote yourself, in one place.',
    points: [
      'Choose pages, re-learn the site, or let it re-learn on a schedule',
      'Upload PDF, Word, Markdown or text files: price lists, policies, brochures',
      'Add your own answers for things that are not on the site',
      'Test a question and see the passages it would answer from, with scores',
    ],
    image: 'dash-knowledge',
    alt: 'The knowledge page: site learning status, uploaded files, your own answers and a box to test a question',
    route: 'knowledge',
    doc: 'Knowledge-Base',
  },
  {
    id: 'prompt',
    kicker: 'Prompt and settings',
    title: 'Change how it talks, safely.',
    text: 'Settings for the things every business sets, and a prompt for what is specific to yours, with every version kept.',
    points: [
      'Chat, appearance, lead form, tone and answer length, business details',
      'Every prompt change is a version you can compare and restore',
      'See the rules HelpPuff adds to every answer, so you never fight them',
      'Webhooks, team access and update checks in Settings',
    ],
    image: 'dash-prompt',
    alt: 'The prompt editor with the live version, publishing controls and the version history',
    route: 'prompt',
    doc: 'Prompts-and-Instructions',
  },
];
</script>

<template>
  <div class="tour">
    <section class="intro">
      <div class="glow" aria-hidden="true"><span /><span /></div>
      <div class="wrap intro-grid">
        <div>
          <p class="kicker">The dashboard</p>
          <h1>Your conversations, leads and follow-ups. <span class="grad">In one place.</span></h1>
          <p class="lede">
            Every HelpPuff deployment includes a dashboard for the people who answer the phone. It runs in your
            own Cloudflare account, and its data lives in your D1 database.
          </p>
          <div class="ctas">
            <a class="btn primary" :href="DEMO" target="_self">Open the live demo</a>
            <a class="btn ghost" :href="docs('Dashboard')">Read the docs</a>
          </div>
          <p class="note">The demo is the real dashboard with sample data for a made-up plumber. Click around and change things: it all stays in your browser.</p>
        </div>
        <a class="intro-shot" :href="DEMO" target="_self" aria-label="Open the live dashboard demo">
          <img :src="shot('dash-conversation-dark')" alt="The dashboard in dark mode, showing a summarised conversation and the visitor’s details" width="1440" height="900" />
        </a>
      </div>
    </section>

    <nav class="wrap jump" aria-label="Dashboard areas">
      <a v-for="a in AREAS" :key="a.id" :href="`#${a.id}`">{{ a.kicker }}</a>
    </nav>

    <section v-for="(a, i) in AREAS" :id="a.id" :key="a.id" class="wrap area" :class="{ flip: i % 2 === 1 }">
      <div class="area-copy">
        <p class="kicker">{{ a.kicker }}</p>
        <h2>{{ a.title }}</h2>
        <p>{{ a.text }}</p>
        <ul>
          <li v-for="p in a.points" :key="p">{{ p }}</li>
        </ul>
        <div class="area-links">
          <a :href="`${DEMO}#/${a.route}`" target="_self">Try it in the demo →</a>
          <a :href="docs(a.doc)">Docs</a>
        </div>
      </div>
      <a class="frame" :href="`${DEMO}#/${a.route}`" target="_self" :aria-label="`Open ${a.kicker} in the demo`">
        <img :src="shot(a.image)" :alt="a.alt" loading="lazy" width="1440" height="900" />
      </a>
    </section>

    <section class="wrap">
      <div class="also">
        <div>
          <h2>Built on an API your agent can use too.</h2>
          <p>
            The dashboard is a client of the same admin API as the <code>helppuff</code> CLI, so a coding agent can
            work through callbacks, manage webhooks and knowledge, or publish a prompt without opening a browser.
          </p>
        </div>
        <div class="ctas">
          <a class="btn primary" :href="DEMO" target="_self">Open the live demo</a>
          <a class="btn ghost" :href="docs('Getting-Started')">Get started</a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tour { --ink: var(--vp-c-text-1); --ink-2: var(--vp-c-text-2); --line: var(--vp-c-divider); --card: var(--vp-c-bg); --soft: var(--vp-c-bg-soft); overflow-x: clip; padding-bottom: 96px; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
.grad { background: var(--hp-gradient); -webkit-background-clip: text; background-clip: text; color: transparent; }
a { text-decoration: none; }
.kicker { margin: 0 0 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vp-c-brand-1); }
h1 { margin: 0 0 18px; font-size: clamp(34px, 4.2vw, 50px); line-height: 1.05; letter-spacing: -0.04em; font-weight: 800; color: var(--ink); text-wrap: balance; }
h2 { margin: 0 0 12px; font-size: clamp(26px, 3.2vw, 36px); line-height: 1.12; letter-spacing: -0.03em; font-weight: 800; color: var(--ink); border: 0; padding: 0; text-wrap: balance; }
.lede { margin: 0; font-size: 18px; line-height: 1.6; color: var(--ink-2); max-width: 560px; }
.note { margin: 16px 0 0; font-size: 14px; color: var(--ink-2); max-width: 520px; }
.ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.btn { display: inline-flex; align-items: center; height: 46px; padding: 0 22px; border-radius: 999px; font-weight: 600; font-size: 15px; border: 1px solid transparent; transition: transform 160ms, box-shadow 160ms; }
.btn.primary { background: var(--hp-gradient); color: #fff; box-shadow: 0 8px 24px -8px rgba(91, 91, 247, 0.65); }
.btn.primary:hover { transform: translateY(-1px); }
.btn.ghost { color: var(--ink); border-color: var(--line); background: var(--card); }
.btn.ghost:hover { border-color: var(--hp-indigo); }

.intro { position: relative; padding: 64px 0 40px; }
.glow { position: absolute; inset: -120px 0 auto; height: 640px; pointer-events: none; filter: blur(80px); opacity: 0.45; }
.glow span { position: absolute; border-radius: 50%; }
.glow span:nth-child(1) { width: 520px; height: 520px; left: 55%; top: 80px; background: #7c7cff; }
.glow span:nth-child(2) { width: 380px; height: 380px; left: 10%; top: 0; background: #93c5fd; }
.dark .glow { opacity: 0.25; }
.intro-grid { position: relative; display: grid; grid-template-columns: 1fr 1.1fr; gap: 48px; align-items: center; }
.intro-shot img, .frame img { display: block; width: 100%; height: auto; border-radius: 14px; border: 1px solid var(--line); box-shadow: 0 40px 80px -40px rgba(20, 20, 60, 0.5); transition: transform 300ms; }
.intro-shot:hover img, .frame:hover img { transform: translateY(-4px); }

.jump { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 40px auto 24px; }
.jump a { padding: 7px 16px; border-radius: 999px; border: 1px solid var(--line); font-size: 14px; font-weight: 500; color: var(--ink); background: var(--card); }
.jump a:hover { border-color: var(--hp-indigo); }

.area { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 56px; align-items: center; margin-top: 100px; scroll-margin-top: 96px; }
.area.flip .area-copy { order: 2; }
.area-copy p:not(.kicker) { margin: 0; font-size: 17px; line-height: 1.6; color: var(--ink-2); }
.area-copy ul { margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.area-copy li { position: relative; padding-left: 26px; font-size: 15px; line-height: 1.5; color: var(--ink); }
.area-copy li::before { content: ''; position: absolute; left: 0; top: 4px; width: 16px; height: 16px; border-radius: 50%; background: var(--vp-c-brand-soft); box-shadow: inset 0 0 0 5px var(--vp-c-brand-soft), inset 0 0 0 16px var(--vp-c-brand-1); transform: scale(0.55); }
.area-links { display: flex; gap: 18px; margin-top: 22px; font-size: 15px; font-weight: 600; }
.area-links a { color: var(--vp-c-brand-1); }
.area-links a:last-child { color: var(--ink-2); font-weight: 500; }

.also { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px; margin-top: 110px; padding: 40px; border-radius: 26px; border: 1px solid var(--line); background: var(--soft); }
.also > div:first-child { max-width: 640px; }
.also p { margin: 0; color: var(--ink-2); font-size: 16px; line-height: 1.6; }
.also .ctas { margin-top: 0; }

@media (max-width: 960px) {
  .intro-grid, .area { grid-template-columns: 1fr; gap: 28px; }
  .area.flip .area-copy { order: 0; }
  .area { margin-top: 72px; }
}
@media (max-width: 600px) {
  .wrap { padding: 0 16px; }
  .intro { padding-top: 36px; }
  .also { padding: 24px; }
}
</style>
