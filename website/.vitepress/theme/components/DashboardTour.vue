<script setup lang="ts">
import { withBase } from 'vitepress';
import Zoom from './Zoom.vue';

/**
 * The dashboard page: what the team works in after the widget goes live.
 * Every picture is the real dashboard running on sample data
 * (`packages/dashboard/demo/`), and so is the demo it links to.
 */

const shot = (name: string) => withBase(`/shots/${name}.png`);
const docs = (page: string) => withBase(`/docs/${page}`);
const DEMO = withBase('/dashboard-demo/');
const demo = (route: string) => ({ href: `${DEMO}#/${route}`, label: 'Open the live demo' });

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
      'Search everything; filter by status, label, waiting for a reply, with a contact, callback waiting or not summarised',
    ],
    image: 'dash-conversation',
    alt: 'A conversation in the dashboard: the AI summary with labels, the transcript and the visitor’s contact details beside it',
    route: 'conversations',
    doc: 'Dashboard#conversations',
  },
  {
    id: 'live',
    kicker: 'Live chat',
    title: 'A person, when they ask for one.',
    text: 'A visitor who wants to talk to someone is handed to your team, who answer right in the chat, from the dashboard or from Telegram.',
    points: [
      'Everyone available is alerted: a browser notification, a sound and the tab’s title',
      'Who is waiting and for how long; take a chat, or give it to someone',
      'Hand it back to the assistant, close it, or reopen it later',
      'Nobody free: the visitor gets the callback form, and it lands in Callbacks',
      'Members see only the inbox; admins see everything',
    ],
    image: 'dash-live',
    alt: 'A live chat in the dashboard: the visitor waiting two minutes, the Take chat button and the reply box',
    route: 'conversations',
    doc: 'Live-Chat',
  },
  {
    id: 'jobs',
    kicker: 'Jobs',
    title: 'Quote requests, on a board.',
    text: 'When a visitor wants a quote or work done, it becomes a job on your pipeline, from the chat, a “Get a quote” button or the API.',
    points: [
      'Stages and fields set up from your website by the AI, then yours to change',
      'Drag between stages; jobs left too long turn red',
      'Every field, update and stage change in its history, with private notes',
      'Webhooks for created, moved, won and lost',
    ],
    image: 'dash-jobs',
    alt: 'The jobs board: columns for new requests, site visits, quotes sent and booked jobs, with values and stale warnings',
    route: 'jobs',
    doc: 'Jobs',
  },
  {
    id: 'calendar',
    kicker: 'Calendar',
    title: 'Appointments, booked without you.',
    text: 'With the date picker on, visitors pick a free time in the chat and HelpPuff books it. Every appointment is here, and on its job.',
    points: [
      'A list, a month, a week or a day',
      'Book one by hand, move it, mark it completed or a no-show, or cancel it',
      'Synced both ways with Cal.com, Calendly, Google Calendar or Outlook',
      'Events made in your calendar show here too',
    ],
    image: 'dash-calendar',
    alt: 'The calendar: a week of appointments booked in the chat and by hand, each with the visitor’s name',
    route: 'calendar',
    doc: 'Bookings#the-calendar',
  },
  {
    id: 'leads',
    kicker: 'Contacts',
    title: 'A pipeline that fills itself.',
    text: 'Contact details from the pre-chat form, typed in the chat or found by the assistant become one contact per person, keyed by email.',
    points: [
      'Status from new to contacted, qualified, won or lost, changed in one click',
      'Company, address, your own attributes, the team’s notes and every chat that person has had',
      'Repeat visitors join the contact they already have',
      'Export to CSV, or send each new lead to your CRM with a webhook',
    ],
    image: 'dash-leads',
    alt: 'The contacts table: names, contact details, pipeline status, where each one came from and when they were last active',
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
    title: 'Is it helping? See for yourself.',
    text: 'How much the assistant handles on its own, where it needs your team, what it brings in, and what is broken, against the period before.',
    points: [
      'Solved by the assistant, became a contact, needed a person, rated helpful',
      'The questions it could not answer, most asked first: what to teach it next',
      'Live chat answered and missed, the typical wait, callbacks done',
      'Jobs won and their value, bookings and no-shows, and when visitors chat',
      'Needs attention: a failing webhook, email or tool, a day the AI budget ran out',
    ],
    image: 'dash-analytics',
    alt: 'Analytics: what needs attention, the headline numbers against the previous period, how conversations ended and the questions it could not answer',
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
      'Today’s use of the free AI allowance, so there are no surprises',
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
    text: 'Settings for the things every business sets, and a prompt for what is specific to yours, with your own APIs as tools around it.',
    points: [
      'Chat, appearance, lead form, tone and answer length, business details',
      'The home screen: buttons and useful pages, suggested from your site, with a preview',
      'Tools: paste a curl, call it before the chat, from the prompt ({{order_status}}) or after it',
      'Every prompt change is a version you can compare and restore',
      'See the rules HelpPuff adds to every answer, so you never fight them',
      'Webhooks, team access and update checks in Settings',
    ],
    image: 'dash-prompt',
    alt: 'The Prompt page: tools called before the chat, the prompt, tools called after it, and the tool library',
    route: 'prompt',
    doc: 'Prompts-and-Instructions',
  },
];
</script>

