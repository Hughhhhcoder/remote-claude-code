# RCC — Features Tracker

**规则：每次修改代码必须同步更新这个文档。**
- 新增功能 → 加一行，状态填 🟢 done / 🟡 wip / 🔴 planned / ⚪ deferred
- 修改现有功能 → 更新对应行的状态和 Notes
- 移除功能 → 删除或标为 ⚪ deferred + 原因

格式：`| feature | status | since | notes |`

---

## M1 · Local plumbing  🟢 done

| Feature | Status | Since | Notes |
|---|---|---|---|
| Monorepo 骨架 (pnpm workspace) | 🟢 | 2026-05-09 | packages/{protocol,host,web} |
| Protocol 包 (zod frames) | 🟢 | 2026-05-09 | hello / session.* / pty.* / ping / error，序号化 pty.out |
| Host daemon (Node + tsx) | 🟢 | 2026-05-09 | node-pty 包 `claude`，ws 服务 :7777 |
| 会话 Ring buffer 补帧 | 🟢 | 2026-05-09 | 1024 chunk/session，`session.attach{since}` 恢复 |
| Web 前端骨架 (Solid + Vite + Tailwind) | 🟢 | 2026-05-09 | :5273，Vite 代理 `/ws` → 7777 |
| xterm.js 终端视图 | 🟢 | 2026-05-09 | WebGL 未启（可选），ResizeObserver 自动 fit |
| 会话列表 + 切换 + 新建 + 关闭 | 🟢 | 2026-05-09 | 手工输 cwd；默认从环境 RCC_CWD 取 |
| 命令快捷按钮条 | 🟢 | 2026-05-09 | /review /security-review /simplify /clear + Esc/Tab/^C/↑↓/Shift+Tab |
| 断线自动重连 | 🟢 | 2026-05-09 | 指数退避 max 15s，外派 outbox 缓冲 |
| node-pty 安装修复脚本 | 🟢 | 2026-05-09 | scripts/fix-node-pty.mjs 在 postinstall 运行 |
| 权限模式选择（每会话） | 🟢 | 2026-05-09 | default / plan / acceptEdits / bypassPermissions / auto / dontAsk，通过 `claude --permission-mode` 注入；新建会话弹窗 + 会话列表/header chip；RCC_PERMISSION_MODE 可设全局默认 |

## M2 · Public access  🟡 wip

| Feature | Status | Since | Notes |
|---|---|---|---|
| cloudflared 隧道集成 | 🟢 | 2026-05-09 | `RCC_TUNNEL=1` 启用 TryCloudflare（随机 `*.trycloudflare.com`）；URL 通过 `tunnel.status` 帧广播到客户端；UI 顶栏显示可点击复制 |
| Host 静态托管 web 构建产物 | 🟢 | 2026-05-09 | `pnpm -F @rcc/web build` 后，host 自动在 `:7777` 提供 UI，单一公网 URL 同时载 ws 和界面 |
| Host 信任存储 | 🟢 | 2026-05-09 | `~/.rcc/trust.json`（0600 权限），token 仅存 sha256；`fs.watchFile` 监控外部改动并热重载 |
| 配对 HTTP API | 🟢 | 2026-05-09 | `POST /pair/new` 生成 6 位码（TTL 5 分钟）+ claimSecret；`POST /pair/claim` 用 code+secret 换取 device token；host 在终端打印码供用户人眼读取 |
| WebSocket / HTTP 认证 | 🟢 | 2026-05-09 | 非 loopback 连接必须带 `?token=` 或 `Authorization: Bearer`；loopback 默认信任（`RCC_TRUST_LOOPBACK=0` 关闭）；GET `/ws` 也会 401，用于客户端 probe |
| 配对 UI | 🟢 | 2026-05-09 | 客户端 status 变 `unauthorized` 时自动显示配对页；输入码 + 设备名 → token 存 localStorage → 自动重连 |
| 设备管理 UI + CLI | 🟢 | 2026-05-09 | Web 端 `已配对设备` 弹窗（重命名 / 吊销 / 当前设备标记）；`pnpm -F @rcc/host admin devices|revoke|rename` CLI；吊销即时断开活跃连接（close code 4401） |
| 固定子域（命名隧道） | 🔴 | — | 需 CF 账号；写入 `~/.rcc/config.json` |
| Passkey (WebAuthn) | 🔴 | — | 目前用 32 字节随机 token，足以 M2；WebAuthn 延到 M5 |

