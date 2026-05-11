# RCC — Remote Claude Code

> Run Claude Code on your laptop. Drive it from anywhere — iPhone, iPad, desktop browser, another Mac — over a secure tunnel with the same Claude.ai-inspired UI end-to-end.

RCC wraps the local `claude` CLI (or the Claude Agent SDK) inside a small daemon and exposes a WebSocket + REST + PWA surface. Pair a device once with a 6-digit code, then any browser or installed PWA can attach to the same sessions, stream new output, approve tools, fork conversations, or just read along. E2E encrypted, fully auditable, pluggable, and designed mobile-first.

[中文快速上手](docs/quickstart.zh.md) · [English Quickstart](docs/quickstart.en.md) · [Architecture](docs/architecture.md) · [Threat model](docs/threat-model.md)

---

## Quickstart

### Install (one-liner, macOS / Linux)

```sh
# Just install:
curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | sh

# Install + boot host locally + open browser:
curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | sh -s -- --start --open

# Install + boot with a public Cloudflare tunnel URL (use from any device, any network):
curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | sh -s -- --tunnel --open
```

The installer:
1. Verifies (and optionally installs via `brew` / `nvm`) Node ≥ 20
2. Warns if `claude` CLI isn't on PATH (install: https://docs.claude.com/en/docs/claude-code)
3. Downloads the signed tarball from the latest GitHub release, verifies sha256
4. Extracts to `~/.rcc/install/rcc-<ver>/` and symlinks `rcc` / `rcc-cli` / `rcc-admin` into `~/.local/bin/`
5. Appends `~/.local/bin` to your shell's PATH (zsh / bash / fish) unless you pass `--no-path`
6. Optionally boots the host, grabs the URL + pairing code, and opens your browser

Update later with `rcc update` (same tarball flow).

### From source (devs / auditors)

```sh
git clone https://github.com/Hughhhhcoder/remote-claude-code.git
cd remote-claude-code
pnpm install       # Node >= 20, pnpm 9.x

# 2. Run host daemon (shell 1) and web frontend (shell 2)
pnpm dev:host       # :7777 — daemon, WS + REST
pnpm dev:web        # :5273 — Vite dev server, proxies /ws

# 3. Open the URL printed by dev:host in any browser.
#    First load shows a 6-digit pairing code — type it to claim a device token.
#    Subsequent visits from that device reattach automatically.
```

For production / public access:

```sh
# Random Cloudflare tunnel (no account needed)
RCC_TUNNEL=1 rcc

# Named tunnel (your own domain)
RCC_TUNNEL=named rcc
```

Full install matrix (Homebrew, prebuilt tarballs, Docker-less one-liner, env var reference): [docs/install.md](docs/install.md).

Don't want to install the real `claude` binary? Swap the driver:

```sh
RCC_CLAUDE_CMD=bash RCC_CLAUDE_ARGS="-l" RCC_CWD=/tmp pnpm dev:host
```

---

## What's in the box

### Clients and drivers

- **Mobile-first PWA** — installable, offline cache of recent sessions, Web Push for high-risk approvals, system share target, haptic feedback, pull-to-refresh, pinch-zoom code blocks, 4-tab bottom nav (chat / files / approvals / settings).
- **Desktop web** — same codebase, container-queries-first layout, 280px sidebar with projects + peers + archived, global Cmd+K palette, `?` shortcut help, chord bindings (`g s` / `g i` / `c n` …), landmark cycling with F6.
- **CLI + SDK drivers** — pick `claude` pty driver (real terminal) or Claude Agent SDK driver (structured messages with token/cost stats). Both render identically as chat bubbles via the host-side ANSI/tool/diff state machine.
- **`@rcc/cli`** — Node client speaking the same WebSocket protocol for scripts and CI.

### Chat surface

- Claude.ai-inspired design language: warm cream palette (`#eeece2` light / `#1a1816` dark), Charter serif body, Inter chrome, JetBrains Mono code, terra cotta accent. High-contrast AA override respecting `prefers-contrast`.
- **Rich segments** — text + markdown (XSS-safe, no innerHTML), fenced code with built-in tokenizer (TS / JS / JSON / Python / Go / Rust / shell), unified diff with per-hunk chevrons, side-by-side diff on ≥lg, inline tool_use / tool_result cards with input/output separation.
- **Smart tool-output summarizer** — long results classified as error / JSON / dirlist / grep / text with head+tail folding, top-key table for JSON, grouped matches for grep.
- **Streaming** — rAF-coalesced delta frames, orphan-update handling, reconnect + seq-checked replay with ring buffer (drops → auto toast + refetch).
- **Message actions** — copy as text / Markdown, quote to composer, pin to notebook, share deep link, fork session from any message, regenerate (planned).
- **Fork, rename, pin, archive, tag** sessions. Auto-title from first user message. Pull-to-refresh on mobile.
- **Export** — Markdown, JSON, print-to-PDF with dedicated `@media print` stylesheet; offline static HTML (session viewable without the host).
- **Context injection** — `@mention` sessions or files (live `fs.ls` completions), cross-session history paste with byte-budget warning (32 KB cap, 24 KB yellow).
- **Workflow runner** — step-visualized panel (mobile bottom sheet / desktop floating card), interpolated variables `{{name}}` / `{{env:VAR}}`, conditional `if` expressions, skip / retry / resume-from-step, live elapsed time.
- **Starters** — Claude-styled card grid, one-click preview of system prompt + skills + first-steps bootstrap.

