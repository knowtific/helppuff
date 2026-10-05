import type { Message, Shortcut, WidgetConfig } from '@murmur/protocol';
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
    <div class="mm-screen">
      <div class="mm-scroll">
        <div class="mm-home-wash">
          <h1 class="mm-home-title">{config.home.title}</h1>
          <p class="mm-home-sub">{config.home.subtitle}</p>
        </div>

        <div class="mm-home-body">
          <ShortcutTiles shortcuts={shortcuts} onPick={onShortcut} />

          <button type="button" class="mm-btn" disabled={busy} onClick={onStart}>
            {hasSession ? t('resume') : t('start')}
            <Icon name="arrow-right" size={18} />
          </button>

          {hasSession && preview ? (
            <button type="button" class="mm-resume" onClick={onStart}>
              <div class="mm-resume-label">{t('resumeLabel')}</div>
              <div class="mm-resume-preview">{preview}</div>
            </button>
          ) : null}

          {config.home.links ? (
            <div class="mm-home-links">
              <Links title={config.home.links.title} links={config.home.links.items} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