## M3 · Mobile polish  🔴 planned

| Feature | Status | Since | Notes |
|---|---|---|---|
| PWA 外壳 (manifest + SW) | 🔴 | — | 安装到主屏 |
| 语义化对话视图 | 🔴 | — | tool_use 卡片、diff 折叠、图片内联（替代纯 xterm） |
| 权限审批专用页 | 🔴 | — | 风险分级 + Face ID |
| Web Push | 🔴 | — | VAPID，推权限弹窗到锁屏 |
| 虚拟键盘快捷键条（移动优化版） | 🔴 | — | 贴键盘上方 |
| 语音输入 | 🔴 | — | Web Speech API 优先，失败回退 Whisper API |

## M4 · Multi-device + Config UI  🟡 wip

| Feature | Status | Since | Notes |
|---|---|---|---|
| ConfigView 骨架 (5 tabs) | 🟢 | 2026-05-09 | 侧栏 `⚙ Claude Code 配置` 打开；5 个 tab 占位，各 agent 填充；protocol 和 host switch 已预留 `[config-frames]` / `[config-handlers]` 插入点 |
| Skills 管理 (user + project) | 🟡 | 2026-05-09 | M4A in-flight |
| MCP Servers 管理 | 🟡 | 2026-05-09 | M4B in-flight |
| Slash Commands + Subagents 管理 | 🟡 | 2026-05-09 | M4C in-flight |
| CRDT 多端输入同步 (Yjs) | 🔴 | — | 两端同时输入不冲突 |
| 文件树 + Monaco 预览 | 🔴 | — | 右栏，按 mockup/desktop.html |
| Hooks 管理 UI | 🔴 | — | M4 batch 2 |
| 权限策略 UI | 🔴 | — | allow/deny 规则 |

## M5 · Hardening  🔴 planned

| Feature | Status | Since | Notes |
|---|---|---|---|
| 应用层 E2E 加密 (libsodium) | 🔴 | — | TLS 之内再加一层 |
| 重放防护（nonce + window） | 🔴 | — | |
| 设备吊销 | 🔴 | — | CLI 命令 + Web 管理界面 |
| 崩溃上报 + 自升级 | 🔴 | — | |

---

## 当前可用

- ✅ M1 已全部打通，本地可用：`pnpm dev:host` + `pnpm dev:web` → http://localhost:5273
- 🟡 M2 已可用于真实远程：
  - `RCC_TUNNEL=1 pnpm -F @rcc/web build && pnpm dev:host` 启公网 URL
  - 首次打开显示配对页 → host 终端显示码 → 手机输入码完成配对
  - token 存 localStorage，下次自动登录；loopback 仍免 auth 方便开发
  - 失窃/旧设备：Web 弹窗吊销 或 `pnpm -F @rcc/host admin revoke <id>`
- 🔴 M3/M4/M5 未开始。下一步建议：M4 配置管理 UI（Skills/MCP/Hooks 对应 mockup/config.html），或 M3 PWA + 语义化对话视图。

## 设计参考

- `mockup/index.html` — 视觉原型总览
- `mockup/landing.html` — 产品介绍页
- `mockup/desktop.html` — 桌面应用
- `mockup/mobile.html` — 移动端（4 个 tab）
- `mockup/pairing.html` — 配对流程
- `mockup/config.html` — Skills / MCP / Hooks 管理

## 变更日志

- 2026-05-09  Initial M1 landing. Web 端口 5173 → 5273（避免冲突）。
- 2026-05-09  权限模式选择：新建会话弹窗选 mode，host 自动拼 `claude --permission-mode <m>`；列表 + header 显示彩色 chip。新增 `RCC_PERMISSION_MODE` 环境变量作为全局默认。
- 2026-05-09  M2 启动：cloudflared 集成（`RCC_TUNNEL=1`），host 静态托管 web 构建产物（单一公网 URL），UI 顶栏 tunnel 状态 + 点击复制 URL。
- 2026-05-09  M2 认证：token 信任存储（`~/.rcc/trust.json`）、`POST /pair/new`+`/pair/claim` 配对、ws/HTTP 全路径认证（loopback 默认放行）、Web 端配对页 + 设备管理弹窗、`rcc-admin` CLI（list/revoke/rename）、`fs.watchFile` 监控外部改动自动重载。
- 2026-05-09  M4 骨架：ConfigView 5-tab 壳 + `[config-frames]` / `[config-handlers]` 插入点，3 个并行 agent 分别填充。
