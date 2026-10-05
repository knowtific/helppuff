# Contributing to Murmur

Thanks for helping. The full guide is in the wiki:
**[Contributing](../../wiki/Contributing)** (setup, the repository's layout,
rules, and how releases work).

The short version:

```bash
pnpm install
pnpm dev        # the Worker on :8787 and the widget playground on :5173, no API key needed
pnpm check      # lint, typecheck, tests, build, end-to-end: what CI runs
```

- Keep pull requests focused, with tests for what changed.
- A user-visible change updates the docs in [`wiki/`](wiki) in the same pull request.
- Database changes are new migrations that only add (see the top of
  `packages/server/src/db/migrations.ts`): upgrades and rollbacks depend on it.
- Coding agents start from [`AGENTS.md`](AGENTS.md).

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
