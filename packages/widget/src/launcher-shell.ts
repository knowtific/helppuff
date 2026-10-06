import { launcherIconSvg } from './lib/icons.js';
import type { LauncherHints } from './loader-config.js';

/**
 * The launcher the loader paints before Preact exists. The app renders
 * the same markup and reuses this stylesheet, so the handoff is invisible.
 *
 * Kept small and string-based: this is the only CSS in the loader's budget.
 * The orb's gradient stops are derived from '--hp-accent' in CSS rather than
 * computed in JS, which keeps the colour maths out of both bundles.
 */

export const LOADER_CSS = `
:host {
  display: block;
  position: fixed;
  inset: 0;
  z-index: var(--hp-z, 2147483000);
  pointer-events: none;

  --hp-accent: #5B5BF7;
  --hp-accent-fg: #FFFFFF;
  --hp-bg: #FFFFFF;
  --hp-text: #111114;
  --hp-border: rgba(15, 15, 20, .08);
  --hp-danger: #D93F3F;
  --hp-text-sm: 13px;
  --hp-dur: 220ms;
  --hp-ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --hp-shadow-orb: 0 10px 30px -8px rgba(15, 15, 30, .35);
}

:host([data-theme="dark"]) { --hp-bg: #0E0E12; --hp-text: #F4F4F6; --hp-border: rgba(255,255,255,.08); }
@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) { --hp-bg: #0E0E12; --hp-text: #F4F4F6; --hp-border: rgba(255,255,255,.08); }
}

/*
 * The typography reset lives on an inner wrapper, not on :host. Document
 * rules outrank :host for the host element, and the host's own inline
 * 'all: initial' outranks :host declarations too — so neither is a reliable
 * place to establish the widget's own type. Nothing in the host page can
 * match a shadow-internal element.
 */
.hp-root {
  font-family: var(--hp-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif);
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
  color: var(--hp-text, #111114);
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  /* The host passes clicks through; only the widget's surfaces take them. */
  pointer-events: none;
}
.hp-launcher, .hp-panel, .hp-teaser { pointer-events: auto; }
:host([dir="rtl"]) .hp-root { direction: rtl; }

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font: inherit; color: inherit; line-height: inherit; letter-spacing: inherit; text-align: inherit; }
button { cursor: pointer; background: none; border: none; outline: none; -webkit-appearance: none; appearance: none; user-select: none; }
svg { display: block; fill: none; }
:focus-visible { outline: 2px solid var(--hp-accent); outline-offset: 2px; border-radius: 4px; }

.hp-launcher {
  position: fixed;
  bottom: var(--hp-launcher-y, 24px);
  inset-inline-end: var(--hp-launcher-x, 24px);
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 1;
}
.hp-launcher[data-position="bottom-left"] {
  inset-inline-end: auto;
  inset-inline-start: var(--hp-launcher-x, 24px);
  flex-direction: row-reverse;
}

.hp-orb {
  position: relative;
  width: 56px; height: 56px; min-width: 56px;
  border-radius: 50%;
  display: grid; place-items: center;
  color: var(--hp-accent-fg);
  background-color: var(--hp-accent);
  box-shadow: var(--hp-shadow-orb);
  transition: transform var(--hp-dur) var(--hp-ease-spring);
}
/* A pill widens the button to sit the label inside it. */
.hp-orb[data-shape="pill"] {
  width: auto;
  min-width: 0;
  border-radius: 999px;
  grid-auto-flow: column;
  gap: 9px;
  padding: 0 22px 0 18px;
  /* Same height as the orb, so the shape choice does not move the launcher. */
  height: 56px;
}
.hp-orb-label { font-size: 15px; font-weight: 500; white-space: nowrap; }

.hp-orb:hover { transform: scale(1.06); }
.hp-orb:active { transform: scale(.98); }
.hp-orb svg { width: 24px; height: 24px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

/* The living gradient, derived entirely from the accent. */
@supports (background: color-mix(in oklab, red, blue)) {
  .hp-orb {
    background-image:
      radial-gradient(120% 120% at 30% 25%, rgba(255,255,255,.34), transparent 55%),
      conic-gradient(from var(--hp-orb-angle, 0deg),
        var(--hp-accent),
        color-mix(in oklab, var(--hp-accent) 68%, #ffffff),
        color-mix(in oklab, var(--hp-accent) 74%, #2b0b6b),
        var(--hp-accent));
    animation: hp-drift 12s linear infinite;
  }
}

.hp-label {
  font-size: var(--hp-text-sm);
  font-weight: 500;
  color: var(--hp-text);
  background: var(--hp-bg);
  border: 1px solid var(--hp-border);
  border-radius: 999px;
  padding: 8px 14px;
  box-shadow: 0 4px 14px -6px rgba(15,15,30,.2);
  white-space: nowrap;
}
@media (max-width: 640px) { .hp-label { display: none; } }

.hp-dot {
  position: absolute;
  top: 2px; inset-inline-end: 2px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--hp-danger);
  border: 2px solid var(--hp-bg);
}

@property --hp-orb-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
@keyframes hp-drift { to { --hp-orb-angle: 360deg; } }

@media (prefers-reduced-motion: reduce) {
  .hp-orb { animation: none; transition: none; }
  .hp-orb:hover { transform: none; }
}
`;

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Per-site accent, emitted as one rule so it overrides the defaults above. */
export function accentCss(hints: LauncherHints): string {
  const offset = hints.offset ? `--hp-launcher-x:${hints.offset.x}px;--hp-launcher-y:${hints.offset.y}px;` : '';
  return `:host{--hp-accent:${hints.accent};--hp-accent-fg:${hints.accentFg};${offset}}`;
}

export function launcherMarkup(hints: LauncherHints): string {
  const aria = escapeAttr(hints.label || `Chat with ${hints.name}`);
  const pill = hints.shape === 'pill' && hints.label;
  const icon = launcherIconSvg(hints.icon, 24);

  return (
    `<div class="hp-root">` +
    `<div class="hp-launcher" data-position="${hints.position}">` +
    `<button type="button" class="hp-orb"${pill ? ' data-shape="pill"' : ''}` +
    ` aria-label="${aria}" aria-expanded="false" aria-haspopup="dialog">` +
    icon +
    (pill ? `<span class="hp-orb-label">${escapeAttr(hints.label)}</span>` : '') +
    `</button>` +
    (hints.label && !pill ? `<span class="hp-label">${escapeAttr(hints.label)}</span>` : '') +
    `</div></div>`
  );
}
