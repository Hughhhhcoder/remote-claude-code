#!/bin/sh
# RCC single-binary installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --start --open
#   curl -fsSL .../install.sh | sh -s -- --tunnel
#
# Flags (compose freely):
#   --start        boot the host after install
#   --tunnel       boot with RCC_TUNNEL=try (public trycloudflare URL); implies --start
#   --open         open the URL in the browser after host comes up (needs --start or --tunnel)
#   --install-node auto-install Node 20 via Homebrew (macOS) or nvm (Linux) when missing / too old
#   --no-path      don't touch shell rc files (skip PATH autoconfig)
#   --yes          answer yes to any prompt (non-interactive CI / curl | sh paths)
#
# Env overrides:
#   RCC_VERSION=1.0.0            pin a specific release tag
#   RCC_REPO=owner/repo          use a fork
#   RCC_PREFIX=$HOME/.rcc        where to extract the tarball
#   RCC_BIN_DIR=$HOME/.local/bin where to put the rcc / rcc-cli / rcc-admin symlinks
set -eu

REPO="${RCC_REPO:-Hughhhhcoder/remote-claude-code}"
VERSION="${RCC_VERSION:-latest}"
PREFIX="${RCC_PREFIX:-$HOME/.rcc}"
BIN_DIR="${RCC_BIN_DIR:-$HOME/.local/bin}"

DO_START=0
DO_TUNNEL=0
DO_OPEN=0
DO_INSTALL_NODE=0
SKIP_PATH=0
ASSUME_YES=0

# curl | sh leaves stdin attached to the pipe so interactive `read` won't work —
# flip ASSUME_YES on automatically when we detect a non-tty stdin.
if [ ! -t 0 ]; then
  ASSUME_YES=1
fi

for arg in "$@"; do
  case "$arg" in
    --start)        DO_START=1 ;;
    --tunnel)       DO_TUNNEL=1; DO_START=1 ;;
    --open)         DO_OPEN=1 ;;
    --install-node) DO_INSTALL_NODE=1 ;;
    --no-path)      SKIP_PATH=1 ;;
    --yes|-y)       ASSUME_YES=1 ;;
    --help|-h)
      cat <<'HELP'
RCC installer

Usage:
  curl -fsSL .../install.sh | sh
  curl -fsSL .../install.sh | sh -s -- --start --open
  curl -fsSL .../install.sh | sh -s -- --tunnel --open

Flags:
  --start          boot the host after install
  --tunnel         boot with RCC_TUNNEL=try (public trycloudflare URL); implies --start
  --open           open the URL in the browser after host comes up (needs --start or --tunnel)
  --install-node   auto-install Node 20 via Homebrew (macOS) or nvm (Linux)
  --no-path        don't modify shell rc files (skip PATH autoconfig)
  --yes, -y        answer yes to prompts (auto-enabled when piped from curl)

Env:
  RCC_VERSION=1.0.0             pin a specific tag
  RCC_REPO=owner/repo           use a fork
  RCC_PREFIX=$HOME/.rcc         install root
  RCC_BIN_DIR=$HOME/.local/bin  symlink dir
HELP
      exit 0
      ;;
    *)
      printf 'unknown flag: %s (run with --help)\n' "$arg" >&2
      exit 2
      ;;
  esac
done

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
sub()  { printf '\033[2m    %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "need $1, not found"; }

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Node.js check (+ optional auto-install)
# ---------------------------------------------------------------------------
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
  [ "$MAJOR" -ge 20 ] 2>/dev/null
}

install_node_mac() {
  if command -v brew >/dev/null 2>&1; then
    say "installing node via Homebrew"
    brew install node >/dev/null || die "brew install node failed"
  else
    die "Homebrew not found. Install from https://brew.sh first, or install Node 20+ manually (https://nodejs.org)."
  fi
}

install_node_linux() {
  # Use nvm — no root required, works on every distro.
  say "installing node via nvm (no root)"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash >/dev/null
  fi
  # shellcheck disable=SC1090,SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install --lts >/dev/null
  nvm use --lts >/dev/null
}

if ! node_ok; then
  current_node="(missing)"
  if command -v node >/dev/null 2>&1; then current_node=$(node -v); fi
  warn "Node.js 20+ required, detected: $current_node"

  if [ "$DO_INSTALL_NODE" -eq 0 ] && [ "$ASSUME_YES" -eq 1 ]; then
    # curl | sh path — opt user in automatically. The `--install-node` flag
    # is for users who want to be explicit; the heuristic here makes the
    # one-liner Just Work.
    DO_INSTALL_NODE=1
  fi

  if [ "$DO_INSTALL_NODE" -eq 1 ]; then
    case "$os" in
      darwin) install_node_mac ;;
      linux)  install_node_linux ;;
    esac
    if ! node_ok; then
      die "node install appeared to succeed but node >= 20 still not on PATH (open a new terminal?)"
    fi
  else
    die "node >= 20 required. Re-run with --install-node to auto-install, or install manually (https://nodejs.org)."
  fi
fi
say "node $(node -v) OK"

need_cmd curl
need_cmd tar

# ---------------------------------------------------------------------------
# Optional: check for `claude` CLI (informational only — RCC runs even without)
# ---------------------------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  warn "'claude' CLI not found on PATH — RCC will start but sessions will fail until you install it."
  sub "See https://docs.claude.com/en/docs/claude-code for Claude Code install instructions."
