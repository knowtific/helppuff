# Upgrading

New releases of HelpPuff are published to npm as `@knowtific/helppuff`. Upgrading
an assistant you already run is one command, keeps all your data, and can be
undone.

## How to know there is one

- **Dashboard:** a notice at the bottom of the sidebar, and **Settings →
  Updates**, which shows the version running, the latest, and the command.
- **Terminal:** `npx @knowtific/helppuff@latest upgrade --check`.

## Upgrade

From the folder you set the assistant up in (the one with `helppuff.json`):

```bash
npx @knowtific/helppuff@latest upgrade
```

Use `@latest` so `npx` fetches the newest CLI rather than a cached one. It:

1. **Shows the plan**: the version running, the version you are moving to,
   database changes still to apply, and any change to `helppuff.json`'s format.
   Then asks before going ahead.
2. **Notes a restore point.** D1 keeps a point-in-time history of your
   database (7 days on the Free plan, 30 on Paid). The upgrade records the
   moment just before it changes anything, and prints the command to go back to it.
3. **Updates `helppuff.json`** if the release changed its format, and tells you what changed.
4. **Deploys**: database migrations first, then the new Worker, then the live config.

Kept, always: conversations, leads, dashboard accounts, settings, the prompt
and its history, webhooks, the knowledge base, uploaded files.

If a release needs more than that (for example a new embedding model, which
means re-learning the site), the upgrade starts it for you, in the background.

**Agents and CI:**

```bash
npx -y @knowtific/helppuff@latest upgrade --check --json   # the plan, changes nothing
npx -y @knowtific/helppuff@latest upgrade --yes --json     # do it
```

## Why it runs in the terminal

An upgrade deploys new code to your Cloudflare account, which needs your
Cloudflare login. The dashboard never holds that, by design: nobody who gets
into the dashboard can change what runs on your account. So the dashboard
tells you about an update, and the terminal (or your coding agent) applies it.

## Rolling back

Deploy the previous release on purpose:

```bash
npx @knowtific/helppuff@0.3.1 deploy --allow-downgrade
```

Without `--allow-downgrade`, `deploy` refuses to replace a newer release, so
an old cached CLI can never roll you back by accident.

Database migrations only ever add (see below), so the previous release runs
fine on the upgraded database, and rolling back keeps everything recorded
since. To also put the **data** back as it was before the upgrade, run the
restore command the upgrade printed:

```bash
npx wrangler d1 time-travel restore knowtific-helppuff-<site> --timestamp=<the time it printed>
```

This overwrites the database, so conversations and leads since the upgrade
are lost. It is a last resort. `.helppuff/state.json` keeps the last 20
upgrades with their restore points.

## Pinning a version

Use an exact version wherever you run HelpPuff unattended (CI, scripts), and
upgrade deliberately:

```bash
npx -y @knowtific/helppuff@0.3.1 deploy --json
```

## How releases stay safe to upgrade

What every release promises, and how it is enforced:

| Layer | Rule |
| --- | --- |
| **Versions** | [Semantic versioning](https://semver.org). A patch or minor release never needs you to change anything. A major release may, and its notes say exactly what. |
| **Database (D1)** | Numbered migrations, append-only, applied by `deploy` before the new Worker serves, and by the Worker itself on first use as a fallback. They only **add** tables, columns and indexes, so the previous release keeps working on the upgraded database. Removing or renaming takes two releases: one stops using the old thing, a later major release removes it. Each statement is safe to run twice. |
| **Live config (KV)** | A new release reads the config the previous one wrote. Options that are retired are still accepted and ignored, so an older dashboard save never breaks a newer Worker. |
| **`helppuff.json`** | Carries a format version. A release that changes the format includes a step that rewrites older files; until you upgrade, every command reads an older file as the new format. A file written by a newer CLI is refused by an older one, with the command to update. |
| **Data reshaping** | Work too big for a migration (re-embedding the knowledge base, say) runs as a background job the deploy starts, never inside a migration. |
| **Downgrades** | Refused unless asked for (`--allow-downgrade`). |

Contributors: these rules are written next to the code that enforces them,
in `packages/server/src/db/migrations.ts` and
`packages/cli/src/engine/project.ts` (`PROJECT_UPGRADES`). See [[Contributing]].

## If an upgrade fails

The deploy stops at the step that failed and says why; nothing after it has
happened. Fix the cause (often Cloudflare access, or a secret) and run the
same command again: every step is safe to repeat. The error also prints the
database restore command, in case you need it.
