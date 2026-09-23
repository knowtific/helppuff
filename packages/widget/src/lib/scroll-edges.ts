import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

export type ScrollEdges = {
  /** Nothing overflows, so there is nothing to reach. */
  fits: boolean;
  atStart: boolean;
  atEnd: boolean;
};

/**
 * Track whether a horizontally scrolling strip has content out of view.
 *
 * Both the carousel and the shortcut bar hide their scrollbar — a native bar
 * under a row of cards or chips reads as a defect — which means neither has
 * any affordance unless one is drawn deliberately. This is what tells them
 * when to draw it.
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement>,
  deps: readonly unknown[] = [],
): { edges: ScrollEdges; measure: () => void; scrollByStep: (direction: 1 | -1, itemSelector?: string) => void } {
  const [edges, setEdges] = useState<ScrollEdges>({ fits: true, atStart: true, atEnd: true });
  const frame = useRef(0);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const furthest = element.scrollWidth - element.clientWidth;
    setEdges({
      // A sub-pixel difference is not overflow anyone can scroll to.
      fits: furthest <= 1,
      atStart: element.scrollLeft <= 1,
      atEnd: element.scrollLeft >= furthest - 1,
    });
  }, [ref]);

  useEffect(() => {
    measure();
    const element = ref.current;
    if (!element) return;

    // The panel changes width between mobile and desktop, and chips can be
    // filtered out by `paths` on a route change.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => measure());
      observer.observe(element);
      return () => observer.disconnect();
    }
    return undefined;
    // `deps` is the caller's own list of things that change the content.
  }, [measure, ...deps]);

  const onScroll = useCallback(() => {
    // Scroll fires per frame while a smooth scroll runs; one measure is enough.
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [ref, onScroll]);

  /**
   * A vertical wheel over a horizontal strip should move it sideways —
   * otherwise a mouse user with no horizontal wheel cannot reach the
   * overflow at all.
   */
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaX !== 0 || event.deltaY === 0) return;
      const furthest = element.scrollWidth - element.clientWidth;
      if (furthest <= 1) return;
      element.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref]);

  const scrollByStep = useCallback(
    (direction: 1 | -1, itemSelector?: string) => {
      const element = ref.current;
      if (!element) return;
      const item = itemSelector ? element.querySelector(itemSelector) : null;
      const distance = item ? item.clientWidth + 10 : element.clientWidth * 0.8;
      let smooth = true;
      try {
        smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        // Fall back to smooth; it is the non-essential option either way.
      }
      element.scrollBy({ left: direction * distance, behavior: smooth ? 'smooth' : 'auto' });
    },
    [ref],
  );

  return { edges, measure, scrollByStep };
}
