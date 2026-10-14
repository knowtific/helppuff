import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { Message } from '@helppuff/protocol';
import { Composer } from '../src/components/Composer.js';
import { MessageView, canRender, inertHandlers } from '../src/components/messages/index.js';
import { drawFiles } from '../src/upload/index.js';
import { makeStrings } from '../src/app/strings.js';

/** Photos and files in the widget: the paperclip, and file messages drawn by the upload chunk. */

const t = makeStrings();
const photo = { id: 'f_1', name: 'leak.jpg', type: 'image/jpeg', size: 1000, url: 'https://w.test/v1/files/demo/chat/f_1?e=1&s=x' };
const file: Message = { id: 'm1', ts: 1, role: 'user', type: 'file', files: [photo] };

describe('the paperclip', () => {
  it('shows only when the app allows a file, and hands over the input', () => {
    const props = { value: '', disabled: false, offline: false, placeholder: 'Type', t, onInput: () => {}, onSend: () => {} };
    const { rerender, container } = render(<Composer {...props} />);
    expect(container.querySelector('.hp-attach')).toBeNull();
    const onAttach = vi.fn();
    rerender(<Composer {...props} onAttach={onAttach} />);
    const input = screen.getByLabelText('Send a photo or file') as HTMLInputElement;
    expect(input.accept).toBe('image/*,application/pdf');
    fireEvent.change(input);
    expect(onAttach).toHaveBeenCalledWith(input);
  });
});

describe('file messages', () => {
  it('are drawn: the thread keeps them, and the chunk mounts where they go', () => {
    expect(canRender(file)).toBe(true);
    const mount = vi.fn(() => () => {});
    const { container } = render(<MessageView message={file} handlers={{ ...inertHandlers, files: mount }} />);
    expect(mount).toHaveBeenCalledWith(container.querySelector('div'), file, false);
  });

  it('show photos as pictures and other files as links, with what was written', () => {
    const root = document.createElement('div');
    drawFiles(root, { role: 'agent', text: 'Your quote', files: [photo, { id: 'f_2', name: 'quote.pdf', type: 'application/pdf', size: 10 }] });
    expect(root.querySelector('img')?.getAttribute('alt')).toBe('leak.jpg');
    const links = root.querySelectorAll('a');
    expect(links[0]?.getAttribute('href')).toBe('https://w.test/v1/files/demo/chat/f_1?e=1&s=x');
    expect(links[0]?.getAttribute('rel')).toBe('noopener');
    expect(links[1]?.hasAttribute('href')).toBe(false);
    expect(links[1]?.textContent).toBe('📎 quote.pdf');
    expect(root.querySelector('p')?.textContent).toBe('Your quote');
  });
});
