import { afterEach, vi } from 'vitest';

/** React's act() warnings are for test environments that opt in. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.location.hash = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
