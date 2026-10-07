/**
 * Starting points for the options playground. Each is a `widget` object
 * exactly as it would appear in helppuff.json, so what the playground exports
 * pastes straight in.
 */

export type WidgetJson = Record<string, unknown>;

/** Home-screen buttons. The flow and form they open are in `SUPPORT` below. */
export const HOME_SHORTCUTS = [
  {
    id: 'quote',
    label: 'Get a quote',
    description: 'A few quick questions, no AI needed.',
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
    id: 'call',
    label: 'Call us',
    description: 'Starts a phone call.',
    icon: 'phone',
    action: { id: 'call', kind: 'tel', label: 'Call us', phone: '+61400000000' },
  },
];

/** Quick replies above the message box during a chat. */
export const CHAT_SHORTCUTS = [
  { id: 'sc-options', label: 'Show options', action: { id: 'a1', kind: 'reply', label: 'Show options', value: '/options' } },
  { id: 'sc-carousel', label: 'Show a carousel', action: { id: 'a2', kind: 'reply', label: 'Show a carousel', value: '/carousel' } },
  { id: 'sc-quote', label: 'Get a quote', action: { id: 'a3', kind: 'flow', label: 'Get a quote', flowId: 'quote' } },
  { id: 'sc-call', label: 'Call us', action: { id: 'a4', kind: 'tel', label: 'Call us', phone: '+61400000000' } },
];

export const HOME_LINKS = {
  title: 'Might help',
  items: [
    { label: 'Pricing', url: 'https://knowtific.com/pricing', description: 'What a callout costs.' },
    { label: 'Service areas', url: 'https://knowtific.com/services', description: 'Suburbs we cover.' },
  ],
};

/** Lead-form fields the playground can switch on, in display order. */
export const FIELD_LIBRARY = [
  { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, autocomplete: 'tel' },
  { name: 'email', label: 'Email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' },
  { name: 'company', label: 'Company', type: 'text', autocomplete: 'organization' },
  { name: 'service', label: 'What do you need?', type: 'select', options: ['A quote', 'A booking', 'Something else'] },
];

export const PRIVACY = { text: 'We only use this to reply to you.', url: 'https://knowtific.com/privacy-policy' };

/** The flow and form the shortcuts open. Harmless when nothing opens them. */
const SUPPORT = {
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
};

export const TEASER = { text: 'Questions? Ask away, we usually reply in a minute.', delayMs: 4000, oncePerSession: true };

export type Preset = { id: string; label: string; widget: WidgetJson };

export const PRESETS: Preset[] = [
  {
    id: 'everything',
    label: 'Everything on',
    widget: {
      brand: { name: 'HelpPuff', agentName: 'Puff', accent: '#5B5BF7', theme: 'auto' },
      launcher: { position: 'bottom-right', icon: 'chat', shape: 'pill', label: 'Chat with us' },
      teaser: TEASER,
      home: { title: 'Hi there 👋', subtitle: 'Ask anything, or pick a shortcut.', shortcuts: HOME_SHORTCUTS, links: HOME_LINKS },
      leadForm: {
        enabled: true,
        title: 'Before we start',
        fields: FIELD_LIBRARY.slice(0, 3),
        submitLabel: 'Start chat',
        privacy: PRIVACY,
        askFirstMessage: true,
      },
      chat: {
        placeholder: 'Type a message…',
        initialMessages: ['Hi! Ask me anything about our services.'],
        shortcuts: CHAT_SHORTCUTS,
        fallbackContact: { phone: '+61400000000', email: 'hello@example.com' },
      },
      sound: { enabled: true },
      poweredBy: true,
      ...SUPPORT,
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    widget: {
      brand: { name: 'Acme', agentName: 'Assistant', accent: '#111827', theme: 'light' },
      launcher: { position: 'bottom-right', icon: 'chat', shape: 'orb' },
      leadForm: { enabled: false },
      poweredBy: false,
    },
  },
  {
    id: 'trades',
    label: 'Trades, dark',
    widget: {
      brand: { name: 'Northside Plumbing', agentName: 'Sam', accent: '#F97316', theme: 'dark', tokens: { 'radius-panel': '14px' } },
      launcher: { position: 'bottom-left', icon: 'wrench', shape: 'pill', label: 'Get a quote' },
      teaser: { text: 'Burst pipe? We can be there within the hour.', delayMs: 3000, oncePerSession: true },
      home: { title: 'Need a plumber?', subtitle: 'Quotes in minutes, 24/7 emergencies.', shortcuts: HOME_SHORTCUTS.slice(0, 1).concat(HOME_SHORTCUTS.slice(3)) },
      leadForm: { enabled: true, title: 'Where can we reach you?', fields: FIELD_LIBRARY.slice(0, 2), submitLabel: 'Continue' },
      chat: { placeholder: 'Describe the job…', fallbackContact: { phone: '+61400000000' } },
      ...SUPPORT,
    },
  },
  {
    id: 'clinic',
    label: 'Clinic, soft',
    widget: {
      brand: {
        name: 'Harbour Physio',
        agentName: 'Mia',
        accent: '#0F766E',
        theme: 'light',
        tokens: { 'radius-panel': '28px', 'radius-lg': '18px', font: 'Georgia, "Times New Roman", serif' },
      },
      launcher: { position: 'bottom-right', icon: 'calendar', shape: 'orb', label: 'Book online' },
      home: {
        title: 'Welcome to Harbour Physio',
        subtitle: 'Ask about treatments, or book a session.',
        shortcuts: HOME_SHORTCUTS.slice(2, 3),
        links: { title: 'Popular', items: [{ label: 'Treatments', url: 'https://knowtific.com/services' }, { label: 'Our team', url: 'https://knowtific.com/about' }] },
      },
      leadForm: { enabled: true, fields: [FIELD_LIBRARY[0], FIELD_LIBRARY[2]], privacy: PRIVACY },
      chat: { initialMessages: ['Hi, I’m Mia. How can I help today?'] },
      poweredBy: { text: 'Harbour Physio assistant' },
      ...SUPPORT,
    },
  },
];

export const SUPPORT_CONFIG = SUPPORT;
