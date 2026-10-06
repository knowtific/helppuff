/**
 * Every widget style, as one string. Applied to the shadow root with a
 * constructable stylesheet, so nothing is ever added to 'document.head' and
 * no 'style-src 'unsafe-inline'' is needed.
 *
 * Logical properties throughout ('inset-inline', 'margin-inline', 'padding-
 * block') so RTL works without a second stylesheet.
 */
export const WIDGET_CSS = `
/* ---------------------------------------------------------------- panel */

/*
 * Turnstile's container. It collapses to nothing until a challenge is actually
 * rendered, so the common case - 'interaction-only', where the visitor is
 * never asked anything - costs no layout at all.
 */
.hp-captcha { display: none; }
.hp-captcha[data-active='yes'] { display: block; padding: 8px 16px 0; min-height: 0; }
.hp-captcha[data-active='yes']:empty { display: none; }

.hp-panel {
  position: fixed;
  bottom: calc(var(--hp-launcher-y, 24px) + 72px);
  inset-inline-end: var(--hp-launcher-x, 24px);
  width: var(--hp-panel-w);
  max-width: calc(100vw - 32px);
  height: var(--hp-panel-h);
  display: flex;
  flex-direction: column;
  background: var(--hp-bg);
  border-radius: var(--hp-radius-panel);
  box-shadow: var(--hp-shadow-panel);
  overflow: hidden;
  transform-origin: bottom right;
  animation: hp-panel-in var(--hp-dur-slow) var(--hp-ease-out) both;
  /* Above the launcher: at mobile widths the panel is full screen and would
     otherwise sit underneath the orb, which then swallows taps meant for the
     composer. */
  z-index: 2;
}
.hp-panel[data-position="bottom-left"] {
  inset-inline-end: auto;
  inset-inline-start: var(--hp-launcher-x, 24px);
  transform-origin: bottom left;
}
.hp-panel[data-closing] { animation: hp-panel-out var(--hp-dur) var(--hp-ease-out) both; }

@keyframes hp-panel-in {
  from { opacity: 0; transform: scale(.92) translateY(12px); }
  to   { opacity: 1; transform: none; }
}
@keyframes hp-panel-out {
  from { opacity: 1; transform: none; }
  to   { opacity: 0; transform: scale(.96) translateY(8px); }
}

/* --------------------------------------------------------------- header */

.hp-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px var(--hp-pad);
  border-bottom: 1px solid var(--hp-border);
  background: color-mix(in srgb, var(--hp-bg) 82%, transparent);
  position: relative;
  z-index: 2;
  flex: none;
}
@supports (backdrop-filter: blur(16px)) {
  .hp-header { backdrop-filter: blur(16px); }
}

.hp-header-orb {
  width: 34px; height: 34px; min-width: 34px;
  border-radius: 50%;
  background:
    radial-gradient(120% 120% at 30% 25%, rgba(255,255,255,.34), transparent 55%),
    conic-gradient(from var(--hp-orb-angle, 0deg),
      var(--hp-accent), var(--hp-accent-2), var(--hp-accent-3), var(--hp-accent));
  animation: hp-drift 12s linear infinite;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.hp-header-orb img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.hp-header-orb[data-thinking] { animation: hp-drift 12s linear infinite, hp-pulse 1.4s ease-in-out infinite; }
@keyframes hp-pulse { 50% { transform: scale(1.08); opacity: .82; } }

.hp-header-text { flex: 1; min-width: 0; }
.hp-header-name {
  font-size: var(--hp-text-md); font-weight: 600;
  letter-spacing: var(--hp-tracking-tight);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hp-header-status { font-size: var(--hp-text-xs); color: var(--hp-text-3); }

.hp-icon-btn {
  /* Accessibility: every target is at least 44x44. */
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 10px;
  display: grid; place-items: center;
  color: var(--hp-text-2);
  transition: background var(--hp-dur-fast) var(--hp-ease-out), color var(--hp-dur-fast);
}
.hp-icon-btn:hover { background: var(--hp-surface-2); color: var(--hp-text); }
.hp-icon-btn svg { width: 20px; height: 20px; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

/* --------------------------------------------------------------- screens */

.hp-screen {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  animation: hp-screen-in var(--hp-dur) var(--hp-ease-out) both;
}
@keyframes hp-screen-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: none; }
}

.hp-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  /* A platform scrollbar with stepper arrows is louder than anything else in
     the panel, so the thread draws a quiet one of its own. */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--hp-text) 22%, transparent) transparent;
}
.hp-scroll::-webkit-scrollbar { width: 10px; }
.hp-scroll::-webkit-scrollbar-track { background: transparent; }
.hp-scroll::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.hp-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--hp-text) 20%, transparent);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.hp-scroll::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--hp-text) 34%, transparent);
  background-clip: content-box;
}

/* ------------------------------------------------------------------ home */

.hp-home-wash {
  padding: 28px var(--hp-pad) 24px;
  background: linear-gradient(180deg, var(--hp-accent-soft), transparent);
}
.hp-home-title {
  font-size: var(--hp-text-xl);
  font-weight: 600;
  letter-spacing: var(--hp-tracking-tight);
  line-height: 1.2;
}
.hp-home-sub { margin-top: 6px; color: var(--hp-text-2); font-size: var(--hp-text-md); }
.hp-home-body { padding: 0 var(--hp-pad) var(--hp-pad); }

.hp-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 12px 18px;
  border-radius: var(--hp-radius-md);
  background: var(--hp-accent);
  color: var(--hp-accent-fg);
  font-size: var(--hp-text-md);
  font-weight: 500;
  transition: transform var(--hp-dur-fast) var(--hp-ease-spring), opacity var(--hp-dur-fast);
}
.hp-btn:hover { opacity: .92; }
.hp-btn:active { transform: scale(.985); }
.hp-btn[disabled] { opacity: .55; cursor: default; transform: none; }
.hp-btn svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

.hp-resume {
  margin-top: 10px;
  padding: 14px 16px;
  border-radius: var(--hp-radius-md);
  background: var(--hp-surface);
  text-align: start;
  width: 100%;
}
.hp-resume-label { font-size: var(--hp-text-xs); color: var(--hp-text-3); }
.hp-resume-preview {
  margin-top: 2px; font-size: var(--hp-text-sm); color: var(--hp-text-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* ------------------------------------------------------------------ form */

.hp-form { padding: var(--hp-pad); display: flex; flex-direction: column; gap: 14px; }
.hp-form-title {
  font-size: var(--hp-text-lg); font-weight: 600;
  letter-spacing: var(--hp-tracking-tight);
}
.hp-field { display: flex; flex-direction: column; gap: 6px; }
.hp-label-text { font-size: var(--hp-text-sm); font-weight: 500; color: var(--hp-text-2); }
.hp-req { color: var(--hp-danger); }

.hp-input, .hp-textarea, .hp-select {
  width: 100%;
  min-height: 46px;
  padding: 12px 14px;
  border-radius: var(--hp-radius-sm);
  background: var(--hp-surface);
  border: 1px solid var(--hp-border);
  /* 16px minimum stops iOS zooming the page on focus. */
  font-size: 16px;
  color: var(--hp-text);
  transition: border-color var(--hp-dur-fast), background var(--hp-dur-fast);
}
.hp-textarea { min-height: 84px; resize: vertical; }
.hp-select { cursor: pointer; }
.hp-input::placeholder, .hp-textarea::placeholder { color: var(--hp-text-3); }
.hp-input:focus, .hp-textarea:focus, .hp-select:focus { border-color: var(--hp-accent); background: var(--hp-bg); }
.hp-input[aria-invalid="true"], .hp-textarea[aria-invalid="true"] { border-color: var(--hp-danger); }
.hp-error-text { font-size: var(--hp-text-xs); color: var(--hp-danger); }
.hp-privacy { font-size: var(--hp-text-xs); color: var(--hp-text-3); }

/* ---------------------------------------------------------------- thread */

.hp-thread { padding: var(--hp-pad); display: flex; flex-direction: column; gap: 14px; }
.hp-row { display: flex; flex-direction: column; animation: hp-msg-in var(--hp-dur) var(--hp-ease-out) both; }
.hp-row[data-grouped] { margin-top: -8px; }
@keyframes hp-msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

/* Agent messages have no bubble — plain text, editorial and calm. */
.hp-agent { max-width: 88%; color: var(--hp-text); font-size: var(--hp-text-md); }
.hp-rate { display: flex; gap: 2px; margin-top: 4px; }
.hp-rate-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: var(--hp-radius-sm); background: transparent; color: var(--hp-text-3); cursor: pointer;
  opacity: .7; transition: opacity var(--hp-dur-fast) var(--hp-ease-out), background var(--hp-dur-fast) var(--hp-ease-out);
}
.hp-rate-btn svg { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.hp-rate-btn:hover, .hp-rate-btn:focus-visible { opacity: 1; background: var(--hp-surface-2); color: var(--hp-text); }
.hp-rate-btn:focus-visible { outline: 2px solid var(--hp-accent); outline-offset: 1px; }
.hp-rate-btn[aria-pressed="true"] { opacity: 1; color: var(--hp-accent); }
.hp-rate-btn[aria-pressed="true"] svg { fill: currentColor; fill-opacity: .15; }
.hp-agent p + p { margin-top: 10px; }
.hp-agent ul { margin: 8px 0 0; padding-inline-start: 20px; }
.hp-agent li { margin-top: 4px; }
.hp-agent code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .9em;
  background: var(--hp-surface-2);
  padding: 1px 5px;
  border-radius: 5px;
}
.hp-agent a { color: var(--hp-accent); }

.hp-user {
  align-self: flex-end;
  max-width: 80%;
  padding: 10px 14px;
  border-radius: var(--hp-radius-lg);
  background: var(--hp-accent);
  color: var(--hp-accent-fg);
  font-size: var(--hp-text-md);
  overflow-wrap: anywhere;
}
.hp-row[data-pending] .hp-user { opacity: .62; }

.hp-notice {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 12px 14px;
  border-radius: var(--hp-radius-sm);
  background: var(--hp-surface);
  color: var(--hp-text-2);
  font-size: var(--hp-text-sm);
}
.hp-notice[data-tone="warn"] {
  background: color-mix(in srgb, var(--hp-danger) 8%, var(--hp-bg));
  color: var(--hp-text);
}
.hp-notice svg { width: 16px; height: 16px; min-width: 16px; margin-top: 2px; stroke: currentColor; stroke-width: 1.6; }

.hp-time { font-size: var(--hp-text-xs); color: var(--hp-text-3); margin-top: 4px; }
.hp-row .hp-time { opacity: 0; transition: opacity var(--hp-dur-fast); }
.hp-row:hover .hp-time, .hp-row:focus-within .hp-time { opacity: 1; }
.hp-row[data-user] .hp-time { align-self: flex-end; }

.hp-typing { display: flex; gap: 4px; padding: 4px 0; }
.hp-typing i {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--hp-text-3);
  animation: hp-blink 1.2s ease-in-out infinite;
}
.hp-typing i:nth-child(2) { animation-delay: .18s; }
.hp-typing i:nth-child(3) { animation-delay: .36s; }
@keyframes hp-blink { 0%,60%,100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

/* ------------------------------------------------------- rich messages */

.hp-options { display: flex; flex-direction: column; gap: 10px; }
.hp-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.hp-chips .hp-chip { animation: hp-chip-in var(--hp-dur) var(--hp-ease-spring) both; }
@keyframes hp-chip-in {
  from { opacity: 0; transform: translateY(4px) scale(.96); }
  to   { opacity: 1; transform: none; }
}
.hp-chip[aria-pressed="true"] { background: var(--hp-accent); color: var(--hp-accent-fg); border-color: var(--hp-accent); }
a.hp-chip { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.hp-chip[disabled] { opacity: .45; cursor: default; }
.hp-chip[disabled]:hover { background: var(--hp-bg); border-color: var(--hp-border); }
.hp-chip svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.hp-confirm { margin-top: 2px; }

.hp-card {
  background: var(--hp-surface);
  border-radius: var(--hp-radius-md);
  overflow: hidden;
  max-width: 88%;
}
.hp-card-img { width: 100%; height: auto; object-fit: cover; display: block; background: var(--hp-surface-2); }
.hp-card-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.hp-card-title { font-size: var(--hp-text-md); font-weight: 600; letter-spacing: var(--hp-tracking-tight); }
.hp-card-text { font-size: var(--hp-text-sm); color: var(--hp-text-2); }
.hp-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.hp-actions .hp-chip { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }

.hp-carousel-wrap { position: relative; }

.hp-carousel {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  /* Bleed to the panel edges so the next card peeks in. */
  margin-inline: calc(var(--hp-pad) * -1);
  padding-inline: var(--hp-pad);
  /* Align the snap port with the padding, so the first card rests at
     scrollLeft 0 rather than at the padding offset — otherwise the carousel
     reports itself as already scrolled and the prev arrow starts enabled. */
  scroll-padding-inline: var(--hp-pad);
  padding-bottom: 4px;
}
.hp-carousel::-webkit-scrollbar { display: none; }
.hp-carousel-item { flex: 0 0 78%; scroll-snap-align: start; }
.hp-carousel-item .hp-card { max-width: none; height: 100%; }

/*
 * The scrollbar is hidden, so these are the only affordance a mouse user
 * gets. Touch devices swipe instead and never see them.
 */
.hp-carousel-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  /* Accessibility: every target is at least 44x44, overlay controls included. */
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--hp-bg);
  color: var(--hp-text);
  box-shadow: 0 2px 10px -2px rgba(15, 15, 30, .28), 0 0 0 1px var(--hp-border);
  opacity: 0;
  transition: opacity var(--hp-dur-fast) var(--hp-ease-out), background var(--hp-dur-fast);
  z-index: 1;
}
.hp-carousel-nav[data-dir="prev"] { inset-inline-start: 2px; }
.hp-carousel-nav[data-dir="next"] { inset-inline-end: 2px; }
.hp-carousel-nav[data-dir="prev"] svg { transform: rotate(0deg); }
.hp-carousel-nav:hover { background: var(--hp-surface); }
.hp-carousel-nav svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.hp-carousel-nav[disabled] { opacity: 0 !important; pointer-events: none; }

/* Revealed on hover, and whenever one is focused by keyboard. */
.hp-carousel-wrap:hover .hp-carousel-nav,
.hp-carousel-nav:focus-visible { opacity: 1; }

@media (hover: none) {
  .hp-carousel-nav { display: none; }
}

.hp-links { display: flex; flex-direction: column; gap: 2px; max-width: 88%; }
.hp-links-title { font-size: var(--hp-text-xs); color: var(--hp-text-3); margin-bottom: 4px; }
.hp-link-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  min-height: 44px;
  border-radius: var(--hp-radius-sm);
  background: var(--hp-surface);
  text-decoration: none;
  transition: background var(--hp-dur-fast);
}
.hp-link-row:hover { background: var(--hp-surface-2); }
.hp-link-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.hp-link-label { font-size: var(--hp-text-sm); font-weight: 500; }
.hp-link-desc { font-size: var(--hp-text-xs); color: var(--hp-text-2); }
.hp-link-row svg { stroke: var(--hp-text-3); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }

.hp-inline-form {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px;
  border-radius: var(--hp-radius-md);
  background: var(--hp-surface);
  max-width: 88%;
}

/* --------------------------------------------------------- shortcut bar */

.hp-shortcut-wrap { position: relative; }

.hp-shortcut-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  scroll-behavior: smooth;
  padding: 0 12px 10px;
}
.hp-shortcut-bar::-webkit-scrollbar { display: none; }
.hp-shortcut-bar .hp-chip { white-space: nowrap; flex: none; }

/*
 * The row scrolls with its scrollbar hidden, so a fade marks the chips that
 * are out of view — otherwise a clipped chip looks like a rendering fault
 * rather than something you can reach.
 */
.hp-shortcut-wrap::before,
.hp-shortcut-wrap::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 10px;
  width: 36px;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--hp-dur-fast) var(--hp-ease-out);
  z-index: 1;
}
.hp-shortcut-wrap::before {
  inset-inline-start: 0;
  background: linear-gradient(to right, var(--hp-bg), transparent);
}
.hp-shortcut-wrap::after {
  inset-inline-end: 0;
  background: linear-gradient(to left, var(--hp-bg), transparent);
}
.hp-shortcut-wrap[data-more-start]::before { opacity: 1; }
.hp-shortcut-wrap[data-more-end]::after { opacity: 1; }

.hp-shortcut-nav {
  position: absolute;
  inset-inline-end: 4px;
  top: calc(50% - 5px);
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--hp-bg);
  color: var(--hp-text-2);
  box-shadow: 0 2px 8px -2px rgba(15, 15, 30, .3), 0 0 0 1px var(--hp-border);
  z-index: 2;
}
.hp-shortcut-nav:hover { color: var(--hp-text); }
.hp-shortcut-nav svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
@media (hover: none) { .hp-shortcut-nav { display: none; } }

.hp-flow-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin: 0 var(--hp-pad) 10px;
  padding: 8px 8px 8px 14px;
  border-radius: var(--hp-radius-md);
  background: var(--hp-accent-soft);
  font-size: var(--hp-text-xs);
  color: var(--hp-text-2);
}

/* ------------------------------------------------------- home shortcuts */

.hp-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.hp-tile {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  padding: 14px;
  min-height: 92px;
  border-radius: var(--hp-radius-md);
  background: var(--hp-surface);
  text-align: start;
  text-decoration: none;
  transition: background var(--hp-dur-fast), transform var(--hp-dur-fast) var(--hp-ease-spring);
}
.hp-tile:hover { background: var(--hp-surface-2); }
.hp-tile:active { transform: scale(.985); }
.hp-tile-icon {
  width: 30px; height: 30px;
  border-radius: 9px;
  display: grid; place-items: center;
  background: var(--hp-accent-soft);
  color: var(--hp-accent);
}
.hp-tile-icon svg { width: 17px; height: 17px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.hp-tile-label { font-size: var(--hp-text-sm); font-weight: 500; }
.hp-tile-desc { font-size: var(--hp-text-xs); color: var(--hp-text-2); }

.hp-home-links { margin-top: 16px; }

/* -------------------------------------------------------------- composer */

.hp-composer-wrap { flex: none; padding: 12px; border-top: 1px solid var(--hp-border); background: var(--hp-bg); }
.hp-composer {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 6px 6px 6px 14px;
  border-radius: var(--hp-radius-lg);
  background: var(--hp-surface);
  border: 1px solid var(--hp-border);
  transition: border-color var(--hp-dur-fast);
}
.hp-composer:focus-within { border-color: var(--hp-accent); }
.hp-composer textarea {
  flex: 1;
  min-height: 44px;
  max-height: 120px;
  padding: 12px 0;
  font-size: 16px;
  line-height: 1.4;
  resize: none;
  /* The box grows to fit its content, so a scrollbar is only ever correct
     once it has hit max-height. Left on auto, a one-pixel difference in font
     metrics is enough to show a stepper scrollbar on some platforms. */
  overflow-y: hidden;
  scrollbar-width: thin;
  background: none;
}
.hp-composer textarea[data-scrolls] { overflow-y: auto; }
.hp-composer textarea::placeholder { color: var(--hp-text-3); }

.hp-send {
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 50%;
  display: grid; place-items: center;
  background: var(--hp-accent);
  color: var(--hp-accent-fg);
  animation: hp-pop var(--hp-dur) var(--hp-ease-spring) both;
}
.hp-send[disabled] { opacity: .4; cursor: default; }
.hp-send svg { width: 17px; height: 17px; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
@keyframes hp-pop { from { transform: scale(0); } to { transform: scale(1); } }

.hp-counter { font-size: var(--hp-text-xs); color: var(--hp-text-3); text-align: end; padding: 4px 8px 0; }
.hp-offline { font-size: var(--hp-text-xs); color: var(--hp-text-3); padding: 6px 8px 0; text-align: center; }

/* ---------------------------------------------------------------- errors */

.hp-inline-error {
  margin: 0 var(--hp-pad) 12px;
  padding: 12px 14px;
  border-radius: var(--hp-radius-sm);
  background: color-mix(in srgb, var(--hp-danger) 8%, var(--hp-bg));
  border: 1px solid color-mix(in srgb, var(--hp-danger) 24%, transparent);
  font-size: var(--hp-text-sm);
  display: flex; flex-direction: column; gap: 10px;
}
.hp-error-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.hp-chip {
  padding: 10px 16px;
  min-height: 44px;
  border-radius: var(--hp-radius-md);
  border: 1px solid var(--hp-border);
  background: var(--hp-bg);
  font-size: var(--hp-text-sm);
  font-weight: 500;
  transition: background var(--hp-dur-fast), border-color var(--hp-dur-fast);
}
.hp-chip:hover { background: var(--hp-accent-soft); border-color: var(--hp-accent); }

/* --------------------------------------------------------------- footer */

.hp-powered { flex: none; text-align: center; padding: 0 0 10px; font-size: 11px; color: var(--hp-text-3); }
.hp-powered a { display: inline-block; padding: 6px 10px; }
.hp-powered a { color: inherit; text-decoration: none; }
.hp-powered a:hover { text-decoration: underline; }

/* ---------------------------------------------------------------- teaser */

.hp-teaser {
  position: fixed;
  bottom: calc(var(--hp-launcher-y, 24px) + 72px);
  inset-inline-end: var(--hp-launcher-x, 24px);
  max-width: 260px;
  display: flex; align-items: flex-start; gap: 8px;
  padding: 12px 14px;
  border-radius: var(--hp-radius-md);
  background: var(--hp-bg);
  border: 1px solid var(--hp-border);
  box-shadow: 0 12px 32px -12px rgba(15,15,30,.28);
  font-size: var(--hp-text-sm);
  text-align: start;
  animation: hp-teaser-in var(--hp-dur-slow) var(--hp-ease-out) both;
}
@keyframes hp-teaser-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
.hp-teaser-close { width: 20px; height: 20px; min-width: 20px; color: var(--hp-text-3); display: grid; place-items: center; }
.hp-teaser-close svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.8; }

/* ---------------------------------------------------------------- mobile */

@media (max-width: 640px) {
  /* The full-screen panel replaces the launcher rather than covering it. */
  .hp-panel ~ .hp-launcher, .hp-launcher:has(~ .hp-panel) { display: none; }

  .hp-panel {
    inset: 0;
    width: 100vw;
    max-width: none;
    /* dvh follows the iOS toolbar, so the composer stays reachable. */
    height: 100dvh;
    border-radius: 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .hp-panel[data-keyboard] { height: var(--hp-viewport-h, 100dvh); }
}

/* ------------------------------------------------------------------ fill */

/* data-fill: the chat is the whole page (the dashboard's test chat, a full-page link). */
:host([data-fill]) .hp-panel {
  inset: 0;
  width: 100%;
  max-width: none;
  height: 100%;
  border-radius: 0;
  box-shadow: none;
  animation: none;
}
:host([data-fill]) .hp-panel ~ .hp-launcher, :host([data-fill]) .hp-launcher:has(~ .hp-panel) { display: none; }
:host([data-fill]) .hp-close, :host([data-fill]) .hp-teaser { display: none; }

/* -------------------------------------------------------- reduced motion */

@media (prefers-reduced-motion: reduce) {
  .hp-panel, .hp-screen, .hp-row, .hp-teaser, .hp-send {
    animation-duration: 120ms;
    animation-name: hp-fade;
  }
  .hp-header-orb, .hp-orb { animation: none; }
  .hp-typing i { animation: hp-blink 1.2s steps(2) infinite; }
  * { transition-duration: 1ms !important; }
  @keyframes hp-fade { from { opacity: 0; } to { opacity: 1; } }
}

/* Screen-reader-only text. */
.hp-sr {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`;
