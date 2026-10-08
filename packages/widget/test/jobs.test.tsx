import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { Message } from '@helppuff/protocol';
import { App, type AppHandleRef } from '../src/app/App.js';
import type { Api } from '../src/app/api.js';
import { parseConfig } from '../src/app/validate.js';
import { Disposer } from '../src/lib/safe.js';
import type { Runtime } from '../src/loader.js';

/**
 * The quote questions (a flow that submits as a job): asked one at a time in
 * the widget, then sent as one action the server saves as a job, starting the
 * chat first when there is none yet.
 */

const QUOTE = {
  id: 'job-quote',
  steps: [
    { field: 'service', ask: 'Which service do you need?', input: 'choice', choices: ['Hot water', 'Blocked drains'] },
    { field: 'address', ask: 'Where is the job?', input: 'text', required: true },
  ],
  submit: { as: 'job', template: 'Get a quote: {{service}} · {{address}}' },
};

function setup(options: { leadForm?: unknown; flow?: typeof QUOTE } = {}) {
  const host = document.createElement('helppuff-widget');
  document.body.appendChild(host);
  const runtime = {
    host,
    root: host.attachShadow({ mode: 'open' }),
    apiBase: 'https://api.test',
    siteId: `jobs-${Math.random()}`,
    rawConfig: {},
    capabilities: { poll: false, end: true, stream: false },
    disposer: new Disposer(),
    version: 'test',
    hide: vi.fn(),
    emit: vi.fn(),
  } as unknown as Runtime;
  const config = parseConfig({
    brand: { name: 'Acme', agentName: 'Alex', accent: '#5B5BF7' },
    leadForm: options.leadForm ?? { enabled: false, fields: [] },
    flows: [options.flow ?? QUOTE],
    home: { title: 'Hi', shortcuts: [{ id: 'job-quote', label: 'Get a quote', icon: 'quote', action: { id: 'job-quote', kind: 'flow', label: 'Get a quote', flowId: 'job-quote' } }] },
  })!;
  const reply: Message = { id: 'j1', ts: Date.now(), role: 'agent', type: 'text', text: 'Thanks! Your request is **#1042**.' };
  const api = {
    startSession: vi.fn(async () => ({ session: { token: 'tok-1', id: 'sid-1', expiresAt: Date.now() + 3600_000 }, messages: [] })),
    send: vi.fn(async () => ({ messages: [reply] })),
    end: vi.fn(),
    rate: vi.fn(),
  };
  const handle: AppHandleRef = { current: null };
  render(<App runtime={runtime} config={config} api={api as unknown as Api} handle={handle} />);
  return { handle, api, config };
}

describe('the quote questions', () => {
  it('parses a flow that submits as a job, and still drops an unknown kind', () => {
    expect(parseConfig({ flows: [QUOTE] })?.flows?.[0]?.submit).toEqual({ as: 'job', template: 'Get a quote: {{service}} · {{address}}' });
    expect(parseConfig({ flows: [{ ...QUOTE, submit: { as: 'email', template: 'x' } }] })?.flows ?? []).toEqual([]);
  });

  it('asks each question, starts the chat, and sends the answers as one job action', async () => {
    const { handle, api } = setup();
    await act(async () => handle.current!.open());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Get a quote/ }));
    });
    const thread = () => within(document.querySelector('.hp-thread') as HTMLElement);
    await waitFor(() => expect(thread().getByText('Which service do you need?')).toBeTruthy());
    await act(async () => {
      fireEvent.click(thread().getByRole('button', { name: 'Hot water' }));
    });
    await waitFor(() => expect(thread().getByText('Where is the job?')).toBeTruthy());
    const box = document.querySelector('.hp-composer textarea') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.input(box, { target: { value: 'Glebe' } });
    });
    await act(async () => {
      fireEvent.click(document.querySelector('.hp-send') as HTMLElement);
    });
    // No chat yet: one is started, then the answers go as a job.
    await waitFor(() => expect(api.send).toHaveBeenCalled());
    expect(api.startSession).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith(
      'tok-1',
      expect.objectContaining({ kind: 'action', actionId: 'jobflow_job-quote', value: JSON.stringify({ service: 'Hot water', address: 'Glebe' }), label: 'Get a quote: Hot water · Glebe' }),
      undefined,
    );
    await waitFor(() => expect(thread().getByText(/#1042/)).toBeTruthy());
  });

  it("takes the lead form's answers from the flow's contact questions, so it is not asked again", async () => {
    const flow = {
      id: 'job-quote',
      steps: [
        { field: 'description', ask: 'What do you need?', input: 'text', required: true },
        { field: 'contact_name', ask: 'What’s your name?', input: 'text', required: true },
        { field: 'contact_phone', ask: 'A phone number?', input: 'phone' },
      ],
      submit: { as: 'job', template: 'Get a quote: {{description}}' },
    } as unknown as typeof QUOTE;
    const leadForm = { enabled: true, fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'phone', label: 'Phone', type: 'tel', required: true }] };
    const { handle, api } = setup({ leadForm, flow });
    await act(async () => handle.current!.open());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Get a quote/ }));
    });
    const thread = () => within(document.querySelector('.hp-thread') as HTMLElement);
    const answer = async (ask: string, text: string) => {
      await waitFor(() => expect(thread().getByText(ask)).toBeTruthy());
      const box = document.querySelector('.hp-composer textarea') as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.input(box, { target: { value: text } });
      });
      await act(async () => {
        fireEvent.click(document.querySelector('.hp-send') as HTMLElement);
      });
    };
    await answer('What do you need?', 'A leaking tank');
    await answer('What’s your name?', 'Quinn');
    await answer('A phone number?', '0400 123 456');
    await waitFor(() => expect(api.send).toHaveBeenCalled());
    expect(document.querySelector('.hp-form input#hp-f-name')).toBeNull();
    expect(api.startSession).toHaveBeenCalledWith(expect.objectContaining({ lead: { name: 'Quinn', phone: '0400 123 456' } }), undefined);
  });
});
