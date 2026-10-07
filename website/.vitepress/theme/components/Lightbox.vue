<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { closeLightbox, current } from '../lightbox';

/**
 * A native modal `<dialog>`: Escape closes it, focus stays inside while it is
 * open and returns to the screenshot afterwards. A click on the backdrop
 * closes it too.
 */

const dialog = ref<HTMLDialogElement | null>(null);

watch(current, async (shot) => {
  await nextTick();
  const el = dialog.value;
  if (!el) return;
  if (shot && !el.open) {
    el.showModal();
    document.documentElement.style.overflow = 'hidden';
  } else if (!shot && el.open) {
    el.close();
  }
});

function onClose() {
  document.documentElement.style.overflow = '';
  closeLightbox();
}

/** The dialog element itself is the backdrop: its content sits in `.lb-inner`. */
function onClick(event: MouseEvent) {
  if (event.target === dialog.value) dialog.value?.close();
}
</script>

<template>
  <dialog ref="dialog" class="hp-lightbox" :aria-label="current?.alt ?? 'Screenshot'" @close="onClose" @click="onClick">
    <div v-if="current" class="lb-inner">
      <img :src="current.src" :alt="current.alt" />
      <div class="lb-bar">
        <p>{{ current.caption ?? current.alt }}</p>
        <div class="lb-actions">
          <a v-if="current.demo" class="lb-demo" :href="current.demo.href" target="_blank" rel="noopener">
            {{ current.demo.label }}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
            <span class="sr-only">(opens in a new tab)</span>
          </a>
          <button type="button" class="lb-close" @click="dialog?.close()">Close</button>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.hp-lightbox {
  width: min(1400px, 96vw);
  max-width: none;
  max-height: 96vh;
  margin: auto;
  padding: 0;
  border: 0;
  border-radius: 18px;
  background: transparent;
  overflow: visible;
}
.hp-lightbox::backdrop { background: rgba(8, 8, 18, 0.78); backdrop-filter: blur(6px); }
.hp-lightbox[open] { animation: lb-in 180ms ease-out; }
@keyframes lb-in { from { opacity: 0; transform: scale(0.98); } }
.lb-inner { display: flex; flex-direction: column; gap: 14px; align-items: center; }
.lb-inner img {
  display: block;
  max-width: 100%;
  max-height: calc(96vh - 110px);
  width: auto;
  height: auto;
  border-radius: 14px;
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.6);
  background: var(--vp-c-bg);
}
.lb-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  width: 100%;
  max-width: 1100px;
  padding: 12px 14px 12px 20px;
  border-radius: 14px;
  background: rgba(20, 20, 32, 0.92);
  color: #ececf4;
}
.lb-bar p { margin: 0; font-size: 14.5px; line-height: 1.5; flex: 1 1 320px; }
.lb-actions { display: flex; gap: 8px; }
.lb-demo, .lb-close {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.lb-demo { background: var(--hp-gradient); color: #fff; }
.lb-demo svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.lb-close { border: 1px solid rgba(255, 255, 255, 0.25); background: transparent; color: #fff; }
.lb-close:hover { background: rgba(255, 255, 255, 0.1); }
.lb-demo:focus-visible, .lb-close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .hp-lightbox[open] { animation: none; } }
@media (max-width: 600px) {
  .lb-inner img { max-height: calc(96vh - 170px); }
  .lb-actions { width: 100%; }
  .lb-demo { flex: 1; justify-content: center; }
}
</style>
