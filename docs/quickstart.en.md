# RCC Quickstart (English)

> 中文版:[quickstart.zh.md](quickstart.zh.md)

Go from zero to "my phone is controlling `claude` on my laptop" in ~5 minutes.

---

## 0 · What you need

| Item | Notes |
|---|---|
| A computer | macOS / Linux with `claude` CLI installed and `claude --version` working |
| Node.js ≥ 20 | Check with `node -v`. Install via `brew install node` or nvm |
| A phone | Any modern browser (Safari / Chrome / Edge) |

> Don't have `claude` yet? Install it first: <https://docs.claude.com/en/docs/claude-code>. RCC is **not** a replacement for `claude` — it's a remote control for it.

---

## 1 · Install RCC

Pick one:

```sh
# A · One-liner (recommended)
curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | sh

# B · From source (developers / if you want to read the code)
git clone https://github.com/Hughhhhcoder/remote-claude-code.git
cd remote-claude-code
pnpm install
```

Verify:

```sh
rcc version      # installer path; prints "rcc 1.0.0 (darwin-arm64)"
# or from source:
pnpm dev:host    # should print "[rcc-host] listening on http://localhost:7777"
```

---

## 1.5 · Self-update (installer paths only)

```sh
rcc update                   # install latest release
rcc update --check           # check without modifying anything
rcc update --version=1.0.0   # force-install a specific version (rollback or reinstall)
```

Downloads the platform-matching tarball from GitHub Releases, verifies sha256, swaps symlinks. Keeps the previous install for rollback (`~/.rcc/install/`).

Source-tree installs update with `git pull && pnpm install`.

---

## 2 · Pick your scenario: local vs public

RCC supports two modes. Most people want **B (public tunnel)**.

### Scenario A · Same Wi-Fi (simplest, most private)

Phone and computer on the same router. No public exposure.

```sh
rcc            # or from source: pnpm dev:host
```

Find your LAN IP:

```sh
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'
```

Say you got `192.168.1.42`. On your phone, open:

```
http://192.168.1.42:7777
```

> Port **7777** is the host default. The source-code dev web is on **5273** with HMR.
> First visit will prompt for a pairing code (step 3).

### Scenario B · Anywhere (across Wi-Fi, 4G, on a train) — Cloudflare tunnel

On your computer:

```sh
RCC_TUNNEL=1 rcc
```

The terminal will print something like:

```
[tunnel] ready: https://purple-mango-1234.trycloudflare.com
```

Open that URL on your phone. **No port forwarding, no public IP, no DDNS** — Cloudflare sets up a temporary tunnel for you.

> The random URL **changes every restart**. For a stable domain, see "Named tunnel" below.

---

## 3 · First-time pairing on the phone

When you open the URL, you'll land on a pairing page with a big input box asking for a **6-digit code**.

In your computer terminal (the one running `rcc`), scroll to find:

```
[pair] code = 483902   (expires in 5 min)
```

Enter `483902` on the phone → tap "Pair" → green check → done.

> The pairing code is **valid for 5 minutes only** and single-use. If it expires, refresh the phone page to get a new one.
> After pairing, your phone gets a per-device token stored in localStorage. Future visits skip the pairing step.

**Install as a PWA (iOS + Android):**

- Safari: Share menu → "Add to Home Screen"
- Chrome: ⋮ menu → "Add to Home Screen"
- RCC also shows a **📲 Install** button in the UI

Once installed, RCC behaves like a native app: fullscreen, icon on home screen, Web Push notifications work even when the tab is closed.

---

## 4 · What to do on the phone

Everything from the desktop UI is available on mobile:

