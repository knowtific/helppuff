import { render } from 'preact';
import type { AppHandle, Runtime } from '../loader.js';
import { LOADER_CSS } from '../launcher-shell.js';
import { BASE_TOKENS, RESET, applyStyles, themeOverrides } from '../styles/tokens.js';
import { WIDGET_CSS } from '../styles/widget.css.js';
import { Api } from './api.js';
import { parseConfig } from './validate.js';
import { App, Boundary, type AppHandleRef } from './App.js';

/**
 * The app chunk's only export. The loader imports this lazily and calls it
 * once; a throw here is caught by the loader and treated as fatal (§8.3).
 */
export function mount(runtime: Runtime): AppHandle {
  // The loader read only the launcher's fields; this is the full validation
  // §8.3 requires. A config that cannot be parsed is fatal.
  const config = parseConfig(runtime.rawConfig);
  if (!config) {
    runtime.hide('config_invalid');
    return inert();
  }

  const api = new Api(runtime.apiBase, runtime.siteId);

  // The loader's minimal sheet stays for the launcher; these add the rest.
  // `themeOverrides` goes last: LOADER_CSS and BASE_TOKENS both declare the
  // default tokens on `:host`, so at equal specificity whatever comes later
  // wins — putting the site's accent earlier would silently discard it.
  applyStyles(runtime.root, BASE_TOKENS + RESET + LOADER_CSS + WIDGET_CSS + themeOverrides(config));

  const container = document.createElement('div');
  // Carries the typography reset (see `.mm-root` in launcher-shell.ts).
  container.className = 'mm-root';
  runtime.root.appendChild(container);
  runtime.disposer.add(() => {
    try {
      render(null, container);
    } catch {
      // Unmounting is best effort; the host element is removed regardless.
    }
    container.remove();
  });

  const handle: AppHandleRef = { current: null };
  let generation = 0;

  const draw = () => {
    render(
      <Boundary runtime={runtime} onReset={() => { generation += 1; draw(); }}>
        <App key={generation} runtime={runtime} config={config} api={api} handle={handle} />
      </Boundary>,
      container,
    );
  };

  draw();

  // Commands are proxied so they work even if the app re-mounts after an error.
  const call = <K extends keyof NonNullable<typeof handle.current>>(key: K) =>
    ((...args: unknown[]) => {
      const target = handle.current?.[key] as ((...a: unknown[]) => unknown) | undefined;
      return target?.(...args);
    });

  return {
    open: call('open') as () => void,
    close: call('close') as () => void,
    toggle: call('toggle') as () => void,
    send: call('send') as (text: string) => void,
    identify: call('identify') as (lead: Record<string, string>) => void,
    reset: call('reset') as () => void,
    state: () => handle.current?.state() ?? null,
  };
}

/** Returned when the config turned out to be unusable and the widget hid. */
function inert(): AppHandle {
  const noop = () => undefined;
  return { open: noop, close: noop, toggle: noop, send: noop, identify: noop, reset: noop, state: () => null };
}
