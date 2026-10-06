import { describe, expect, it } from 'vitest';
import type { Flow, WidgetConfig } from '@helppuff/protocol';
import { parseConfig } from '../src/app/validate.js';
import {
  FLOW_ID_PREFIX,
  findFlow,
  flowMessageId,
  isComplete,
  isFlowMessage,
  renderTemplate,
  stepAt,
  stepMessage,
  validateAnswer,
} from '../src/flows/runner.js';

const QUOTE: Flow = {
  id: 'quote',
  steps: [
    { field: 'job', ask: 'What do you need done?', input: 'text', required: true },
    { field: 'suburb', ask: 'Which suburb?', input: 'text', required: true },
    { field: 'when', ask: 'When suits?', input: 'choice', choices: ['Today', 'This week', 'Just pricing'] },
  ],
  submit: { as: 'message', template: "I'd like a quote for {{job}} in {{suburb}}, {{when}}." },
};

const config = (flows: Flow[] = [QUOTE]): WidgetConfig => parseConfig({ flows }) as WidgetConfig;

describe('finding a flow', () => {
  it('finds one by id', () => {
    expect(findFlow(config(), 'quote')?.id).toBe('quote');
  });

  it('returns null for an id that is not configured', () => {
    expect(findFlow(config(), 'nope')).toBeNull();
  });

  it('returns null when the site configures no flows at all', () => {
    expect(findFlow(parseConfig({}) as WidgetConfig, 'quote')).toBeNull();
  });
});

describe('steps', () => {
  it('reads a step by index and reports completion past the end', () => {
    expect(stepAt(QUOTE, 0)?.field).toBe('job');
    expect(stepAt(QUOTE, 3)).toBeNull();
    expect(isComplete(QUOTE, 2)).toBe(false);
    expect(isComplete(QUOTE, 3)).toBe(true);
  });

  it('renders a text step as an agent message', () => {
    const message = stepMessage(QUOTE, 0, 1000);
    expect(message).toMatchObject({ type: 'text', role: 'agent', text: 'What do you need done?', ts: 1000 });
  });

  it('renders a choice step as options the visitor can tap', () => {
    const message = stepMessage(QUOTE, 2, 1000);
    expect(message).toMatchObject({ type: 'options', text: 'When suits?' });
    expect((message as { options: unknown[] }).options).toHaveLength(3);
  });

  it('falls back to text when a choice step lists no choices', () => {
    const flow: Flow = { ...QUOTE, steps: [{ field: 'a', ask: 'Pick', input: 'choice' }] };
    expect(stepMessage(flow, 0)).toMatchObject({ type: 'text' });
  });

  it('returns nothing past the last step', () => {
    expect(stepMessage(QUOTE, 9)).toBeNull();
  });

  it('marks its messages so a pick can be routed back to the flow', () => {
    const id = flowMessageId('quote', 1);
    expect(id.startsWith(FLOW_ID_PREFIX)).toBe(true);
    expect(isFlowMessage(id)).toBe(true);
    expect(isFlowMessage('echo_abc')).toBe(false);
  });
});

describe('the submitted message', () => {
  it('fills the template from the answers', () => {
    expect(
      renderTemplate(QUOTE.submit.template, { job: 'a blocked drain', suburb: 'Richmond', when: 'Today' }),
    ).toBe("I'd like a quote for a blocked drain in Richmond, Today.");
  });

  it('leaves an unanswered placeholder empty rather than printing it', () => {
    const text = renderTemplate(QUOTE.submit.template, { job: 'a drain', suburb: 'Richmond' });
    expect(text).not.toContain('{{');
    expect(text).toBe("I'd like a quote for a drain in Richmond, .");
  });

  it('collapses the whitespace a missing answer leaves behind', () => {
    expect(renderTemplate('A {{x}} B', {})).toBe('A B');
  });
});

describe('validateAnswer', () => {
  const step = (over: Partial<Flow['steps'][number]> = {}) =>
    ({ field: 'f', ask: 'Q', input: 'text', ...over }) as Flow['steps'][number];

  it.each([
    ['a required blank', step({ required: true }), '', /answer to continue/],
    ['a bad email', step({ input: 'email' }), 'nope', /valid email/],
    ['a bad phone', step({ input: 'phone' }), 'abc', /valid phone/],
    ['an off-list choice', step({ input: 'choice', choices: ['a'] }), 'b', /one of the options/],
    ['an over-long answer', step(), 'x'.repeat(501), /too long/],
  ])('rejects %s', (_name, s, value, expected) => {
    expect(validateAnswer(s, value)).toMatch(expected);
  });

  it.each([
    ['an optional blank', step(), ''],
    ['a good email', step({ input: 'email' }), 'a@b.co'],
    ['a good phone', step({ input: 'phone' }), '+61 400 000 000'],
    ['a listed choice', step({ input: 'choice', choices: ['a', 'b'] }), 'b'],
    ['ordinary text', step({ required: true }), 'a blocked drain'],
  ])('accepts %s', (_name, s, value) => {
    expect(validateAnswer(s, value)).toBeNull();
  });
});
