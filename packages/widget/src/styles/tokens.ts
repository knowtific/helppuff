import type { WidgetConfig } from '@helppuff/protocol';
import { foregroundFor, rotateHue } from '../lib/color.js';

/**
 * The design token set. Everything the widget renders reads these custom
 * properties, so theming is entirely a matter of overriding them.
 *
 * Rem units are forbidden — they follow the host page's 'html' font-size.
 * Everything here is px or unitless.
 */
export const BASE_TOKENS = `
:host {
  --hp-accent: #5B5BF7;
  --hp-accent-fg: #FFFFFF;
  --hp-accent-2: #7B5BF7;
  --hp-accent-3: #A48BFA;
  --hp-accent-soft: rgba(91, 91, 247, 0.12);

  --hp-bg: #FFFFFF;
  --hp-surface: #F7F7F8;
  --hp-surface-2: #EFEFF1;
  --hp-border: rgba(15, 15, 20, 0.08);
  --hp-text: #111114;
  --hp-text-2: #5C5C66;
  --hp-text-3: #8E8E98;
  --hp-danger: #D93F3F;

  --hp-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
  --hp-text-xs: 12px;
  --hp-text-sm: 13px;
  --hp-text-md: 15px;
  --hp-text-lg: 20px;
  --hp-text-xl: 26px;
  --hp-leading: 1.5;
  --hp-tracking-tight: -0.02em;

  --hp-radius-sm: 10px;
  --hp-radius-md: 16px;
  --hp-radius-lg: 24px;
  --hp-radius-panel: 28px;

  --hp-shadow-panel: 0 24px 80px -20px rgba(15, 15, 30, 0.28), 0 0 0 1px var(--hp-border);
  --hp-shadow-orb: 0 10px 30px -8px rgba(91, 91, 247, 0.55);

  --hp-ease-out: cubic-bezier(.22, 1, .36, 1);
  --hp-ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --hp-dur-fast: 140ms;
  --hp-dur: 220ms;
  --hp-dur-slow: 360ms;

  --hp-panel-w: 400px;
  --hp-panel-h: min(680px, calc(100vh - 120px));
  --hp-z: 2147483000;

  --hp-gap: 12px;
  --hp-pad: 20px;
}

:host([data-theme="dark"]) {
  --hp-bg: #0E0E12;
  --hp-surface: #17171C;
  --hp-surface-2: #202027;
  --hp-border: rgba(255, 255, 255, 0.08);
  --hp-text: #F4F4F6;
  --hp-text-2: #A6A6B0;
  --hp-text-3: #74747E;
  --hp-shadow-panel: 0 24px 80px -20px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--hp-border);
}

@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) {
    --hp-bg: #0E0E12;
    --hp-surface: #17171C;
    --hp-surface-2: #202027;
    --hp-border: rgba(255, 255, 255, 0.08);
    --hp-text: #F4F4F6;
    --hp-text-2: #A6A6B0;
    --hp-text-3: #74747E;
    --hp-shadow-panel: 0 24px 80px -20px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--hp-border);
  }
}
`;

/**
 * Shadow DOM blocks selectors but not inheritance, so font-size, colour,
 * line-height and direction still leak in from the host page. This resets
 * every inherited property explicitly.
 */
export const RESET = `
:host {
  display: block;
  position: fixed;
  inset: 0;
  z-index: var(--hp-z);
  pointer-events: none;
}

/*
 * Typography is established on '.hp-root', inside the shadow root — see the
 * note in 'launcher-shell.ts'. A host page can outrank ':host'; it cannot
 * match anything in here.
 */
.hp-root {
  font-family: var(--hp-font);
  font-size: var(--hp-text-md);
  font-weight: 400;
  font-style: normal;
  line-height: var(--hp-leading);
  letter-spacing: normal;
  text-align: start;
  text-transform: none;
  text-indent: 0;
  white-space: normal;
  word-spacing: normal;
  color: var(--hp-text);
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  pointer-events: none;
}

.hp-launcher, .hp-panel, .hp-teaser { pointer-events: auto; }

:host([dir="rtl"]) .hp-root { direction: rtl; }

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
  outline: 2px solid var(--hp-accent);
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
    `--hp-accent:${accent}`,
    `--hp-accent-fg:${foregroundFor(accent)}`,
    `--hp-accent-2:${rotateHue(accent, 30)}`,
    `--hp-accent-3:${rotateHue(accent, -20, 0.18)}`,
    `--hp-accent-soft:${hexToRgba(accent, 0.12)}`,
    `--hp-shadow-orb:0 10px 30px -8px ${hexToRgba(accent, 0.55)}`,
  ];

  for (const [name, value] of Object.entries(config.brand.tokens ?? {})) {
    declarations.push(`--hp-${name}:${value}`);
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
 * nothing needs 'style-src 'unsafe-inline''. Falls back to a '<style>'
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
