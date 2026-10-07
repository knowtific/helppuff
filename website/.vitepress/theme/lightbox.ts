import { ref } from 'vue';

/**
 * The one lightbox on the site: any screenshot opens in it, large, with a
 * link to the live demo it shows. `Zoom.vue` opens it; `Lightbox.vue`,
 * mounted once in the layout, shows it.
 */

export type Shot = {
  src: string;
  alt: string;
  caption?: string;
  /** The live demo the picture comes from. Opens in a new tab. */
  demo?: { href: string; label: string };
};

export const current = ref<Shot | null>(null);
export const openLightbox = (shot: Shot) => {
  current.value = shot;
};
export const closeLightbox = () => {
  current.value = null;
};
