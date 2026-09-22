// Every fixture embeds the widget the same way a real site does.
const script = document.createElement('script');
script.src = '/src/loader.ts';
script.type = 'module';
script.dataset.site = 'demo';
script.dataset.api = 'http://localhost:8787';
document.body.appendChild(script);
