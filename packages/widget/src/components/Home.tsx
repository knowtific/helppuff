import type { Message, WidgetConfig } from '@murmur/protocol';
import { stripMarkdown } from '../lib/markdown.js';
import { Icon } from './Icon.js';
import type { StringKey } from '../app/strings.js';

/**
 * M2 builds the title, subtitle and the start/resume control. Shortcut tiles
 * and the help-links section arrive in M4.
 */
export function Home({
  config,
  hasSession,
  lastMessage,
  busy,
  t,
  onStart,
}: {
  config: WidgetConfig;
  hasSession: boolean;
  lastMessage: Message | undefined;
  busy: boolean;
  t: (key: StringKey) => string;
  onStart: () => void;
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
        </div>
      </div>
    </div>
  );
}
