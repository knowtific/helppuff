import { afterEach, vi } from 'vitest';
import { Storage } from 'happy-dom';

/*
 * Node 25 and later define their own `localStorage` global, which is
 * `undefined` unless Node is started with `--localstorage-file`, and vitest
 * keeps a global that already exists over happy-dom's. Give the tests
 * happy-dom's storage there, as they get on older Node.
 */
if (typeof localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: new Storage(), configurable: true, writable: true });
}

/** React's act() warnings are for test environments that opt in. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.location.hash = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
