import type { Flow, FlowStep, Message, WidgetConfig } from '@murmur/protocol';

/**
 * Multi-step shortcuts, run entirely client-side (§8.7). Each step appears as
 * an agent-style message; nothing reaches the server until the last answer is
 * in, at which point the template is rendered and sent as one message.
 *
 * This module is pure — the orchestration lives in the app, so every rule
 * here is testable without a DOM.
 */

/** Flow step messages are recognisable by their id, so picks can be routed. */
export const FLOW_ID_PREFIX = 'mmflow_';

export const flowMessageId = (flowId: string, step: number) => `${FLOW_ID_PREFIX}${flowId}_${step}`;

export const isFlowMessage = (id: string) => id.startsWith(FLOW_ID_PREFIX);

export function findFlow(config: WidgetConfig, flowId: string): Flow | null {
  return config.flows?.find((flow) => flow.id === flowId) ?? null;
}

export function stepAt(flow: Flow, index: number): FlowStep | null {
  return flow.steps[index] ?? null;
}

export function isComplete(flow: Flow, index: number): boolean {
  return index >= flow.steps.length;
}

/**
 * The prompt for one step. A `choice` step carries its options so the visitor
 * can tap; the others are answered in the composer.
 */
export function stepMessage(flow: Flow, index: number, now = Date.now()): Message | null {
  const step = stepAt(flow, index);
  if (!step) return null;

  const id = flowMessageId(flow.id, index);
  const base = { id, ts: now, role: 'agent' as const };

  if (step.input === 'choice' && step.choices && step.choices.length > 0) {
    return {
      ...base,
      type: 'options',
      text: step.ask,
      options: step.choices.map((choice, i) => ({ id: `${id}_${i}`, label: choice, value: choice })),
    };
  }

  return { ...base, type: 'text', text: step.ask };
}

/** `{{field}}` placeholders, filled from the answers collected so far. */
export function renderTemplate(template: string, answers: Record<string, string>): string {
  return template
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => answers[key] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether an answer is acceptable for the step. Required steps need
 * something; the typed steps reuse the same rules as the forms.
 */
export function validateAnswer(step: FlowStep, raw: string): string | null {
  const value = raw.trim();
  if (!value) return step.required ? 'Please answer to continue.' : null;
  if (value.length > 500) return 'That is a little too long.';
  if (step.input === 'email' && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(value)) {
    return 'Enter a valid email address.';
  }
  if (step.input === 'phone' && !/^[+()\-.\s\d]{6,40}$/.test(value)) {
    return 'Enter a valid phone number.';
  }
  if (step.input === 'choice' && step.choices && !step.choices.includes(value)) {
    return 'Choose one of the options.';
  }
  return null;
}
