#!/bin/sh
# RCC single-binary installer.
# Usage:
#   curl -sSL https://example.com/install.sh | sh
#   RCC_VERSION=0.1.0 RCC_REPO=Hughhhhcoder/remote-claude-code sh install.sh
set -eu

REPO="${RCC_REPO:-Hughhhhcoder/remote-claude-code}"
VERSION="${RCC_VERSION:-latest}"
PREFIX="${RCC_PREFIX:-$HOME/.rcc}"
BIN_DIR="${RCC_BIN_DIR:-$HOME/.local/bin}"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "need $1, not found"; }

uname_s=$(uname -s | tr '[:upper:]' '[:lower:]')
uname_m=$(uname -m)

case "$uname_s" in
  darwin) os=darwin ;;
  linux)  os=linux ;;
  *) die "unsupported OS: $uname_s (supported: darwin, linux)" ;;
esac

case "$uname_m" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) die "unsupported arch: $uname_m (supported: x64, arm64)" ;;
esac

PLATFORM="${os}-${arch}"

need_cmd node
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "node $NODE_MAJOR detected, need >= 20"
fi
say "node $(node -v) OK"

need_cmd curl
need_cmd tar

if [ "$VERSION" = "latest" ]; then
  say "resolving latest release from github.com/${REPO}"
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)
  if [ -z "${VERSION:-}" ]; then
    die "cannot determine latest version, set RCC_VERSION=x.y.z"
  fi
fi
VERSION="${VERSION#v}"

TARBALL="rcc-${VERSION}-${PLATFORM}.tar.gz"
SHA_FILE="${TARBALL}.sha256"
BASE="https://github.com/${REPO}/releases/download/v${VERSION}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "downloading ${BASE}/${TARBALL}"
curl -fsSL "${BASE}/${TARBALL}" -o "${TMP}/${TARBALL}" \
  || die "download failed: ${BASE}/${TARBALL}"

if curl -fsSL "${BASE}/${SHA_FILE}" -o "${TMP}/${SHA_FILE}" 2>/dev/null; then
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "${TMP}/${TARBALL}" | awk '{print $1}')
  else
    actual=$(shasum -a 256 "${TMP}/${TARBALL}" | awk '{print $1}')
  fi
  expected=$(awk '{print $1}' "${TMP}/${SHA_FILE}")
  [ "$expected" = "$actual" ] || die "sha256 mismatch: expected $expected got $actual"
  say "sha256 verified"
else
  warn "no sha256 sidecar, skipping verification"
fi

say "extracting"
tar -xzf "${TMP}/${TARBALL}" -C "${TMP}"

INSTALL_DIR="${PREFIX}/install/rcc-${VERSION}"
mkdir -p "$(dirname "$INSTALL_DIR")"
rm -rf "$INSTALL_DIR"
mv "${TMP}/rcc-${VERSION}" "$INSTALL_DIR"

[ -x "${INSTALL_DIR}/bin/rcc" ] || die "missing ${INSTALL_DIR}/bin/rcc after extract"

mkdir -p "$BIN_DIR"
ln -sf "${INSTALL_DIR}/bin/rcc"       "${BIN_DIR}/rcc"
ln -sf "${INSTALL_DIR}/bin/rcc-cli"   "${BIN_DIR}/rcc-cli"
ln -sf "${INSTALL_DIR}/bin/rcc-admin" "${BIN_DIR}/rcc-admin"

say "installed rcc ${VERSION} to ${INSTALL_DIR}"
say "symlinks: ${BIN_DIR}/{rcc,rcc-cli,rcc-admin}"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    warn "${BIN_DIR} is not on PATH. Add this to your shell rc:"
    printf '    export PATH="%s:$PATH"\n' "$BIN_DIR" >&2
    ;;
esac

say "run 'rcc' to start the host"
