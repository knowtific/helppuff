/**
 * Lines of an owner's prompt that repeat, or fight, what Murmur already says
 * from settings and its rules (`core/guidance.ts`, the connector's own
 * rules). Shown beside the prompt editor and by `murmur prompt`, so the
 * prompt holds only what is specific to the business. A suggestion, never a
 * block: the owner decides.
 */

export type Overlap = { line: number; text: string; why: string };

type Check = { test: RegExp; why: string; workersAiOnly?: boolean };

const CHECKS: Check[] = [
  { test: /^\s*you are\b.*\b(assistant|chatbot|bot|agent)\b/i, why: 'Who the assistant is comes from Settings (the assistant and business names).' },
  { test: /\b(main job|your (main )?goal|your job is)\b/i, why: 'The goal is a setting: Instructions → Main goal.' },
  { test: /\b(be|sound|stay|keep it) (warm|friendly|professional|casual|polite|courteous|relaxed)\b/i, why: 'Tone is a setting: Instructions → Tone.' },
  {
    test: /\b(keep (answers|replies|it) (short|brief)|be (warm, )?(clear and )?brief|(one|two|three|four|\d+) (to (two|three|four|five|\d+) )?(short )?(sentences|paragraphs))\b/i,
    why: 'Answer length is a setting: Instructions → Answer length.',
  },
  { test: /\bmarkdown\b|\bno (headings|tables)\b/i, why: 'Formatting is built in.' },
  { test: /\b(never|don'?t|do not) (quote|give|share|mention) (any )?(prices?|pricing|costs?)\b/i, why: 'Whether to give prices is a setting: Instructions → Prices.' },
  { test: /\bspeak as (part of|a member of)\b|"we" and "our"/i, why: 'Built in: the assistant always speaks as the team.' },
  { test: /\b(never|don'?t|do not) (invent|make up|guess)\b/i, why: 'Built in: Murmur’s rules already forbid inventing prices, policies or promises.' },
  { test: /\b(reveal|share|disclose) (your|these|the) (instructions|rules|prompt|system prompt)\b/i, why: 'Built in: the assistant never reveals its instructions.' },
  { test: /\{\{\s*lead\.\w+\s*\}\}/, why: 'The visitor’s form answers are given to the assistant automatically.', workersAiOnly: true },
  {
    test: /(\+?\d[\d\s().-]{7,}\d)|[\w.+-]+@[\w-]+\.[\w.]+/,
    why: 'Contact details come from Knowledge → Business details and stay current: write {{business.phone}} or {{business.email}} instead of a copy.',
    workersAiOnly: true,
  },
  {
    test: /\b(wants?|asks? for) (a person|a human|someone|to talk|a quote|a booking)\b|\bask for their name and\b|\bbest way to reach\b/i,
    why: 'Callbacks are built in: the assistant offers one and asks only for details it does not already have.',
    workersAiOnly: true,
  },
];

export function promptOverlaps(text: string, connectorType: string): Overlap[] {
  const found: Overlap[] = [];
  text.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    const check = CHECKS.find((c) => (!c.workersAiOnly || connectorType === 'workers-ai') && c.test.test(line));
    if (check) found.push({ line: index + 1, text: line.trim().slice(0, 200), why: check.why });
  });
  return found;
}