fi

# ---------------------------------------------------------------------------
# Resolve version + download tarball
# ---------------------------------------------------------------------------
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
  || die "download failed: ${BASE}/${TARBALL}  (no prebuilt binary for ${PLATFORM}? try --from-source or build from git)"

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

# ---------------------------------------------------------------------------
# Extract + symlink
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# PATH autoconfig (opt-out via --no-path)
# ---------------------------------------------------------------------------
on_path() {
  case ":${PATH}:" in
    *":${BIN_DIR}:"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Figure out the right shell rc file. Pick the one matching $SHELL, fall back
# to .profile. We never write to /etc — strictly user-scoped.
rc_file() {
  shell_name=$(basename "${SHELL:-}")
  case "$shell_name" in
    zsh)   printf '%s\n' "$HOME/.zshrc" ;;
    bash)
      # macOS + Linux login shells use different files; .bashrc is the safer one.
      if [ -f "$HOME/.bashrc" ]; then printf '%s\n' "$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then printf '%s\n' "$HOME/.bash_profile"
      else printf '%s\n' "$HOME/.bashrc"
      fi
      ;;
    fish)  printf '%s\n' "$HOME/.config/fish/config.fish" ;;
    *)     printf '%s\n' "$HOME/.profile" ;;
  esac
}

path_line() {
  rc_path=$1
  case "$rc_path" in
    *config.fish) printf 'set -gx PATH "%s" $PATH\n' "$BIN_DIR" ;;
    *)            printf 'export PATH="%s:$PATH"\n' "$BIN_DIR" ;;
  esac
}

if on_path; then
  :
elif [ "$SKIP_PATH" -eq 1 ]; then
  warn "${BIN_DIR} is not on PATH (you passed --no-path). Add this to your shell rc:"
  printf '    %s\n' "$(path_line "$(rc_file)")" >&2
else
  RC=$(rc_file)
  LINE=$(path_line "$RC")
  mkdir -p "$(dirname "$RC")"
  touch "$RC"
  if ! grep -qF "$BIN_DIR" "$RC" 2>/dev/null; then
    {
      printf '\n# Added by rcc installer %s\n' "$(date +%Y-%m-%d)"
      printf '%s' "$LINE"
    } >> "$RC"
    say "added ${BIN_DIR} to PATH in ${RC}"
    sub "restart your shell, or run: source \"$RC\""
  else
    sub "${RC} already mentions ${BIN_DIR}; leaving untouched"
  fi
  # Export for this script's remaining steps (--start / --open).
  PATH="$BIN_DIR:$PATH"
  export PATH
fi

# ---------------------------------------------------------------------------
# --start / --tunnel / --open
# ---------------------------------------------------------------------------
if [ "$DO_START" -eq 1 ]; then
  # Spawn the host in the background so `curl | sh` can keep streaming and
  # the user ends up with a live, printable URL without a blocking foreground.
  log_file="${PREFIX}/install.start.log"
  : > "$log_file"

  if [ "$DO_TUNNEL" -eq 1 ]; then
    say "starting rcc with public tunnel (RCC_TUNNEL=try)"
    RCC_TUNNEL=try "${BIN_DIR}/rcc" >"$log_file" 2>&1 &
  else
    say "starting rcc host (local loopback only — add --tunnel for public URL)"
    "${BIN_DIR}/rcc" >"$log_file" 2>&1 &
  fi
  PID=$!
  sub "logs: tail -f $log_file"
  sub "pid:  $PID"

  URL=""
  # Wait up to 20s for a URL to appear. For tunnel mode we look for the
  # trycloudflare host; for local we settle for "listening on".
  i=0
  while [ $i -lt 40 ]; do
    sleep 0.5
    if [ "$DO_TUNNEL" -eq 1 ]; then
      URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$log_file" 2>/dev/null | head -1 || true)
      [ -n "$URL" ] && break
    else
      if grep -q "listening on http://" "$log_file" 2>/dev/null; then
        URL="http://localhost:7777"
        break
      fi
    fi
    i=$((i + 1))
  done

  # Surface the pairing code regardless — user always needs it the first time.
  CODE=$(grep -oE 'code: [0-9]{3} [0-9]{3}' "$log_file" 2>/dev/null | head -1 | awk '{print $2$3}' || true)

  if [ -n "$URL" ]; then
    say "rcc is up: $URL"
    if [ -n "$CODE" ]; then
      sub "pairing code: $CODE  (valid 5 min)"
    else
      sub "open the URL above, then watch 'tail -f $log_file' for the 6-digit pairing code"
    fi
    if [ "$DO_OPEN" -eq 1 ]; then
      if command -v open >/dev/null 2>&1; then
        open "$URL" >/dev/null 2>&1 || true
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 || true
      else
        sub "don't know how to open a browser on this system; visit $URL manually"
      fi
    fi
  else
    warn "rcc started but no URL appeared in ${log_file} within 20s — check the log"
  fi

  sub "stop with: kill $PID"
else
  if [ "$DO_OPEN" -eq 1 ]; then
    warn "--open ignored without --start (nothing to point a browser at)"
  fi
  say "run 'rcc' to start the host  (or re-run this installer with --start --open --tunnel)"
fi
