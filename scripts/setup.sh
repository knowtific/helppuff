#!/usr/bin/env bash
#
# First-deployment setup: KV namespace, first deploy, then every secret your
# config references. Idempotent — safe to re-run, and it never overwrites a
# secret or a namespace that already exists without asking.
#
# The order is forced by Cloudflare: secrets attach to a Worker, so the Worker
# has to exist before any can be set ("If this is a new Worker, run wrangler
# deploy first to create it"). The first deploy therefore goes out with its
# connectors unconfigured. That is safe — `origins` gates every route, so a
# Worker nobody has allowlisted yet can be reached by nobody — and secrets
# take effect the moment they are set, with no second deploy needed.
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
SERVER="$ROOT/packages/server"
TOML="$SERVER/wrangler.toml"
CONFIG="$ROOT/murmur.config.ts"
# Cached so a re-run that skips the deploy can still print the real snippet.
URL_FILE="$SERVER/.wrangler/worker-url"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

wrangler() { (cd "$SERVER" && npx wrangler "$@"); }

# ---------------------------------------------------------------- 0. checks

step "Checking prerequisites"

if ! wrangler whoami >/dev/null 2>&1; then
  warn "Not logged in. Run: npx wrangler login"
  exit 1
fi
ok "Logged in to Cloudflare"

if [ ! -f "$CONFIG" ]; then
  node "$ROOT/scripts/ensure-config.mjs"
fi
ok "murmur.config.ts present"

# ------------------------------------------------------------------- 1. KV

step "KV namespace"

if grep -q 'REPLACE_WITH_KV_ID' "$TOML"; then
  echo "Creating the MURMUR_KV namespace…"
  created=$(wrangler kv namespace create MURMUR_KV 2>&1 || true)
  preview=$(wrangler kv namespace create MURMUR_KV --preview 2>&1 || true)

  # Wrangler prints the id inside the snippet it suggests pasting.
  id=$(printf '%s' "$created" | grep -oE '"?id"? *= *"[0-9a-f]{32}"' | grep -oE '[0-9a-f]{32}' | head -1)
  pid=$(printf '%s' "$preview" | grep -oE '"?(preview_)?id"? *= *"[0-9a-f]{32}"' | grep -oE '[0-9a-f]{32}' | head -1)

  if [ -z "$id" ]; then
    warn "Could not read the namespace id from wrangler's output. Create it by hand:"
    echo "    npx wrangler kv namespace create MURMUR_KV"
    echo "  then put the id into $TOML"
    printf '%s\n' "$created"
    exit 1
  fi

  # Keep a copy before rewriting, so a bad sed is recoverable.
  cp "$TOML" "$TOML.bak"
  sed -i "s/REPLACE_WITH_KV_ID/$id/" "$TOML"
  [ -n "$pid" ] && sed -i "s/REPLACE_WITH_KV_PREVIEW_ID/$pid/" "$TOML"
  ok "KV namespace $id written to wrangler.toml (previous file kept as wrangler.toml.bak)"
else
  ok "KV namespace already configured"
fi

# -------------------------------------------------------------- 2. secrets

step "First deploy"

# `secret list` is the cheapest way to ask "does this Worker exist yet?".
if wrangler secret list >/dev/null 2>&1; then
  ok "Worker already deployed"
else
  echo "The Worker does not exist yet, and secrets cannot be set until it does."
  printf '  Build and deploy it now? [Y/n] '
  read -r reply </dev/tty
  if [ -n "$reply" ] && [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
    warn "Stopping. Run 'pnpm build && pnpm deploy:worker', then re-run this script."
    exit 0
  fi
  # `deploy:worker` captures the URL and prints the snippet itself.
  (cd "$ROOT" && pnpm build && pnpm deploy:worker)
  ok "Deployed"
fi

step "Secrets"

# Already set on the Worker, so we never clobber one silently.
existing=$(wrangler secret list 2>/dev/null | grep -oE '"name": *"[A-Z0-9_]+"' | grep -oE '[A-Z0-9_]+$' || true)
has_secret() { printf '%s\n' "$existing" | grep -qx "$1"; }

put_secret() {
  local name="$1" value="$2"
  printf '%s' "$value" | wrangler secret put "$name" >/dev/null
  ok "$name set"
}

# MURMUR_SECRET signs session tokens. Generated, never typed.
if has_secret MURMUR_SECRET; then
  ok "MURMUR_SECRET already set"
else
  put_secret MURMUR_SECRET "$(openssl rand -base64 32)"
fi

# Everything else comes from the `{ env: 'NAME' }` refs in the config, so the
# prompts always match what this deployment actually needs.
refs=$(grep -oE "env: *'[A-Z0-9_]+'" "$CONFIG" | grep -oE "[A-Z0-9_]+" | sort -u || true)

if [ -z "$refs" ]; then
  ok "Config references no secrets"
else
  for name in $refs; do
    if has_secret "$name"; then
      ok "$name already set"
      continue
    fi
    # Reuse the local value when there is one, so you are not retyping keys.
    local_value=$(grep -E "^$name=" "$SERVER/.dev.vars" 2>/dev/null | head -1 | cut -d= -f2- || true)
    if [ -n "$local_value" ] && [ "${local_value#REPLACE_}" = "$local_value" ]; then
      printf '  %s — use the value from .dev.vars? [Y/n] ' "$name"
      read -r reply </dev/tty
      if [ -z "$reply" ] || [ "$reply" = "y" ] || [ "$reply" = "Y" ]; then
        put_secret "$name" "$local_value"
        continue
      fi
    fi
    printf '  %s — paste the value (input hidden): ' "$name"
    read -rs value </dev/tty; echo
    if [ -z "$value" ]; then
      warn "$name skipped — the connector or sink using it will fail until it is set"
    else
      put_secret "$name" "$value"
    fi
  done
fi

# ---------------------------------------------------------- 3. sanity check

step "Config review"

# Reads murmur.config.ts rather than grepping it, so a development site and a
# production one in the same file are judged separately.
node "$ROOT/scripts/review-config.mjs" || true

bash "$ROOT/scripts/embed-snippet.sh"

step "Next"
echo "  Secrets are live already — setting one does not need a deploy."
echo "  Redeploy only after changing code or murmur.config.ts:"
echo "      pnpm build && pnpm deploy:worker"
