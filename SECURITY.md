# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: the repository's
**Security** tab → **Report a vulnerability**. Do not open a public issue.

Include what you found, how to reproduce it, and what an attacker could do
with it. We aim to acknowledge reports within a few days and to fix confirmed
issues in a patch release, crediting you unless you prefer otherwise.

## Supported versions

Fixes go into the latest release of `@knowtific/helppuff`. Upgrade with
`npx @knowtific/helppuff@latest upgrade`.

## Scope

HelpPuff runs on each user's own Cloudflare account. In scope: the widget, the
Worker (chat API, admin API, dashboard, webhooks), the CLI and the knowledge
base. The threat model, what each layer protects and the known limits are in
the wiki: [Security](../../wiki/Security).
