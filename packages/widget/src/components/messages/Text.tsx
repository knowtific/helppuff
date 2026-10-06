import { renderMarkdown } from '../../lib/markdown.js';

/**
 * The only `dangerouslySetInnerHTML` in the widget. Its input is built
 * by `renderMarkdown`, which escapes everything and emits an allowlisted set
 * of tags, and is covered by the XSS suite in `test/markdown.test.ts`.
 */
export function TextMessage({ text }: { text: string }) {
  return <div class="hp-agent" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

export function UserMessage({ text }: { text: string }) {
  return <div class="hp-user">{text}</div>;
}
