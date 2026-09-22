import type { WidgetConfig } from '@murmur/protocol';
import { foregroundFor, rotateHue } from '../lib/color.js';

/**
 * §9.3's token set. Everything the widget renders reads these custom
 * properties, so theming is entirely a matter of overriding them.
 *
 * Rem units are forbidden — they follow the host page's 'html' font-size
 * (§8.2). Everything here is px or unitless.
 */
export const BASE_TOKENS = `
:host {
  --mm-accent: #5B5BF7;
  --mm-accent-fg: #FFFFFF;
  --mm-accent-2: #7B5BF7;
  --mm-accent-3: #A48BFA;
  --mm-accent-soft: rgba(91, 91, 247, 0.12);

  --mm-bg: #FFFFFF;
  --mm-surface: #F7F7F8;
  --mm-surface-2: #EFEFF1;
  --mm-border: rgba(15, 15, 20, 0.08);
  --mm-text: #111114;
  --mm-text-2: #5C5C66;
  --mm-text-3: #8E8E98;
  --mm-danger: #D93F3F;

  --mm-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
  --mm-text-xs: 12px;
  --mm-text-sm: 13px;
  --mm-text-md: 15px;
  --mm-text-lg: 20px;
  --mm-text-xl: 26px;
  --mm-leading: 1.5;
  --mm-tracking-tight: -0.02em;

  --mm-radius-sm: 10px;
  --mm-radius-md: 16px;
  --mm-radius-lg: 24px;
  --mm-radius-panel: 28px;

  --mm-shadow-panel: 0 24px 80px -20px rgba(15, 15, 30, 0.28), 0 0 0 1px var(--mm-border);
  --mm-shadow-orb: 0 10px 30px -8px rgba(91, 91, 247, 0.55);

  --mm-ease-out: cubic-bezier(.22, 1, .36, 1);
  --mm-ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --mm-dur-fast: 140ms;
  --mm-dur: 220ms;
  --mm-dur-slow: 360ms;

  --mm-panel-w: 400px;
  --mm-panel-h: min(680px, calc(100vh - 120px));
  --mm-z: 2147483000;

  --mm-gap: 12px;
  --mm-pad: 20px;
}

:host([data-theme="dark"]) {
  --mm-bg: #0E0E12;
  --mm-surface: #17171C;
  --mm-surface-2: #202027;
  --mm-border: rgba(255, 255, 255, 0.08);
  --mm-text: #F4F4F6;
  --mm-text-2: #A6A6B0;
  --mm-text-3: #74747E;
  --mm-shadow-panel: 0 24px 80px -20px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--mm-border);
}

@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) {
    --mm-bg: #0E0E12;
    --mm-surface: #17171C;
    --mm-surface-2: #202027;
    --mm-border: rgba(255, 255, 255, 0.08);
    --mm-text: #F4F4F6;
    --mm-text-2: #A6A6B0;
    --mm-text-3: #74747E;
    --mm-shadow-panel: 0 24px 80px -20px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--mm-border);
  }
}
`;

/**
 * Shadow DOM blocks selectors but not inheritance, so font-size, colour,
 * line-height and direction still leak in from the host page. This resets
 * every inherited property explicitly (§8.2).
 */
export const RESET = `
:host {
  display: block;
  position: fixed;
  inset: 0;
  z-index: var(--mm-z);
  pointer-events: none;
}

/*
 * Typography is established on '.mm-root', inside the shadow root — see the
 * note in 'launcher-shell.ts'. A host page can outrank ':host'; it cannot
 * match anything in here.
 */
.mm-root {
  font-family: var(--mm-font);
  font-size: var(--mm-text-md);
  font-weight: 400;
  font-style: normal;
  line-height: var(--mm-leading);
  letter-spacing: normal;
  text-align: start;
  text-transform: none;
  text-indent: 0;
  white-space: normal;
  word-spacing: normal;
  color: var(--mm-text);
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  pointer-events: none;
}

.mm-launcher, .mm-panel, .mm-teaser { pointer-events: auto; }

:host([dir="rtl"]) .mm-root { direction: rtl; }

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  text-align: inherit;
}

button, input, textarea, select {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

button { cursor: pointer; user-select: none; }
a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
svg { display: block; fill: none; }

:focus-visible {
  outline: 2px solid var(--mm-accent);
  outline-offset: 2px;
  border-radius: 4px;
}
`;

/**
 * Per-site overrides, emitted as a second rule so they win over the base
 * tokens. Values were validated at the boundary, so nothing here can close a
 * declaration or pull in a remote resource.
 */
export function themeOverrides(config: WidgetConfig): string {
  const accent = config.brand.accent;
  const declarations: string[] = [
    `--mm-accent:${accent}`,
    `--mm-accent-fg:${foregroundFor(accent)}`,
    `--mm-accent-2:${rotateHue(accent, 30)}`,
    `--mm-accent-3:${rotateHue(accent, -20, 0.18)}`,
    `--mm-accent-soft:${hexToRgba(accent, 0.12)}`,
    `--mm-shadow-orb:0 10px 30px -8px ${hexToRgba(accent, 0.55)}`,
  ];

  for (const [name, value] of Object.entries(config.brand.tokens ?? {})) {
    declarations.push(`--mm-${name}:${value}`);
  }

  return `:host{${declarations.join(';')}}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace(/^#/, '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Apply a stylesheet to a shadow root, preferring a constructable sheet so
 * nothing needs 'style-src 'unsafe-inline'' (§8.2). Falls back to a '<style>'
 * element inside the root — never 'document.head'.
 */
export function applyStyles(root: ShadowRoot, css: string): () => void {
  try {
    if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return () => {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
      };
    }
  } catch {
    // Fall through to the element-based path.
  }

  const style = document.createElement('style');
  style.textContent = css;
  root.appendChild(style);
  return () => style.remove();
}