### Panes and modes

- Files (breadcrumb nav, Monaco lazy-loaded only on demand)
- Approvals (pending + 24h history, Face ID gate on high-risk)
- Inbox (grouped today / this week / earlier)
- Devices / Peers (fingerprint chip, revoke with passkey gate)
- Notebook (notes + chat references that resolve to real messages)
- Recording (start/stop via `record.*`, asciinema-compatible cast + xterm playback at 0.5x–4x)
- Settings (10 lazy tabs: Skills / MCP / Commands / Subagents / Hooks / Permissions / Starters / Workflows / Prompts / Plugins / Notifications / Appearance)
- Marketplace (skills / MCPs / plugins, install with scope picker)
- Session timeline (chronological merge of messages + audit entries)
- Metrics panel (sparklines, p50/p95 approval latency, active sessions, crash count)

### Security model

- **Pairing** — PAKE-style 6-digit code → per-device token + X25519 keypair; loopback trust configurable.
- **E2E encryption** — X25519 ECDH + libsodium secretbox, per-device shared key, replay nonces, brotli/gzip negotiated transport.
- **Passkeys (WebAuthn)** — required for high-risk approvals, device revocation, and toggling `bypassPermissions`. Fallback to `confirm()` + typed warning when WebAuthn unavailable.
- **Audit log** — append-only JSONL (`~/.rcc/audit.jsonl`), searchable UI, sensitive-field redacted export endpoint (`GET /api/v1/logs/export`) with self-referential `logs.export` entry.
- **CSP / COEP / COOP / Permissions-Policy** headers, cache-busting SW (`rcc-*-<build-hash>` buckets, `updateViaCache:"none"`), token rotation hooks.
- **Share links** — optional TTL, revocable, read-only whitelist of frames; guests get no E2E key.
- **Quiet hours** for push notifications (per-device, per-tz, cross-midnight aware).

### Infra

- Multi-host federation (subscribe remote hosts, sid-prefixed merge, cross-peer visibility).
- Cloudflared tunnels — random `try` or named.
- REST API + OpenAPI 3.1, served off the same HTTP surface.
- Prebuilt artifacts gzip+brotli, long-cache for hashed assets, SW precache only shell (~122 KB) and lazy-load Monaco / xterm / sodium / yjs on demand.
- Offline hydrate: session list + last-seen messages persist in `localStorage` with LRU eviction.

---

## Architecture

```
                                 +------------------+
                                 |   claude CLI /   |
                                 | Claude Agent SDK |
                                 +---------+--------+
                                           |
                                           | pty / SDK stream
                                           v
+----------+    WS + REST    +--------------------------+
|  Browser | <-------------> |  @rcc/host (Node daemon) |
|  (PWA)   |   E2E encrypted |  - session registry      |
+----------+                 |  - ChatParser state mach.|
                             |  - audit.jsonl           |
+----------+    WS + REST    |  - push / webauthn       |
|  @rcc/cli| <-------------> |  - plugins + market      |
|  (Node)  |                 |  - cloudflared tunnel    |
+----------+                 +-----------+--------------+
                                         |
                                         | mDNS / manual
                                         v
                                 +------------------+
                                 |  Peer hosts      |
                                 |  (federation)    |
                                 +------------------+
```

Protocol lives in `packages/protocol` (Zod-validated Frame discriminated union). Host in `packages/host`. Web PWA in `packages/web`. CLI in `packages/cli`. Full component walkthrough in [docs/architecture.md](docs/architecture.md).

---

## Environment variables (most common)

| Variable | Default | Purpose |
|---|---|---|
| `RCC_PORT` | `7777` | host port |
| `RCC_CWD` | `process.cwd()` | default cwd for new sessions |
| `RCC_CLAUDE_CMD` | `claude` | driver executable |
| `RCC_CLAUDE_ARGS` | (none) | extra CLI args |
| `RCC_PERMISSION_MODE` | `default` | `default` / `acceptEdits` / `plan` / `bypassPermissions` |
| `RCC_TUNNEL` | (none) | `1` / `try` / `named` / `off` |
| `RCC_TRUST_LOOPBACK` | `1` | `0` forces tokens even on loopback |

Full table: [docs/install.md](docs/install.md).

---

## Documentation

- [Quickstart (zh)](docs/quickstart.zh.md) · [Quickstart (en)](docs/quickstart.en.md)
- [Install](docs/install.md)
- [Architecture](docs/architecture.md)
- [Threat model](docs/threat-model.md)
- [Operations](docs/operations.md)
- [Plugin authoring](docs/plugin-authoring.md)
- [CLI usage](packages/cli/README.md)
- [Changelog](CHANGELOG.md)

---

## Development

```sh
pnpm install
pnpm -r typecheck       # all packages
pnpm -F @rcc/web build  # production web bundle
pnpm dev                # run host + web in parallel
```

Mobile verification is a hard gate on every phase: 375 px baseline, touch targets ≥ 44 px, composer follows the visual viewport, no horizontal scroll, safe-area insets respected on iOS.

---

## License

TBD
