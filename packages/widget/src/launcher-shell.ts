import type { LauncherHints } from './loader-config.js';

/**
 * The launcher the loader paints before Preact exists (§8.4). The app renders
 * the same markup and reuses this stylesheet, so the handoff is invisible.
 *
 * Kept small and string-based: this is the only CSS in the loader's budget.
 * The orb's gradient stops are derived from '--mm-accent' in CSS rather than
 * computed in JS, which keeps the colour maths out of both bundles.
 */

export const LOADER_CSS = `
:host {
  display: block;
  position: fixed;
  inset: 0;
  z-index: var(--mm-z, 2147483000);
  pointer-events: none;

  --mm-accent: #5B5BF7;
  --mm-accent-fg: #FFFFFF;
  --mm-bg: #FFFFFF;
  --mm-text: #111114;
  --mm-border: rgba(15, 15, 20, .08);
  --mm-danger: #D93F3F;
  --mm-text-sm: 13px;
  --mm-dur: 220ms;
  --mm-ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --mm-shadow-orb: 0 10px 30px -8px rgba(15, 15, 30, .35);
}

:host([data-theme="dark"]) { --mm-bg: #0E0E12; --mm-text: #F4F4F6; --mm-border: rgba(255,255,255,.08); }
@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) { --mm-bg: #0E0E12; --mm-text: #F4F4F6; --mm-border: rgba(255,255,255,.08); }
}

/*
 * The typography reset lives on an inner wrapper, not on :host. Document
 * rules outrank :host for the host element, and the host's own inline
 * 'all: initial' outranks :host declarations too — so neither is a reliable
 * place to establish the widget's own type. Nothing in the host page can
 * match a shadow-internal element (§8.2).
 */
.mm-root {
  font-family: var(--mm-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif);
  font-size: 15px;
  font-weight: 400;
  font-style: normal;
  line-height: 1.5;
  letter-spacing: normal;
  word-spacing: normal;
  text-align: start;
  text-transform: none;
  text-indent: 0;
  white-space: normal;
  color: var(--mm-text, #111114);
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  /* The host passes clicks through; only the widget's surfaces take them. */
  pointer-events: none;
}
.mm-launcher, .mm-panel, .mm-teaser { pointer-events: auto; }
:host([dir="rtl"]) .mm-root { direction: rtl; }

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font: inherit; color: inherit; line-height: inherit; letter-spacing: inherit; text-align: inherit; }
button { cursor: pointer; background: none; border: none; outline: none; -webkit-appearance: none; appearance: none; user-select: none; }
svg { display: block; fill: none; }
:focus-visible { outline: 2px solid var(--mm-accent); outline-offset: 2px; border-radius: 4px; }

.mm-launcher {
  position: fixed;
  bottom: var(--mm-launcher-y, 24px);
  inset-inline-end: var(--mm-launcher-x, 24px);
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 1;
}
.mm-launcher[data-position="bottom-left"] {
  inset-inline-end: auto;
  inset-inline-start: var(--mm-launcher-x, 24px);
  flex-direction: row-reverse;
}

.mm-orb {
  position: relative;
  width: 56px; height: 56px; min-width: 56px;
  border-radius: 50%;
  display: grid; place-items: center;
  color: var(--mm-accent-fg);
  background-color: var(--mm-accent);
  box-shadow: var(--mm-shadow-orb);
  transition: transform var(--mm-dur) var(--mm-ease-spring);
}
.mm-orb:hover { transform: scale(1.06); }
.mm-orb:active { transform: scale(.98); }
.mm-orb svg { width: 24px; height: 24px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

/* The living gradient (§9.2), derived entirely from the accent. */
@supports (background: color-mix(in oklab, red, blue)) {
  .mm-orb {
    background-image:
      radial-gradient(120% 120% at 30% 25%, rgba(255,255,255,.34), transparent 55%),
      conic-gradient(from var(--mm-orb-angle, 0deg),
        var(--mm-accent),
        color-mix(in oklab, var(--mm-accent) 68%, #ffffff),
        color-mix(in oklab, var(--mm-accent) 74%, #2b0b6b),
        var(--mm-accent));
    animation: mm-drift 12s linear infinite;
  }
}

.mm-label {
  font-size: var(--mm-text-sm);
  font-weight: 500;
  color: var(--mm-text);
  background: var(--mm-bg);
  border: 1px solid var(--mm-border);
  border-radius: 999px;
  padding: 8px 14px;
  box-shadow: 0 4px 14px -6px rgba(15,15,30,.2);
  white-space: nowrap;
}
@media (max-width: 640px) { .mm-label { display: none; } }

.mm-dot {
  position: absolute;
  top: 2px; inset-inline-end: 2px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--mm-danger);
  border: 2px solid var(--mm-bg);
}

@property --mm-orb-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
@keyframes mm-drift { to { --mm-orb-angle: 360deg; } }

@media (prefers-reduced-motion: reduce) {
  .mm-orb { animation: none; transition: none; }
  .mm-orb:hover { transform: none; }
}
`;

export const CHAT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-8 8H6.5L4 22v-4.2A8 8 0 1 1 20 12Z"/></svg>';

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Per-site accent, emitted as one rule so it overrides the defaults above. */
export function accentCss(hints: LauncherHints): string {
  const offset = hints.offset ? `--mm-launcher-x:${hints.offset.x}px;--mm-launcher-y:${hints.offset.y}px;` : '';
  return `:host{--mm-accent:${hints.accent};--mm-accent-fg:${hints.accentFg};${offset}}`;
}

export function launcherMarkup(hints: LauncherHints): string {
  const aria = escapeAttr(hints.label || `Chat with ${hints.name}`);
  return (
    `<div class="mm-root">` +
    `<div class="mm-launcher" data-position="${hints.position}">` +
    `<button type="button" class="mm-orb" aria-label="${aria}" aria-expanded="false" aria-haspopup="dialog">${CHAT_ICON}</button>` +
    (hints.label ? `<span class="mm-label">${escapeAttr(hints.label)}</span>` : '') +
    `</div></div>`
  );
}
