import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';

/**
 * happy-dom gives us a real DOM with Shadow DOM support, which is what the
 * widget's isolation depends on. A few APIs it lacks are filled in here so
 * the components exercise their production paths rather than fallbacks.
 */

beforeEach(() => {
  // Constructable stylesheets — the widget's preferred style path (§8.2).
  if (typeof CSSStyleSheet !== 'undefined' && !CSSStyleSheet.prototype.replaceSync) {
    CSSStyleSheet.prototype.replaceSync = function replaceSync(this: CSSStyleSheet) {
      // happy-dom parses via textContent; the tests assert behaviour, not paint.
    };
  }

  if (!('onLine' in navigator)) {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  }

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function scrollTo() {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  try {
    localStorage.clear();
  } catch {
    // Some tests deliberately break storage.
  }
  document.body.innerHTML = '';
});