- Left sidebar, tap ➕ to create a session — choose cwd, permission mode, starter kit
- Bottom prompt bar — type and send to `claude`
- Mobile-only niceties:
  - **Voice input** (mic icon) — Web Speech API by default, Whisper via OpenAI if configured
  - **Soft-keyboard toolbar** (sticky above the on-screen keyboard) — Esc / Tab / Ctrl+C / ↑ / ↓ one-tap
  - **Web Push** (asks permission on first visit) — Claude's high-risk approvals hit your lock screen
  - **Dedicated approval view** — big buttons, mis-tap protection

### Typical workflow

1. Morning at your desk: you start a refactor session with Claude, then have to leave.
2. On the subway: open RCC on your phone → find the session in the list → full context is still there.
3. Dictate via voice: "split ErrorBoundary into its own module, then run the tests."
4. Home in the evening: back at the desktop — the new messages from your phone are already there.

---

## 5 · Security essentials (read this)

RCC is **secure by default**, but before exposing it publicly:

- **The pairing code is your only root of trust.** Never screenshot / screen-share it to strangers — anyone with it gets full access within those 5 minutes.
- **E2E encryption** is on by default. Traffic between phone and host uses X25519 + libsodium secretbox. Cloudflare sees only ciphertext.
- **Device management:** `~/.rcc/trust.json` lists paired devices. Run `rcc-admin devices` to view / revoke. Lose your phone? Revoke immediately.
- **Permission modes:** default is `default` (asks before each sensitive action). The mobile approval view makes this one-tap. Don't use `bypassPermissions` as your daily mode — it lets Claude run anything without asking.
- **Passkey gating for high-risk:** in ConfigView → Permissions, enable "require passkey for high-risk". Important approvals will then prompt Touch ID / Face ID.

Full threat model: [docs/threat-model.md](threat-model.md).

---

## 6 · Named tunnel (stable public domain, optional)

Random `RCC_TUNNEL=1` URLs break PWA install. For a stable domain:

1. Create a Named Tunnel in Cloudflare dashboard. Save the `tunnel-id` and credentials JSON.
2. `~/.rcc/config.json`:
   ```json
   {
     "tunnel": {
       "mode": "named",
       "name": "rcc-home",
       "credentialsFile": "/Users/you/.cloudflared/abc-def.json",
       "hostname": "rcc.yourdomain.com"
     }
   }
   ```
3. Start:
   ```sh
   RCC_TUNNEL=named rcc
   ```

Now `https://rcc.yourdomain.com` always points to your machine (as long as `rcc` is running).

---

## 7 · FAQ

**Q. Phone shows "connecting..." forever.**
A. Host isn't running, firewall is blocking, or the tunnel URL expired. On the computer, check `curl http://localhost:7777/api/v1/health` returns `{"ok":true,...}`.

**Q. I typed the pairing code but it says invalid.**
A. 5-minute TTL expired. Wait for the next code in the terminal, or restart `rcc` to force a new one.

**Q. `claude` output on the phone looks garbled.**
A. The ANSI stripper occasionally misses edge terminal sequences. Toggle to "terminal view" (top-right) for native xterm rendering.

**Q. If my computer sleeps, do sessions persist?**
A. Sessions live on the host. When the host dies, sessions go with it. On the next `rcc` start, sessions are restored from snapshots in `~/.rcc/sessions/` — your phone reconnects automatically.

**Q. What if I connect the same session from multiple devices?**
A. Supported. All devices see the same stream in real time; input from any device is applied (CRDT sync).

**Q. Is the tunnel / public URL safe?**
A. Cloudflare can't read the content (E2E encryption); the tunnel itself is Cloudflare-encrypted. The weakest link is still **pairing code disclosure**.

---

## 8 · Next steps

- [Architecture overview](architecture.md) — data flow / storage / module responsibilities
- [CLI client](../packages/cli/README.md) — scripting with `@rcc/cli`
- [Plugin authoring](plugin-authoring.md) — build a "Hello World" plugin in 5 minutes
- [Operations guide](operations.md) — deployment, backups, troubleshooting
- [Threat model](threat-model.md) — attack surface and mitigations
