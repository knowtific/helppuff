import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { QuestionsToAnswer } from '../src/components/Gaps';
import { button, byText, click, fakeApi, mount, type, unmount } from './helpers';

/** Questions to answer: answered in a dialog (it becomes one of "Your own answers"), or dismissed. */

const GAP = { id: 'gap_1', question: 'Do you convert cooktops to LPG?', count: 3, firstAskedAt: Date.now() - 86_400_000, lastAskedAt: Date.now() - 3_600_000, conversationId: 'c_9', status: 'open', answerId: null, answeredBy: null };

describe('questions to answer', () => {
  it('answers one in a dialog, which saves it; with nothing left the card goes away', async () => {
    let open = [GAP];
    const calls = fakeApi({
      'GET /knowledge/gaps?status=open&limit=50': () => ({ gaps: open, counts: { open: open.length, answered: 3 - open.length, dismissed: 0 } }),
      'POST /knowledge/gaps/gap_1/answer': () => {
        open = [];
        return { gap: { ...GAP, status: 'answered' }, entry: { id: 'gap-1', chunks: 1 } };
      },
    });
    let answered = 0;
    const view = await mount(<QuestionsToAnswer onAnswered={() => (answered += 1)} />);
    expect(byText(view, /Questions to answer \(1\)/)).toBeTruthy();
    expect(byText(view, /Asked 3 times/)).toBeTruthy();
    await click(button(view, 'Answer'));
    const dialog = view.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Do you convert cooktops to LPG?');
    expect(button(dialog, 'Save answer')!.disabled).toBe(true);
    await type(dialog.querySelector('textarea'), 'No: natural gas only.');
    await click(button(dialog, 'Save answer'));
    expect(calls).toContainEqual({ method: 'POST', path: '/knowledge/gaps/gap_1/answer', body: { answer: 'No: natural gas only.' } });
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(byText(view, /Questions to answer/)).toBeFalsy();
    expect(answered).toBe(1);
    await unmount();
  });

  it('closes the dialog on Escape without saving, and dismisses a question', async () => {
    const calls = fakeApi({
      'GET /knowledge/gaps?status=open&limit=50': { gaps: [GAP], counts: { open: 1, answered: 0, dismissed: 0 } },
      'PATCH /knowledge/gaps/gap_1': { ...GAP, status: 'dismissed' },
    });
    const view = await mount(<QuestionsToAnswer />);
    await click(button(view, 'Answer'));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    await click(button(view, `Dismiss: ${GAP.question}`));
    expect(calls).toContainEqual({ method: 'PATCH', path: '/knowledge/gaps/gap_1', body: { status: 'dismissed' } });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await unmount();
  });
});
