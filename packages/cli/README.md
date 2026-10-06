# @knowtific/helppuff

An AI chat assistant for your website, set up in one command and run on
**your own Cloudflare account**: the chat widget, a knowledge base learned
from your site and files, and a dashboard for conversations and leads. The
default setup runs on the Workers Free plan.

```bash
npx @knowtific/helppuff
```

It asks for your website, deploys, and prints one link: a setup page where you
create your sign-in and check what it learned. Then paste one script tag on
your site.

```bash
npx @knowtific/helppuff deploy               # publish changes to helppuff.json or prompt.md
npx @knowtific/helppuff dashboard            # a one-time sign-in link
npx @knowtific/helppuff ask "Do you service Lilydale?" --timing
npx @knowtific/helppuff@latest upgrade       # move to a new release, safely
npx @knowtific/helppuff --help               # every command
```

Built for AI agents too: every command speaks `--json`, missing answers come
back as questions, and `helppuff mcp` serves the same engine as MCP tools. The
guide for agents ships in this package as `AGENTS.md`.

Documentation: the project's GitHub wiki (getting started, configuration,
providers, the widget, webhooks, upgrading, extending).

MIT licensed.
