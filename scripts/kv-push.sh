#!/usr/bin/env bash
#
# Push a site's widget config from murmur.config.ts to KV, so it goes live
# without a deploy (docs/deployment.md). Defaults to the `knowtific` site:
#
#   pnpm kv:push              # config:knowtific
#   pnpm kv:push retell       # config:retell
#
# The JSON is generated and schema-checked by kv-config.mjs first, so a config
# the Worker would reject never reaches KV. It is kept as site.<id>.json
# (gitignored) so you can see exactly what was pushed.
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
SITE="${1:-knowtific}"
FILE="$ROOT/site.$SITE.json"

node scripts/kv-config.mjs "$SITE" > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"

(cd packages/server && npx wrangler kv key put --binding=MURMUR_KV --remote --preview false "config:$SITE" --path "$FILE")

echo "Pushed config:$SITE from $(basename "$FILE"). Live within about a minute (edge cache)."