<template>
  <div class="tour">
    <section class="intro">
      <div class="glow" aria-hidden="true" />
      <div class="wrap intro-grid">
        <div>
          <p class="kicker">The dashboard</p>
          <h1>Your conversations, leads and follow-ups. <span class="hp-emph">In one place.</span></h1>
          <p class="lede">
            Every HelpPuff deployment includes a dashboard for the people who answer the phone. It runs in your
            own Cloudflare account, and its data lives in your D1 database.
          </p>
          <div class="ctas">
            <a class="btn primary" :href="DEMO" target="_blank" rel="noopener">Open the live demo</a>
            <a class="btn ghost" :href="docs('Dashboard')">Read the docs</a>
          </div>
          <p class="note">The demo is the real dashboard with sample data for a made-up plumber. Click around and change things: it all stays in your browser.</p>
        </div>
        <Zoom
          class="intro-shot"
          :src="shot('dash-conversation-dark')"
          alt="The dashboard in dark mode, showing a summarised conversation and the visitor’s details"
          width="1440"
          height="900"
          caption="Conversations, in dark mode: the AI summary and labels, the transcript, and the visitor’s details."
          :demo="demo('conversations')"
        />
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
          <a :href="`${DEMO}#/${a.route}`" target="_blank" rel="noopener">Try it in the demo →</a>
          <a :href="docs(a.doc)">Docs</a>
        </div>
      </div>
      <Zoom class="frame" :src="shot(a.image)" :alt="a.alt" lazy width="1440" height="900" :caption="`${a.kicker}: ${a.text}`" :demo="demo(a.route)" />
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
          <a class="btn primary" :href="DEMO" target="_blank" rel="noopener">Open the live demo</a>
          <a class="btn ghost" :href="docs('Getting-Started')">Get started</a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tour { --ink: var(--hp-text); --ink-2: var(--hp-text-muted); --line: var(--hp-border); --control: var(--hp-control-border); --card: var(--hp-surface); --soft: var(--hp-inset); overflow-x: clip; padding-bottom: 96px; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
a { text-decoration: none; }
.kicker { margin: 0 0 12px; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hp-heading-accent); }
h1 { margin: 0 0 18px; font-size: clamp(34px, 4.2vw, 50px); line-height: 1.05; letter-spacing: -0.04em; font-weight: 800; color: var(--ink); text-wrap: balance; }
h2 { margin: 0 0 12px; font-size: clamp(26px, 3.2vw, 36px); line-height: 1.12; letter-spacing: -0.03em; font-weight: 800; color: var(--ink); border: 0; padding: 0; text-wrap: balance; }
.lede { margin: 0; font-size: 18px; line-height: 1.6; color: var(--ink-2); max-width: 560px; }
.note { margin: 16px 0 0; font-size: 14px; color: var(--ink-2); max-width: 520px; }
.ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.btn { display: inline-flex; align-items: center; height: 46px; padding: 0 22px; border-radius: 999px; font-weight: 600; font-size: 15px; border: 1px solid transparent; transition: transform 160ms, box-shadow 160ms; }
.btn.primary { background: var(--hp-accent); color: var(--hp-on-accent); border-color: var(--hp-accent-edge); }
.btn.primary:hover { background: var(--hp-accent-hover); transform: translateY(-1px); }
.btn.primary:active { background: var(--hp-accent-active); }
.btn.ghost { color: var(--ink); border-color: var(--control); background: transparent; }
.btn.ghost:hover { border-color: var(--ink); background: var(--card); }

.intro { position: relative; padding: 64px 0 40px; }
.glow { position: absolute; inset: -120px 0 auto; height: 720px; pointer-events: none; background: radial-gradient(520px 420px at 72% 50%, var(--hp-glow), transparent 70%); }
.intro-grid { position: relative; display: grid; grid-template-columns: 1fr 1.1fr; gap: 48px; align-items: center; }
.intro-shot :deep(img), .frame :deep(img) { border-radius: 14px; border: 1px solid var(--line); box-shadow: 0 40px 80px -40px var(--hp-shadow); transition: transform 300ms; }
.intro-shot:hover :deep(img), .frame:hover :deep(img) { transform: translateY(-4px); }
.frame { width: 100%; }

.jump { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 40px auto 24px; }
.jump a { padding: 7px 16px; border-radius: 999px; border: 1px solid var(--line); font-size: 14px; font-weight: 500; color: var(--ink); background: var(--card); }
.jump a:hover { border-color: var(--ink); }

.area { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 56px; align-items: center; margin-top: 100px; scroll-margin-top: 96px; }
.area.flip .area-copy { order: 2; }
.area-copy p:not(.kicker) { margin: 0; font-size: 17px; line-height: 1.6; color: var(--ink-2); }
.area-copy ul { margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.area-copy li { position: relative; padding-left: 26px; font-size: 15px; line-height: 1.5; color: var(--ink); }
.area-copy li::before { content: ''; position: absolute; left: 0; top: 4px; width: 16px; height: 16px; border-radius: 50%; background: var(--hp-accent-soft); box-shadow: inset 0 0 0 5px var(--hp-accent-soft), inset 0 0 0 16px var(--hp-heading-accent); transform: scale(0.55); }
.area-links { display: flex; gap: 18px; margin-top: 22px; font-size: 15px; font-weight: 600; }
.area-links a { color: var(--hp-link); text-decoration: underline; text-underline-offset: 3px; }
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
