# CLAUDE.md

@AGENTS.md

AGENTS.md above is the shared orientation for every coding agent; keep project
facts there, not here, so the two never drift. This file is only for Claude
Code specifics.

- Start from the map in AGENTS.md and open only the files for the task; don't
  re-survey the whole repo.
- `.wrangler/`, `dist/`, `dist-demo/`, `dist-playground/`, `test-results/` and `node_modules/` are
  generated. Skip them when searching.
- Before calling work done, run the narrowest relevant checks (the single
  vitest file, `pnpm typecheck`, `pnpm lint`), and `pnpm build` if the widget
  changed.
