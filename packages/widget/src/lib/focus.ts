const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'textarea:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/**
 * Keep Tab inside the panel while it is open, and move focus into it on open.
 * The dialog is `aria-modal="false"` — it does not block the page —
 * so this only loops Tab, it does not take the page hostage.
 */
export function trapFocus(panel: HTMLElement): () => void {
  const first = focusable(panel)[0];
  try {
    (first ?? panel).focus({ preventScroll: true });
  } catch {
    // A browser that refuses focus is not a reason to fail.
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const items = focusable(panel);
    if (items.length === 0) return;

    const firstItem = items[0] as HTMLElement;
    const lastItem = items[items.length - 1] as HTMLElement;
    const active = panel.getRootNode() instanceof ShadowRoot
      ? (panel.getRootNode() as ShadowRoot).activeElement
      : document.activeElement;

    if (event.shiftKey && active === firstItem) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && active === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  };

  panel.addEventListener('keydown', onKeyDown);
  return () => panel.removeEventListener('keydown', onKeyDown);
}
