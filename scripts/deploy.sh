#!/usr/bin/env bash
#
# Deploy the Worker, remember where it landed, and print the embed snippet.
#
# Wrangler prints the workers.dev URL exactly once, and nothing afterwards
# reports it — `deployments list` omits it and `whoami` does not carry the
# account subdomain. So it is captured here and cached for the snippet and for
# later runs that skip the deploy.
#
# Arguments are passed through, so `pnpm deploy:worker --dry-run` still works.
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
SERVER="$ROOT/packages/server"
STATE="$SERVER/.wrangler"
LOG="$STATE/last-deploy.log"
URL_FILE="$STATE/worker-url"

mkdir -p "$STATE"

# `tee` would mask wrangler's exit code, so take it from PIPESTATUS.
set +e
(cd "$SERVER" && npx wrangler deploy "$@") 2>&1 | tee "$LOG"
status=${PIPESTATUS[0]}
set -e
[ "$status" -eq 0 ] || exit "$status"

url=$(grep -oE 'https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev' "$LOG" | head -1 || true)
if [ -n "$url" ]; then
  printf '%s' "$url" > "$URL_FILE"
fi

# A dry run prints no URL; fall back to the cached one rather than a placeholder.
bash "$ROOT/scripts/embed-snippet.sh"
