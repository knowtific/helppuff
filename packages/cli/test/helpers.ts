import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type Route = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;

/** A fetch that answers from a list of routes and records every call. */
export function fakeFetch(routes: Route[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const doFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), method: init.method ?? 'GET', body: init.body });
    for (const route of routes) {
      const response = await route(url, init);
      if (response) return response;
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: doFetch, calls };
}

export const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { ...init, headers: { 'content-type': 'text/html; charset=utf-8', ...(init.headers ?? {}) } });

export const cf = (result: unknown, init: ResponseInit & { info?: object } = {}) =>
  Response.json({ success: true, errors: [], result, ...(init.info ? { result_info: init.info } : {}) }, init);

export function tempProject(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'helppuff-test-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

export const ACME_HOME = `<!doctype html><html lang="en-AU"><head>
<title>Home | Acme Plumbing — Sydney's plumbers</title>
<meta name="description" content="Fast, friendly plumbing across Sydney.">
<meta name="theme-color" content="#0ea5e9">
<link rel="apple-touch-icon" href="/icon.png">
</head><body>
<header><nav><a href="/pricing">Our prices</a><a href="/contact-us">Contact</a><a href="/faq">FAQ</a></nav></header>
<main><h1>Plumbing, sorted.</h1><p>Blocked drains, hot water, leaks. We come to you the same day across Sydney and the Blue Mountains.</p>
<ul><li>Licensed and insured</li><li>Upfront pricing</li></ul></main>
<footer><a href="tel:+61 2 9000 0000">Call</a> <a href="mailto:hello@acme.com.au">Email</a></footer>
</body></html>`;
