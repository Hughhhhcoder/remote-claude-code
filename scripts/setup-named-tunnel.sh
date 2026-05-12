#!/bin/sh
# setup-named-tunnel.sh — finish the named-tunnel wiring after you've run
# `cloudflared tunnel login` and picked a Cloudflare zone.
#
# Usage:
#   scripts/setup-named-tunnel.sh rcc.example.com
#   scripts/setup-named-tunnel.sh rcc.example.com rcc-home   # custom tunnel name
#
# Prereqs (one-time, you must do these first):
#   1. A Cloudflare account, with a domain whose NS points at Cloudflare.
#   2. `cloudflared tunnel login` — opens a browser; pick the zone that owns
#      your target hostname. Writes ~/.cloudflared/cert.pem.
#
# This script then:
#   - `cloudflared tunnel create <name>` (if not already present)
#   - `cloudflared tunnel route dns <name> <hostname>`
#   - writes ~/.rcc/config.json with the tunnel block
#   - tells you how to start rcc
set -eu

HOSTNAME="${1:-}"
NAME="${2:-rcc-$(hostname -s | tr '[:upper:]' '[:lower:]')}"

if [ -z "$HOSTNAME" ]; then
  cat >&2 <<EOF
usage: $0 <hostname> [tunnel-name]

Examples:
  $0 rcc.example.com
  $0 rcc.example.com rcc-home
EOF
  exit 2
fi

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v cloudflared >/dev/null 2>&1 \
  || die "cloudflared not found. Install: brew install cloudflared  (or see https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)"

command -v jq >/dev/null 2>&1 || die "jq not found. brew install jq"

CERT="$HOME/.cloudflared/cert.pem"
if [ ! -f "$CERT" ]; then
  cat >&2 <<EOF
$(printf '\033[1;31merror:\033[0m') $CERT missing.

You haven't logged in to Cloudflare yet. Run this first:

    cloudflared tunnel login

A browser opens; pick the zone that owns $HOSTNAME. Then re-run this script.
EOF
  exit 1
fi

# ---------------------------------------------------------------------------
# Tunnel create (or reuse)
# ---------------------------------------------------------------------------
existing=$(cloudflared tunnel list -o json 2>/dev/null | jq -r ".[] | select(.name == \"$NAME\") | .id" || true)
if [ -n "$existing" ]; then
  say "reusing existing tunnel '$NAME' (id=$existing)"
  TUNNEL_ID="$existing"
else
  say "creating tunnel '$NAME'"
  cloudflared tunnel create "$NAME"
  TUNNEL_ID=$(cloudflared tunnel list -o json | jq -r ".[] | select(.name == \"$NAME\") | .id")
  [ -n "$TUNNEL_ID" ] || die "tunnel created but couldn't find its id"
fi

CREDS="$HOME/.cloudflared/${TUNNEL_ID}.json"
[ -f "$CREDS" ] || die "credentials file $CREDS missing after create"

# ---------------------------------------------------------------------------
# DNS route
# ---------------------------------------------------------------------------
say "routing DNS: $HOSTNAME → $NAME"
# This is idempotent-ish: if the CNAME already exists for this tunnel it
# succeeds; if it exists for a different tunnel you get a helpful error.
cloudflared tunnel route dns "$NAME" "$HOSTNAME" || warn "DNS route may already exist (harmless)"

# ---------------------------------------------------------------------------
# Write ~/.rcc/config.json
# ---------------------------------------------------------------------------
CFG="$HOME/.rcc/config.json"
mkdir -p "$HOME/.rcc"

if [ -f "$CFG" ]; then
  # merge: keep existing fields, replace tunnel block
  TMP=$(mktemp)
  jq --arg name "$NAME" \
     --arg host "$HOSTNAME" \
     --arg creds "$CREDS" \
     '. + {tunnel: {mode: "named", name: $name, hostname: $host, credentialsFile: $creds}}' \
     "$CFG" > "$TMP"
  mv "$TMP" "$CFG"
else
  cat > "$CFG" <<EOF
{
  "tunnel": {
    "mode": "named",
    "name": "$NAME",
    "hostname": "$HOSTNAME",
    "credentialsFile": "$CREDS"
  }
}
EOF
fi
say "wrote $CFG"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
cat <<EOF

$(printf '\033[1;32m✓\033[0m') Named tunnel configured.

Start rcc with the named tunnel:

    RCC_TUNNEL=named rcc

Your stable URL:  https://$HOSTNAME

First device still needs to pair; subsequent reloads go straight to the app.
EOF
