/**
 * Text hygiene for everything a visitor sends and everything shown back:
 * the server cleans what it receives and what connectors return, and the
 * widget cleans before sending, so stored conversations, the dashboard and
 * the model's context never carry invisible or layout-breaking characters.
 *
 *  - Unicode NFC, `\r\n` → `\n`;
 *  - control characters removed (tab and newline kept);
 *  - invisible characters used to hide text or reorder it on screen removed:
 *    bidi overrides and isolates ("Trojan Source"), zero-width space, word
 *    joiners, BOM, and the tag and supplementary variation-selector blocks
 *    (used to smuggle instructions to a model in text a person cannot see).
 *    Tag characters also spell the England, Scotland and Wales flags, which
 *    then show as a plain black flag. Zero-width (non-)joiners and
 *    left/right marks stay: Persian, Arabic, Indic scripts and emoji
 *    sequences need them;
 *  - runs of combining marks capped ("Zalgo" text);
 *  - blank-line runs collapsed, and for `input`, runs of spaces too.
 */

// Matching control and invisible characters is the point of these two.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE = /[\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u180E\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
const MARK_RUN = /(\p{M}{4})\p{M}+/gu;

export type CleanMode = 'input' | 'output' | 'line';

export function cleanText(value: string, mode: CleanMode = 'output'): string {
  let text = String(value);
  try {
    text = text.normalize('NFC');
  } catch {
    // Unpaired surrogates: normalisation is skipped, the rest still applies.
  }
  text = text.replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(INVISIBLE, '').replace(MARK_RUN, '$1');
  if (mode === 'line') return text.replace(/\s+/g, ' ').trim();
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  if (mode === 'input') text = text.replace(/[ \t\u00A0\u2000-\u200A\u3000]{2,}/g, ' ');
  return text.trim();
}

/**
 * Every string in a JSON-like value cleaned (`output` mode), for a whole
 * message or form answer at once. Depth-limited; non-strings untouched.
 */
export function cleanDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return cleanText(value) as T;
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => cleanDeep(item, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = cleanDeep(item, depth + 1);
  return out as T;
}

/**
 * Chat-template control tokens (`<|im_start|>`, `[INST]`, `<<SYS>>`,
 * `<start_of_turn>`, `</s>` …). A website chat never needs them, and in a
 * prompt they can pose as a turn boundary or a system message. Removed from
 * what visitors send and from anything untrusted put into a prompt.
 */
const CHAT_TOKENS = /<\|[^|<>\n]{1,40}\|>|<\/?(?:s|start_of_turn|end_of_turn|im_start|im_end|bos|eos)>|\[\/?INST\]|<<\/?SYS>>/gi;

export function stripChatTokens(text: string): string {
  return text.replace(CHAT_TOKENS, '');
}
