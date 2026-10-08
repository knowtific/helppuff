import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { Me } from '../src/lib/api';

/**
 * Real components in a real DOM (happy-dom), with `/admin/api` answered in
 * the test: each test says what each route returns and sees what was sent.
 */

export type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => unknown;

/** Answer `/admin/api` from `routes` (`"GET /prefs"` → a value or a function); everything else is a 404. */
export function fakeApi(routes: Record<string, unknown | Handler>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://dashboard.test');
      const path = url.pathname.replace(/^\/admin\/api/, '') + url.search;
      const method = (init.method ?? 'GET').toUpperCase();
      const call = { method, path, body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined };
      calls.push(call);
      const route = routes[`${method} ${path}`] ?? routes[`${method} ${url.pathname.replace(/^\/admin\/api/, '')}`];
      if (route === undefined) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not in this test.' } }), { status: 404 });
      const value = typeof route === 'function' ? (route as Handler)(call) : route;
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

let root: Root | null = null;

export async function mount(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
  await flush();
  return container;
}

export async function unmount(): Promise<void> {
  await act(async () => root?.unmount());
  root = null;
}

/** Let pending fetches and effects settle. */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('nothing to click');
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

/** Type into an input or textarea the way React sees it. */
export async function type(element: Element | null | undefined, value: string): Promise<void> {
  if (!element) throw new Error('nothing to type into');
  const input = element as HTMLInputElement;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function select(element: Element | null | undefined, value: string): Promise<void> {
  if (!element) throw new Error('no select');
  const node = element as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

export const byText = (container: ParentNode, text: string | RegExp, selector = '*'): HTMLElement | undefined =>
  [...container.querySelectorAll<HTMLElement>(selector)].find((el) => (typeof text === 'string' ? el.textContent?.trim() === text : text.test(el.textContent ?? '')) && ![...el.children].some((c) => (typeof text === 'string' ? c.textContent?.trim() === text : text.test(c.textContent ?? ''))));

export const button = (container: ParentNode, name: string | RegExp): HTMLButtonElement | undefined =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => {
    const label = b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '';
    return typeof name === 'string' ? label === name : name.test(label);
  });

export function me(role: 'owner' | 'admin' | 'member', live = true): Me {
  return {
    admin: { email: role === 'member' ? 'mo@acme.test' : 'owner@acme.test', owner: role === 'owner', role, name: role === 'member' ? 'Mo' : 'Olivia' },
    sites: [{ id: 'acme', name: 'Acme', accent: '#5B5BF7', avatar: null, embed: '', connector: 'workers-ai', knowledge: true, website: null, live }],
    summaries: true,
  };
}
