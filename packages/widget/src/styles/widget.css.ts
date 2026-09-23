/**
 * Every widget style, as one string (§3). Applied to the shadow root with a
 * constructable stylesheet, so nothing is ever added to 'document.head' and
 * no 'style-src 'unsafe-inline'' is needed (§8.2).
 *
 * Logical properties throughout ('inset-inline', 'margin-inline', 'padding-
 * block') so RTL works without a second stylesheet (§8.7).
 */
export const WIDGET_CSS = `
/* ---------------------------------------------------------------- panel */

/*
 * Turnstile's container. It collapses to nothing until a challenge is actually
 * rendered, so the common case - 'interaction-only', where the visitor is
 * never asked anything - costs no layout at all.
 */
.mm-captcha { display: none; }
.mm-captcha[data-active='yes'] { display: block; padding: 8px 16px 0; min-height: 0; }
.mm-captcha[data-active='yes']:empty { display: none; }

.mm-panel {
  position: fixed;
  bottom: calc(var(--mm-launcher-y, 24px) + 72px);
  inset-inline-end: var(--mm-launcher-x, 24px);
  width: var(--mm-panel-w);
  max-width: calc(100vw - 32px);
  height: var(--mm-panel-h);
  display: flex;
  flex-direction: column;
  background: var(--mm-bg);
  border-radius: var(--mm-radius-panel);
  box-shadow: var(--mm-shadow-panel);
  overflow: hidden;
  transform-origin: bottom right;
  animation: mm-panel-in var(--mm-dur-slow) var(--mm-ease-out) both;
  /* Above the launcher: at mobile widths the panel is full screen and would
     otherwise sit underneath the orb, which then swallows taps meant for the
     composer. */
  z-index: 2;
}
.mm-panel[data-position="bottom-left"] {
  inset-inline-end: auto;
  inset-inline-start: var(--mm-launcher-x, 24px);
  transform-origin: bottom left;
}
.mm-panel[data-closing] { animation: mm-panel-out var(--mm-dur) var(--mm-ease-out) both; }

@keyframes mm-panel-in {
  from { opacity: 0; transform: scale(.92) translateY(12px); }
  to   { opacity: 1; transform: none; }
}
@keyframes mm-panel-out {
  from { opacity: 1; transform: none; }
  to   { opacity: 0; transform: scale(.96) translateY(8px); }
}

/* --------------------------------------------------------------- header */

.mm-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px var(--mm-pad);
  border-bottom: 1px solid var(--mm-border);
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  position: relative;
  z-index: 2;
  flex: none;
}
@supports (backdrop-filter: blur(16px)) {
  .mm-header { backdrop-filter: blur(16px); }
}

.mm-header-orb {
  width: 34px; height: 34px; min-width: 34px;
  border-radius: 50%;
  background:
    radial-gradient(120% 120% at 30% 25%, rgba(255,255,255,.34), transparent 55%),
    conic-gradient(from var(--mm-orb-angle, 0deg),
      var(--mm-accent), var(--mm-accent-2), var(--mm-accent-3), var(--mm-accent));
  animation: mm-drift 12s linear infinite;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.mm-header-orb img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.mm-header-orb[data-thinking] { animation: mm-drift 12s linear infinite, mm-pulse 1.4s ease-in-out infinite; }
@keyframes mm-pulse { 50% { transform: scale(1.08); opacity: .82; } }

.mm-header-text { flex: 1; min-width: 0; }
.mm-header-name {
  font-size: var(--mm-text-md); font-weight: 600;
  letter-spacing: var(--mm-tracking-tight);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mm-header-status { font-size: var(--mm-text-xs); color: var(--mm-text-3); }

.mm-icon-btn {
  /* §8.7: every target is at least 44x44. */
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 10px;
  display: grid; place-items: center;
  color: var(--mm-text-2);
  transition: background var(--mm-dur-fast) var(--mm-ease-out), color var(--mm-dur-fast);
}
.mm-icon-btn:hover { background: var(--mm-surface-2); color: var(--mm-text); }
.mm-icon-btn svg { width: 20px; height: 20px; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

/* --------------------------------------------------------------- screens */

.mm-screen {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  animation: mm-screen-in var(--mm-dur) var(--mm-ease-out) both;
}
@keyframes mm-screen-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: none; }
}

.mm-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  /* A platform scrollbar with stepper arrows is louder than anything else in
     the panel, so the thread draws a quiet one of its own (§9.1). */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--mm-text) 22%, transparent) transparent;
}
.mm-scroll::-webkit-scrollbar { width: 10px; }
.mm-scroll::-webkit-scrollbar-track { background: transparent; }
.mm-scroll::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.mm-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--mm-text) 20%, transparent);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.mm-scroll::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--mm-text) 34%, transparent);
  background-clip: content-box;
}

/* ------------------------------------------------------------------ home */

.mm-home-wash {
  padding: 28px var(--mm-pad) 24px;
  background: linear-gradient(180deg, var(--mm-accent-soft), transparent);
}
.mm-home-title {
  font-size: var(--mm-text-xl);
  font-weight: 600;
  letter-spacing: var(--mm-tracking-tight);
  line-height: 1.2;
}
.mm-home-sub { margin-top: 6px; color: var(--mm-text-2); font-size: var(--mm-text-md); }
.mm-home-body { padding: 0 var(--mm-pad) var(--mm-pad); }

.mm-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 12px 18px;
  border-radius: var(--mm-radius-md);
  background: var(--mm-accent);
  color: var(--mm-accent-fg);
  font-size: var(--mm-text-md);
  font-weight: 500;
  transition: transform var(--mm-dur-fast) var(--mm-ease-spring), opacity var(--mm-dur-fast);
}
.mm-btn:hover { opacity: .92; }
.mm-btn:active { transform: scale(.985); }
.mm-btn[disabled] { opacity: .55; cursor: default; transform: none; }
.mm-btn svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

.mm-resume {
  margin-top: 10px;
  padding: 14px 16px;
  border-radius: var(--mm-radius-md);
  background: var(--mm-surface);
  text-align: start;
  width: 100%;
}
.mm-resume-label { font-size: var(--mm-text-xs); color: var(--mm-text-3); }
.mm-resume-preview {
  margin-top: 2px; font-size: var(--mm-text-sm); color: var(--mm-text-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* ------------------------------------------------------------------ form */

.mm-form { padding: var(--mm-pad); display: flex; flex-direction: column; gap: 14px; }
.mm-form-title {
  font-size: var(--mm-text-lg); font-weight: 600;
  letter-spacing: var(--mm-tracking-tight);
}
.mm-field { display: flex; flex-direction: column; gap: 6px; }
.mm-label-text { font-size: var(--mm-text-sm); font-weight: 500; color: var(--mm-text-2); }
.mm-req { color: var(--mm-danger); }

.mm-input, .mm-textarea, .mm-select {
  width: 100%;
  min-height: 46px;
  padding: 12px 14px;
  border-radius: var(--mm-radius-sm);
  background: var(--mm-surface);
  border: 1px solid var(--mm-border);
  /* 16px minimum stops iOS zooming the page on focus (§8.8). */
  font-size: 16px;
  color: var(--mm-text);
  transition: border-color var(--mm-dur-fast), background var(--mm-dur-fast);
}
.mm-textarea { min-height: 84px; resize: vertical; }
.mm-select { cursor: pointer; }
.mm-input::placeholder, .mm-textarea::placeholder { color: var(--mm-text-3); }
.mm-input:focus, .mm-textarea:focus, .mm-select:focus { border-color: var(--mm-accent); background: var(--mm-bg); }
.mm-input[aria-invalid="true"], .mm-textarea[aria-invalid="true"] { border-color: var(--mm-danger); }
.mm-error-text { font-size: var(--mm-text-xs); color: var(--mm-danger); }
.mm-privacy { font-size: var(--mm-text-xs); color: var(--mm-text-3); }

/* ---------------------------------------------------------------- thread */

.mm-thread { padding: var(--mm-pad); display: flex; flex-direction: column; gap: 14px; }
.mm-row { display: flex; flex-direction: column; animation: mm-msg-in var(--mm-dur) var(--mm-ease-out) both; }
.mm-row[data-grouped] { margin-top: -8px; }
@keyframes mm-msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

/* Agent messages have no bubble — plain text, editorial and calm (§9.4). */
.mm-agent { max-width: 88%; color: var(--mm-text); font-size: var(--mm-text-md); }
.mm-agent p + p { margin-top: 10px; }
.mm-agent ul { margin: 8px 0 0; padding-inline-start: 20px; }
.mm-agent li { margin-top: 4px; }
.mm-agent code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .9em;
  background: var(--mm-surface-2);
  padding: 1px 5px;
  border-radius: 5px;
}
.mm-agent a { color: var(--mm-accent); }

.mm-user {
  align-self: flex-end;
  max-width: 80%;
  padding: 10px 14px;
  border-radius: var(--mm-radius-lg);
  background: var(--mm-accent);
  color: var(--mm-accent-fg);
  font-size: var(--mm-text-md);
  overflow-wrap: anywhere;
}
.mm-row[data-pending] .mm-user { opacity: .62; }

.mm-notice {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 12px 14px;
  border-radius: var(--mm-radius-sm);
  background: var(--mm-surface);
  color: var(--mm-text-2);
  font-size: var(--mm-text-sm);
}
.mm-notice[data-tone="warn"] {
  background: color-mix(in srgb, var(--mm-danger) 8%, var(--mm-bg));
  color: var(--mm-text);
}
.mm-notice svg { width: 16px; height: 16px; min-width: 16px; margin-top: 2px; stroke: currentColor; stroke-width: 1.6; }

.mm-time { font-size: var(--mm-text-xs); color: var(--mm-text-3); margin-top: 4px; }
.mm-row .mm-time { opacity: 0; transition: opacity var(--mm-dur-fast); }
.mm-row:hover .mm-time, .mm-row:focus-within .mm-time { opacity: 1; }
.mm-row[data-user] .mm-time { align-self: flex-end; }

.mm-typing { display: flex; gap: 4px; padding: 4px 0; }
.mm-typing i {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--mm-text-3);
  animation: mm-blink 1.2s ease-in-out infinite;
}
.mm-typing i:nth-child(2) { animation-delay: .18s; }
.mm-typing i:nth-child(3) { animation-delay: .36s; }
@keyframes mm-blink { 0%,60%,100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

/* ------------------------------------------------------- rich messages */

.mm-options { display: flex; flex-direction: column; gap: 10px; }
.mm-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.mm-chips .mm-chip { animation: mm-chip-in var(--mm-dur) var(--mm-ease-spring) both; }
@keyframes mm-chip-in {
  from { opacity: 0; transform: translateY(4px) scale(.96); }
  to   { opacity: 1; transform: none; }
}
.mm-chip[aria-pressed="true"] { background: var(--mm-accent); color: var(--mm-accent-fg); border-color: var(--mm-accent); }
a.mm-chip { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.mm-chip[disabled] { opacity: .45; cursor: default; }
.mm-chip[disabled]:hover { background: var(--mm-bg); border-color: var(--mm-border); }
.mm-chip svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.mm-confirm { margin-top: 2px; }

.mm-card {
  background: var(--mm-surface);
  border-radius: var(--mm-radius-md);
  overflow: hidden;
  max-width: 88%;
}
.mm-card-img { width: 100%; height: auto; object-fit: cover; display: block; background: var(--mm-surface-2); }
.mm-card-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.mm-card-title { font-size: var(--mm-text-md); font-weight: 600; letter-spacing: var(--mm-tracking-tight); }
.mm-card-text { font-size: var(--mm-text-sm); color: var(--mm-text-2); }
.mm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.mm-actions .mm-chip { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }

.mm-carousel-wrap { position: relative; }

.mm-carousel {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  /* Bleed to the panel edges so the next card peeks in. */
  margin-inline: calc(var(--mm-pad) * -1);
  padding-inline: var(--mm-pad);
  /* Align the snap port with the padding, so the first card rests at
     scrollLeft 0 rather than at the padding offset — otherwise the carousel
     reports itself as already scrolled and the prev arrow starts enabled. */
  scroll-padding-inline: var(--mm-pad);
  padding-bottom: 4px;
}
.mm-carousel::-webkit-scrollbar { display: none; }
.mm-carousel-item { flex: 0 0 78%; scroll-snap-align: start; }
.mm-carousel-item .mm-card { max-width: none; height: 100%; }

/*
 * The scrollbar is hidden, so these are the only affordance a mouse user
 * gets. Touch devices swipe instead and never see them (§8.7).
 */
.mm-carousel-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  /* §8.7: every target is at least 44x44, overlay controls included. */
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--mm-bg);
  color: var(--mm-text);
  box-shadow: 0 2px 10px -2px rgba(15, 15, 30, .28), 0 0 0 1px var(--mm-border);
  opacity: 0;
  transition: opacity var(--mm-dur-fast) var(--mm-ease-out), background var(--mm-dur-fast);
  z-index: 1;
}
.mm-carousel-nav[data-dir="prev"] { inset-inline-start: 2px; }
.mm-carousel-nav[data-dir="next"] { inset-inline-end: 2px; }
.mm-carousel-nav[data-dir="prev"] svg { transform: rotate(0deg); }
.mm-carousel-nav:hover { background: var(--mm-surface); }
.mm-carousel-nav svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.mm-carousel-nav[disabled] { opacity: 0 !important; pointer-events: none; }

/* Revealed on hover, and whenever one is focused by keyboard. */
.mm-carousel-wrap:hover .mm-carousel-nav,
.mm-carousel-nav:focus-visible { opacity: 1; }

@media (hover: none) {
  .mm-carousel-nav { display: none; }
}

.mm-links { display: flex; flex-direction: column; gap: 2px; max-width: 88%; }
.mm-links-title { font-size: var(--mm-text-xs); color: var(--mm-text-3); margin-bottom: 4px; }
.mm-link-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  min-height: 44px;
  border-radius: var(--mm-radius-sm);
  background: var(--mm-surface);
  text-decoration: none;
  transition: background var(--mm-dur-fast);
}
.mm-link-row:hover { background: var(--mm-surface-2); }
.mm-link-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.mm-link-label { font-size: var(--mm-text-sm); font-weight: 500; }
.mm-link-desc { font-size: var(--mm-text-xs); color: var(--mm-text-2); }
.mm-link-row svg { stroke: var(--mm-text-3); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }

.mm-inline-form {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px;
  border-radius: var(--mm-radius-md);
  background: var(--mm-surface);
  max-width: 88%;
}

/* --------------------------------------------------------- shortcut bar */

.mm-shortcut-wrap { position: relative; }

.mm-shortcut-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  scroll-behavior: smooth;
  padding: 0 12px 10px;
}
.mm-shortcut-bar::-webkit-scrollbar { display: none; }
.mm-shortcut-bar .mm-chip { white-space: nowrap; flex: none; }

/*
 * The row scrolls with its scrollbar hidden, so a fade marks the chips that
 * are out of view — otherwise a clipped chip looks like a rendering fault
 * rather than something you can reach.
 */
.mm-shortcut-wrap::before,
.mm-shortcut-wrap::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 10px;
  width: 36px;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--mm-dur-fast) var(--mm-ease-out);
  z-index: 1;
}
.mm-shortcut-wrap::before {
  inset-inline-start: 0;
  background: linear-gradient(to right, var(--mm-bg), transparent);
}
.mm-shortcut-wrap::after {
  inset-inline-end: 0;
  background: linear-gradient(to left, var(--mm-bg), transparent);
}
.mm-shortcut-wrap[data-more-start]::before { opacity: 1; }
.mm-shortcut-wrap[data-more-end]::after { opacity: 1; }

.mm-shortcut-nav {
  position: absolute;
  inset-inline-end: 4px;
  top: calc(50% - 5px);
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--mm-bg);
  color: var(--mm-text-2);
  box-shadow: 0 2px 8px -2px rgba(15, 15, 30, .3), 0 0 0 1px var(--mm-border);
  z-index: 2;
}
.mm-shortcut-nav:hover { color: var(--mm-text); }
.mm-shortcut-nav svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
@media (hover: none) { .mm-shortcut-nav { display: none; } }

.mm-flow-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin: 0 var(--mm-pad) 10px;
  padding: 8px 8px 8px 14px;
  border-radius: var(--mm-radius-md);
  background: var(--mm-accent-soft);
  font-size: var(--mm-text-xs);
  color: var(--mm-text-2);
}

/* ------------------------------------------------------- home shortcuts */

.mm-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.mm-tile {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  padding: 14px;
  min-height: 92px;
  border-radius: var(--mm-radius-md);
  background: var(--mm-surface);
  text-align: start;
  text-decoration: none;
  transition: background var(--mm-dur-fast), transform var(--mm-dur-fast) var(--mm-ease-spring);
}
.mm-tile:hover { background: var(--mm-surface-2); }
.mm-tile:active { transform: scale(.985); }
.mm-tile-icon {
  width: 30px; height: 30px;
  border-radius: 9px;
  display: grid; place-items: center;
  background: var(--mm-accent-soft);
  color: var(--mm-accent);
}
.mm-tile-icon svg { width: 17px; height: 17px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.mm-tile-label { font-size: var(--mm-text-sm); font-weight: 500; }
.mm-tile-desc { font-size: var(--mm-text-xs); color: var(--mm-text-2); }

.mm-home-links { margin-top: 16px; }

/* -------------------------------------------------------------- composer */

.mm-composer-wrap { flex: none; padding: 12px; border-top: 1px solid var(--mm-border); background: var(--mm-bg); }
.mm-composer {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 6px 6px 6px 14px;
  border-radius: var(--mm-radius-lg);
  background: var(--mm-surface);
  border: 1px solid var(--mm-border);
  transition: border-color var(--mm-dur-fast);
}
.mm-composer:focus-within { border-color: var(--mm-accent); }
.mm-composer textarea {
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
.mm-composer textarea[data-scrolls] { overflow-y: auto; }
.mm-composer textarea::placeholder { color: var(--mm-text-3); }

.mm-send {
  width: 44px; height: 44px; min-width: 44px;
  border-radius: 50%;
  display: grid; place-items: center;
  background: var(--mm-accent);
  color: var(--mm-accent-fg);
  animation: mm-pop var(--mm-dur) var(--mm-ease-spring) both;
}
.mm-send[disabled] { opacity: .4; cursor: default; }
.mm-send svg { width: 17px; height: 17px; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
@keyframes mm-pop { from { transform: scale(0); } to { transform: scale(1); } }

.mm-counter { font-size: var(--mm-text-xs); color: var(--mm-text-3); text-align: end; padding: 4px 8px 0; }
.mm-offline { font-size: var(--mm-text-xs); color: var(--mm-text-3); padding: 6px 8px 0; text-align: center; }

/* ---------------------------------------------------------------- errors */

.mm-inline-error {
  margin: 0 var(--mm-pad) 12px;
  padding: 12px 14px;
  border-radius: var(--mm-radius-sm);
  background: color-mix(in srgb, var(--mm-danger) 8%, var(--mm-bg));
  border: 1px solid color-mix(in srgb, var(--mm-danger) 24%, transparent);
  font-size: var(--mm-text-sm);
  display: flex; flex-direction: column; gap: 10px;
}
.mm-error-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mm-chip {
  padding: 10px 16px;
  min-height: 44px;
  border-radius: var(--mm-radius-md);
  border: 1px solid var(--mm-border);
  background: var(--mm-bg);
  font-size: var(--mm-text-sm);
  font-weight: 500;
  transition: background var(--mm-dur-fast), border-color var(--mm-dur-fast);
}
.mm-chip:hover { background: var(--mm-accent-soft); border-color: var(--mm-accent); }

/* --------------------------------------------------------------- footer */

.mm-powered { flex: none; text-align: center; padding: 0 0 10px; font-size: 11px; color: var(--mm-text-3); }
.mm-powered a { display: inline-block; padding: 6px 10px; }
.mm-powered a { color: inherit; text-decoration: none; }
.mm-powered a:hover { text-decoration: underline; }

/* ---------------------------------------------------------------- teaser */

.mm-teaser {
  position: fixed;
  bottom: calc(var(--mm-launcher-y, 24px) + 72px);
  inset-inline-end: var(--mm-launcher-x, 24px);
  max-width: 260px;
  display: flex; align-items: flex-start; gap: 8px;
  padding: 12px 14px;
  border-radius: var(--mm-radius-md);
  background: var(--mm-bg);
  border: 1px solid var(--mm-border);
  box-shadow: 0 12px 32px -12px rgba(15,15,30,.28);
  font-size: var(--mm-text-sm);
  text-align: start;
  animation: mm-teaser-in var(--mm-dur-slow) var(--mm-ease-out) both;
}
@keyframes mm-teaser-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
.mm-teaser-close { width: 20px; height: 20px; min-width: 20px; color: var(--mm-text-3); display: grid; place-items: center; }
.mm-teaser-close svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.8; }

/* ---------------------------------------------------------------- mobile */

@media (max-width: 640px) {
  /* The full-screen panel replaces the launcher rather than covering it. */
  .mm-panel ~ .mm-launcher, .mm-launcher:has(~ .mm-panel) { display: none; }

  .mm-panel {
    inset: 0;
    width: 100vw;
    max-width: none;
    /* dvh follows the iOS toolbar, so the composer stays reachable (§8.8). */
    height: 100dvh;
    border-radius: 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .mm-panel[data-keyboard] { height: var(--mm-viewport-h, 100dvh); }
}

/* -------------------------------------------------------- reduced motion */

@media (prefers-reduced-motion: reduce) {
  .mm-panel, .mm-screen, .mm-row, .mm-teaser, .mm-send {
    animation-duration: 120ms;
    animation-name: mm-fade;
  }
  .mm-header-orb, .mm-orb { animation: none; }
  .mm-typing i { animation: mm-blink 1.2s steps(2) infinite; }
  * { transition-duration: 1ms !important; }
  @keyframes mm-fade { from { opacity: 0; } to { opacity: 1; } }
}

/* Screen-reader-only text. */
.mm-sr {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`;
