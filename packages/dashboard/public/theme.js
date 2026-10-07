// Before first paint: the saved or system theme, so the page never flashes light.
// A file rather than an inline script, so the dashboard's CSP needs no 'unsafe-inline'.
try {
  var t = localStorage.getItem('hp-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
