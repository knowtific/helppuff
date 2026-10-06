import type { Message, Shortcut, WidgetConfig } from '@helppuff/protocol';
import { stripMarkdown } from '../lib/markdown.js';
import { Icon } from './Icon.js';
import { Links } from './messages/Links.js';
import { ShortcutTiles } from './Shortcuts.js';
import type { StringKey } from '../app/strings.js';

export function Home({
  config,
  shortcuts,
  hasSession,
  lastMessage,
  busy,
  t,
  onStart,
  onShortcut,
}: {
  config: WidgetConfig;
  /** Already filtered by `paths` for the current page. */
  shortcuts: Shortcut[];
  hasSession: boolean;
  lastMessage: Message | undefined;
  busy: boolean;
  t: (key: StringKey) => string;
  onStart: () => void;
  onShortcut: (shortcut: Shortcut) => void;
}) {
  const preview =
    lastMessage && (lastMessage.type === 'text' || lastMessage.type === 'notice')
      ? stripMarkdown(lastMessage.text)
      : '';

  return (
    <div class="hp-screen">
      <div class="hp-scroll">
        <div class="hp-home-wash">
          <h1 class="hp-home-title">{config.home.title}</h1>
          <p class="hp-home-sub">{config.home.subtitle}</p>
        </div>

        <div class="hp-home-body">
          <ShortcutTiles shortcuts={shortcuts} onPick={onShortcut} />

          <button type="button" class="hp-btn" disabled={busy} onClick={onStart}>
            {hasSession ? t('resume') : t('start')}
            <Icon name="arrow-right" size={18} />
          </button>

          {hasSession && preview ? (
            <button type="button" class="hp-resume" onClick={onStart}>
              <div class="hp-resume-label">{t('resumeLabel')}</div>
              <div class="hp-resume-preview">{preview}</div>
            </button>
          ) : null}

          {config.home.links ? (
            <div class="hp-home-links">
              <Links title={config.home.links.title} links={config.home.links.items} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
