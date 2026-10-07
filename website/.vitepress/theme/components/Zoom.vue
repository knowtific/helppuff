<script setup lang="ts">
import { openLightbox, type Shot } from '../lightbox';

/** A screenshot that opens large in the lightbox when clicked. Classes go on the button. */
const props = defineProps<{
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  caption?: string;
  demo?: Shot['demo'];
  lazy?: boolean;
}>();

const open = () =>
  openLightbox({ src: props.src, alt: props.alt, ...(props.caption ? { caption: props.caption } : {}), ...(props.demo ? { demo: props.demo } : {}) });
</script>

<template>
  <button type="button" class="hp-zoom" :aria-label="`Enlarge: ${alt}`" @click="open">
    <img :src="src" :alt="alt" :width="width" :height="height" :loading="lazy ? 'lazy' : undefined" />
  </button>
</template>

<style scoped>
.hp-zoom {
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: inherit;
  cursor: zoom-in;
}
.hp-zoom:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 4px; border-radius: 16px; }
.hp-zoom img { display: block; width: 100%; height: auto; }
</style>
