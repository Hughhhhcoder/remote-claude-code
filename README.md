# rcc — Remote Claude Code

Control your local `claude` CLI from a web UI. M1 milestone: local-only.

## Status

- ✅ M1 — Local plumbing: pty + WebSocket + Web terminal
- ✅ M2 — Public access: cloudflared tunnel + device pairing + token auth
- ⬜ M3 — Mobile polish: semantic rendering, push, voice
- ⬜ M4 — Multi-device sync, file browser, config UI
- ⬜ M5 — E2E crypto, WebAuthn upgrade

See `FEATURES.md` for the full feature tracker.
See `mockup/` for the visual design (`open mockup/index.html`).

## Packages

```
packages/
├── protocol/   zod schema for every WS frame (shared)
├── host/       daemon: wraps claude in node-pty, serves WebSocket on :7777
└── web/        SolidJS + Tailwind + xterm.js client on :5173
```

## Run

```bash
pnpm install

# shell 1 — host daemon (spawns `claude` in a pty)
RCC_CWD=/path/to/your/project pnpm dev:host

# shell 2 — web frontend
pnpm dev:web

# then open http://localhost:5273
```

The Vite dev server proxies `/ws` to the host on 7777, so the browser
only needs one origin.

### env

| var | default | purpose |
|---|---|---|
| `RCC_PORT` | 7777 | host WebSocket / HTTP port |
| `RCC_CWD` | process.cwd() | default cwd for new sessions |
| `RCC_CLAUDE_CMD` | `claude` | command to spawn |
| `RCC_CLAUDE_ARGS` | `""` | extra args, space-separated |
| `RCC_PERMISSION_MODE` | `default` | default `--permission-mode` for new sessions (default/plan/acceptEdits/bypassPermissions/auto/dontAsk) |
| `RCC_TUNNEL` | unset | `1`/`try` to start a TryCloudflare tunnel (random URL), `named` to use a pre-configured named tunnel from `~/.rcc/config.json` |
| `RCC_TRUST_LOOPBACK` | `1` | `0` to also require auth on localhost connections |

Example to smoke-test without claude:
```bash
RCC_CLAUDE_CMD=bash RCC_CLAUDE_ARGS="-l" RCC_CWD=/tmp pnpm dev:host
```

## Public access (M2)

```bash
# 1. build the web bundle so host can serve it
pnpm -F @rcc/web build

# 2. run host with the tunnel on
RCC_TUNNEL=1 RCC_CWD=/your/project pnpm dev:host
# cloudflared prints a random https://*.trycloudflare.com URL that serves
# both the UI and the websocket.
```

### First-time pairing

1. Open the public URL on your phone/laptop. It will show a pairing screen.
2. Tap **"请求配对码"** — the host terminal (on your Mac) prints a 6-digit code.
3. Type that code back into the web UI + name the device. You're in.
4. The token lives in `localStorage` on that device; next visit logs in automatically.

Loopback (`127.0.0.1`) is trusted without a token by default — set
`RCC_TRUST_LOOPBACK=0` to require auth everywhere.

### Device management

- In the UI: sidebar footer → **已配对设备** → rename / revoke.
- CLI (works whether host is running or not):
  ```bash
  pnpm -F @rcc/host admin devices
  pnpm -F @rcc/host admin revoke <device-id>
  pnpm -F @rcc/host admin rename <device-id> <new-name>
  ```
  Running host auto-detects changes to `~/.rcc/trust.json` and kicks
  revoked devices immediately.

Caveat: TryCloudflare URLs are random and short-lived. For a stable
`rcc-you.yourdomain.com` use a named cloudflared tunnel — see below.

## 公网访问（命名隧道 - 推荐生产）

随机 `*.trycloudflare.com` 每次重启都变,不适合 PWA 安装和长期书签。
配一次命名隧道,永久绑定到你自己的域名。

1. 安装 cloudflared: `brew install cloudflared`
2. 登录: `cloudflared tunnel login`（浏览器授权，写 `~/.cloudflared/cert.pem`）
3. 创建隧道: `cloudflared tunnel create my-rcc`（得到 uuid + `~/.cloudflared/<uuid>.json`）
4. 绑定域名: `cloudflared tunnel route dns my-rcc rcc.example.com`
5. 编辑 `~/.rcc/config.json`（不存在就新建）:
   ```json
   {
     "tunnel": {
       "mode": "named",
       "name": "my-rcc",
       "hostname": "rcc.example.com",
       "credentialsFile": "~/.cloudflared/<uuid>.json"
     }
   }
   ```
6. 启动:
   ```bash
   pnpm -F @rcc/web build
   RCC_TUNNEL=named pnpm dev:host
   ```

启动后隧道固定指向 `https://rcc.example.com`,重启不变。

`RCC_TUNNEL` 环境变量优先级高于 config；设 `RCC_TUNNEL=try` 可临时切回随机隧道，`RCC_TUNNEL=off` 完全关闭。
命名隧道若缺 credentials / cert.pem 会在日志打印友好错误并自动回退到 TryCloudflare，不会 crash。

## Protocol

Every frame is a JSON object with a discriminator `t`. See
`packages/protocol/src/index.ts` for the full zod schema. Key frames:

- `hello` — server → client on connect, carries session list
- `session.new` / `session.attach` / `session.close` — lifecycle
- `pty.in` — client keystroke → host → pty
- `pty.out` — pty → host → client, with monotonic `seq` per session
- `pty.resize` — client terminal geometry change

Reconnects are handled by the client: it remembers last-seen `seq` per sid
and asks for replay from `since` on reattach. Host keeps a 1024-chunk
ring buffer per session.

## Known issues

- **node-pty `spawn-helper` permissions**: on some pnpm setups the prebuild
  ships without +x. `scripts/fix-node-pty.mjs` runs in `postinstall` to fix.
- **Bun + node-pty**: Bun spawns pty successfully but can't read the fd
  (ENXIO). Host runs under Node via `tsx` until Bun fixes or we write our
  own pty layer.

## Next

M2 will add:
- cloudflared integration (auto-spawn a tunnel on first run)
- QR + 6-digit pairing (see `mockup/pairing.html`)
- Per-device Passkey + application-layer session key
