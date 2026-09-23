/** Every visitor-facing string, overridable per site via `widget.strings` (§8.7). */
export const DEFAULT_STRINGS = {
  start: 'Start a conversation',
  resume: 'Continue conversation',
  resumeLabel: 'Picking up where you left off',
  send: 'Send',
  close: 'Close chat',
  back: 'Back',
  menu: 'Menu',
  placeholder: 'Type a message…',
  status: 'Typically replies instantly',
  thinking: 'Typing…',
  required: 'required',
  submit: 'Start chat',
  firstMessage: 'How can we help?',
  retry: 'Try again',
  dismiss: 'Dismiss',
  newChat: 'Start a new conversation',
  offline: "You're offline",
  soundOn: 'Turn sound on',
  soundOff: 'Turn sound off',
  poweredBy: 'Powered by Murmur',
  callUs: 'Call us',
  emailUs: 'Email us',
  agentSaid: 'Assistant said',
  flowRunning: 'Answer the questions above, or',
  cancel: 'Cancel',
} as const;

export type StringKey = keyof typeof DEFAULT_STRINGS;

export function makeStrings(overrides?: Record<string, string>): (key: StringKey) => string {
  return (key) => overrides?.[key] ?? DEFAULT_STRINGS[key];
}
