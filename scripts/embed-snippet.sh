#!/usr/bin/env bash
#
# Print the embed snippet for this deployment, with the real Worker URL and
# the real site id rather than placeholders.
#
# The URL is read from the cache written at deploy time. Wrangler prints it
# exactly once and no later command reports it: `deployments list` omits it and
# `whoami` does not carry the account subdomain.
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
URL_FILE="$ROOT/packages/server/.wrangler/worker-url"

YELLOW=$'\033[33m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

worker_url=$(cat "$URL_FILE" 2>/dev/null || true)
# The first site with a non-localhost origin: the one a real page would use.
site_id=$(node "$ROOT/scripts/review-config.mjs" --public-site 2>/dev/null || true)

printf '\n%sEmbed snippet%s\n' "$BOLD" "$RESET"

if [ -z "$worker_url" ]; then
  worker_url="https://<worker>.workers.dev"
  printf '%s! Worker URL unknown — deploy once, or copy it from the output above.%s\n' "$YELLOW" "$RESET"
fi

if [ -z "$site_id" ]; then
  site_id="<site>"
  printf '%s! No site has a public origin, so there is no site id to embed.%s\n' "$YELLOW" "$RESET"
  printf '%s  Add your domain to a site'\''s `origins` in murmur.config.ts.%s\n' "$DIM" "$RESET"
fi

printf '\n  Paste this before %s</body>%s on your site:\n\n' "$DIM" "$RESET"
printf '      <script src="%s/loader.js" data-site="%s" async></script>\n\n' "$worker_url" "$site_id"
printf '%s  Check it is serving:   curl -sI %s/loader.js%s\n\n' "$DIM" "$worker_url" "$RESET"
