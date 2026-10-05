/** Every visitor-facing string, overridable per site via `widget.strings`. */
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
  // The assistant's opening line when a conversation starts with an empty
  // thread. `{name}` becomes the visitor's first name when the lead form
  // asked for it, and disappears when it did not. Set to "" to turn it off.
  greeting: 'Hi {name}! How can we help you today?',
  retry: 'Try again',
  dismiss: 'Dismiss',
  newChat: 'Start a new conversation',
  offline: "You're offline",
  // Shown when the challenge could not run at all — a blocked script, a bad
  // site key, or a visitor who never solved it. The server fails closed, so
  // there is nothing to fall back to and saying so is the honest option.
  captchaFailed: 'We could not verify your browser. Please try again.',
  soundOn: 'Turn sound on',
  soundOff: 'Turn sound off',
  poweredBy: 'Powered by Murmur',
  callUs: 'Call us',
  emailUs: 'Email us',
  agentSaid: 'Assistant said',
  flowRunning: 'Answer the questions above, or',
  cancel: 'Cancel',
  helpful: 'Helpful',
  notHelpful: 'Not helpful',
} as const;

export type StringKey = keyof typeof DEFAULT_STRINGS;

export function makeStrings(overrides?: Record<string, string>): (key: StringKey) => string {
  return (key) => overrides?.[key] ?? DEFAULT_STRINGS[key];
}
