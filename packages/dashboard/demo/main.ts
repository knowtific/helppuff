import { installDemoApi } from './mock';

/**
 * The dashboard demo: the real dashboard, its admin API answered in the page
 * with sample data (`mock.ts`). Published on the website at
 * `/dashboard-demo/`; `pnpm --filter @helppuff/dashboard build:demo` builds it.
 */

installDemoApi();
// Open on the home page; the hash is the dashboard's router.
if (!location.hash) location.hash = '#/home';
void import('../src/main').then(showBanner);

function showBanner() {
  const banner = document.createElement('div');
  banner.setAttribute('role', 'note');
  banner.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:14px', 'transform:translateX(-50%)', 'z-index:50',
    'display:flex', 'align-items:center', 'gap:10px', 'padding:7px 8px 7px 14px', 'border-radius:999px',
    'font:500 12.5px/1.2 Inter,ui-sans-serif,system-ui,sans-serif', 'color:#fff', 'background:rgba(20,20,30,.88)',
    'box-shadow:0 8px 24px -8px rgba(0,0,0,.4)', 'backdrop-filter:blur(8px)', 'white-space:nowrap',
  ].join(';');
  banner.innerHTML =
    '<span>Demo with sample data. Changes stay in this tab.</span>' +
    '<a href="../" style="color:#fff;background:#5b5bf7;padding:5px 11px;border-radius:999px;text-decoration:none">HelpPuff website</a>' +
    '<button type="button" aria-label="Hide this note" style="all:unset;cursor:pointer;padding:2px 6px;opacity:.7">✕</button>';
  banner.querySelector('button')!.addEventListener('click', () => banner.remove());
  document.body.appendChild(banner);
}
