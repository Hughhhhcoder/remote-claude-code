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
| 固定子域（命名隧道） | 🟢 | 2026-05-09 | `~/.rcc/config.json` 读 `tunnel.{mode,name,hostname,credentialsFile}`；`RCC_TUNNEL=named` 启用；复用 `cloudflared tunnel run`；UI TunnelBadge 区分 try/named（🔒 前缀 + tooltip） |
| Passkey (WebAuthn) | 🟢 | 2026-05-09 | @simplewebauthn 服务端+浏览器端;per-device passkey 注册(DevicesModal 升级按钮)存 trust.json;高风险审批走 WebAuthn assertion(Touch ID/Face ID),assert 验证后 server gate 开放 approval.response;token 认证仍是主通路,passkey 是叠加的二次确认 |

## M3 · Mobile polish  🔴 planned

| Feature | Status | Since | Notes |
|---|---|---|---|
| PWA 外壳 (manifest + SW) | 🟢 | 2026-05-09 | manifest + 手写 SW（static cache-first，HTML network-first，排除 ws/pair/health/tunnel）+ 📲 安装按钮（iOS Safari 提示手动 Share → Add to Home Screen） |
| 语义化对话视图 | 🟢 | 2026-05-09 | host ChatParser 启发式 ANSI 剥离 + 段落分类 (text/code/diff/tool_use),per-session 100 条消息滚动窗口;前端 ChatView 气泡 + 可折叠 tool_use + 红绿 diff;session header 🔀 终端/对话切换(移动默认对话);图片内联保留;M6 追加 SDK driver 走真实结构化流,启发式作为 CLI driver fallback |
| 权限审批专用页 | 🟢 | 2026-05-09 | host ApprovalWatcher 启发式扫描 pty.out 中 Claude 的 y/n 提示，按工具名分 low/medium/high 三档，广播 approval.request 帧;web 端专用审批卡片（移动底部 / 桌面 modal）;高风险按钮 500ms 防误触。Face ID/Touch ID 留待 M5 WebAuthn |
| Web Push | 🟢 | 2026-05-09 | web-push + VAPID 自动生成到 ~/.rcc/config.json;push-subs.json 订阅存储;SW push event → showNotification;高风险审批 + session.exited 触发推送;🔔 通知按钮一键开关 |
| 虚拟键盘快捷键条（移动优化版） | 🟢 | 2026-05-09 | 移动端 sticky 底部键条,pinned commands + Esc/Tab/方向键/^C/Enter/斜杠,visualViewport 跟随键盘,safe-area-inset 适配刘海屏 |
| 语音输入 | 🟢 | 2026-05-09 | Web Speech API 实时 partial,不支持时 MediaRecorder 录 webm 传 host /whisper 代理到 OpenAI(需 ~/.rcc/config.json whisper.apiKey);🎙 录音中红色脉冲 |

## M4 · Multi-device + Config UI  🟡 wip

| Feature | Status | Since | Notes |
|---|---|---|---|
| ConfigView 骨架 (5 tabs) | 🟢 | 2026-05-09 | 侧栏 `⚙ Claude Code 配置` 打开；5 个 tab 占位，各 agent 填充；protocol 和 host switch 已预留 `[config-frames]` / `[config-handlers]` 插入点 |
| Skills 管理 (user + project) | 🟢 | 2026-05-09 | 读取 `~/.claude/skills` 和 `<cwd>/.claude/skills`，卡片 grid + 启用/禁用 toggle（目录前缀 `_disabled_` 持久化）、⚙查看 SKILL.md、▶试运行（往活跃会话写 `请使用 skill: <name>`）、🗑删除、+ 新建（写到选定 scope）。Marketplace 入口占位。 |
| MCP Servers 管理 | 🟢 | 2026-05-09 | `claude mcp list/add/remove/get` 包装（execFile，无 shell）；protocol 帧 `mcp.list/get/add/added/remove/removed/toggle`；Web 端表格 + 展开详情 + 启用/禁用开关 + 添加弹窗（stdio/http/sse + env/headers）；env 中 KEY/TOKEN/SECRET/PASSWORD/AUTH 在传输前打码为 `***` 并只暴露长度；claude CLI 无原生 disable，实现为 "snapshot 到 `~/.rcc/mcp-disabled.json` + claude mcp remove"，enable 时重新 add |
| Slash Commands + Subagents 管理 | 🟢 | 2026-05-09 | commands/.md 读写 + pinned 存 ~/.rcc/pinned-commands.json；subagents/.md frontmatter 解析 (name/description/model/tools)；新建/编辑/删除 modal；pinned 实时广播到 desktop 快捷按钮条 |
| CRDT 多端输入同步 (Yjs) | 🟢 | 2026-05-09 | Yjs Y.Text 同步 input draft(docId "input-draft")跨设备;host 做无 yjs 依赖的 update buffer relay(每 doc 上限 200 条);发送后 setValue("") 同步清空 |
| 文件树 + Monaco 预览 | 🟢 | 2026-05-09 | 右栏可 toggle,fs.ls/read 后端 + Monaco 只读预览,512KB 截断,二进制检测转 base64 |
| Hooks 管理 UI | 🟢 | 2026-05-09 | ~/.claude/settings.json + <cwd>/.claude/settings.json 的 hooks 段读写，9 种事件支持 matcher+command 列表，🧪 测试按钮 execFile sh -c 跑命令 |
| 权限策略 UI | 🟢 | 2026-05-09 | user/project/local 三 scope，allow/deny/ask 三 bucket 规则读写；defaultMode 和 additionalDirectories 可视化 |
| 多项目工作区 | 🟢 | 2026-05-09 | ~/.rcc/config.json projects 段读写;session 绑 projectId;sidebar 按项目分组;ProjectsModal CRUD(默认项目不可删);NewSessionModal 项目下拉 |
| Skills + MCP Marketplace | 🟢 | 2026-05-09 | manifest-driven catalog(~/.rcc/config.json marketplace.manifestUrls + 内置 seed);1h cache 合并去重;Skills 一键写 SKILL.md 到 user/project scope;MCPs 一键 claude mcp add 填 env 表单;搜索过滤 |

## M5 · Hardening  🔴 planned

| Feature | Status | Since | Notes |
|---|---|---|---|
| 应用层 E2E 加密 (libsodium) | 🟢 | 2026-05-09 | libsodium-wrappers X25519 ECDH(配对时协商,host 长期 keypair 在 ~/.rcc/keys.json)+ per-device sharedKey 存 trust.json;所有 ws 帧 secretbox_easy 加密(nonce 24B 随机)外包 {e2e:1,n,c};loopback 兼容明文;已配对未升级 key 的老设备走旧明文通路 |
| 重放防护（nonce + window） | 🟢 | 2026-05-09 | envelope 加 seq+ts;host/client 各自 64-bit sliding window 拒重放;±60s 时间戳倾斜保护;decrypt 失败或 replay 检测到关闭 code 4402;仅加密连接启用 |
| 设备吊销 | 🔴 | — | CLI 命令 + Web 管理界面 |
| 崩溃上报 + 自升级 | 🟢 | 2026-05-09 | host 捕获 uncaughtException/unhandledRejection 写 ~/.rcc/crashes.log JSONL(1MB rotate)+ 广播 health.crash;GET /version + /version/check 通过用户配的 manifestUrl 查 GitHub releases(10 分钟缓存);Web 顶栏 VersionBadge 有更新时橙点 + popover 显示 release notes + 复制 git pull 命令 |

## M6 · Depth  🟡 wip

| Feature | Status | Since | Notes |
|---|---|---|---|
| Claude Agent SDK 结构化流 | 🟢 | 2026-05-09 | SdkSession 通过 @anthropic-ai/claude-agent-sdk.query() 消费 text_delta / tool_use / tool_result / thinking 事件;真实结构化 segments;新建会话选 driver: CLI/SDK;需 ANTHROPIC_API_KEY 或 ~/.rcc/config.json anthropic.apiKey;SDK 会话无 pty,UI 强制对话视图 |
| 主题 / 键位自定义 | 🟢 | 2026-05-09 | ~/.rcc/ui-prefs.json accent 色(orange/cyan/violet/pink/emerald)+ fontScale(0.8-1.4)+ customKeys 用户可编辑;prefs 帧广播多端同步;SettingsModal 🎨 配置入口 |
| 观测面板 | 🟢 | 2026-05-09 | host MetricsCollector 1min rolling(1s 分辨率);process RSS/CPU + sessions + ws 字节速率 + replay/decrypt/auth 计数器;GET /metrics + metrics.subscribe/tick 推送;Web 📊 popover inline SVG sparkline |
| 会话持久化跨重启 | 🟢 | 2026-05-09 | ~/.rcc/sessions/<sid>.json 存 meta+chat+ringTail;debounced 500ms save;host 重启恢复 exited session 可重开延续 id;session.resume 用存档 meta 重开 pty/SDK;30 天自动清理 + admin sessions --purge |
| Git 集成 | 🟢 | 2026-05-09 | session cwd 每 5s poll branch+dirty+HEAD;变更广播 git.status;新 commit 产生系统 chat "✓ N commits";前端 branch chip 在 SessionRow + session header;git.exec 帧跑只读 git 命令(status/diff/log/branch/blame/show),结果 30KB cap 塞 chat;builtin /git:* pinned 默认可用 |
| 会话只读分享 | 🟢 | 2026-05-09 | POST /share/new 生成 TTL 可选的 token;~/.rcc/shares.json 存 sha256;访客 URL ?share=<token> 跳 pair 直连 ws,readonly=true 只收该 sid 的 chat/pty frames,所有 mutation 拒绝;ShareModal 生成+撤销;过期/撤销 close 4410 |
| 全局命令 palette (Cmd+K) | 🟢 | 2026-05-09 | Cmd+K/Ctrl+K 唤起,fuzzy match sessions/skills/commands/subagents/actions/git,前缀 > : @ # 过滤分类;一次性拉取 + 60s 缓存;Enter 执行 / Esc 关闭;暗色居中 modal |
| 会话录屏 + 回放 | 🟢 | 2026-05-09 | session.record 开关 → host/recording.ts 写 asciinema v2 到 ~/.rcc/recordings/<sid>.cast(header + JSONL [t,"o",data]),50MB 自动停;GET /recording/:sid.cast authenticated 下载;Web RecordingPanel 头部 ⏺/⏹ + 实时大小,自写轻量 xterm 回放器 0.5/1/2/4x 速度 |
| Inbox 活动流 | 🟢 | 2026-05-09 | host ActivityFeed 200 条 rolling,钩 approvals/crash/git.commits/version.check/session.exited 自动 append;activity.list/append 帧广播;Web 📥 Inbox 抽屉(分类过滤 + 未读 badge + 点击跳回源 sid) |

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
- 2026-05-09  M4 batch 1：Skills / MCP Servers / Slash Commands / Subagents 四大管理 tab 全部落地。Skills 通过 `_disabled_` 目录前缀禁用；MCP 通过 `~/.rcc/mcp-disabled.json` 快照实现禁用（claude CLI 无原生 disable）；pinned slash commands 持久化到 `~/.rcc/pinned-commands.json` 并实时推送到桌面快捷按钮条；subagents 解析 frontmatter (name/description/model/tools)。Hooks + 权限策略 UI 留待 batch 2。
- 2026-05-09  M4 batch 2 · Permissions UI：`~/.claude/settings.json` + `<cwd>/.claude/settings.json` + `<cwd>/.claude/settings.local.json` 三 scope allow/deny/ask 规则读写，defaultMode（user/project）和 additionalDirectories 可视化编辑，所有变更广播 `perm.list` 到全部客户端。
- 2026-05-09  M4 batch 2 · 文件浏览器：桌面右栏可 toggle（240px / 1fr / 360px）；host 端 `fs.ls` / `fs.read` / `fs.stat` 受限在 `<cwd>` 和 `~` 子树（realpath 比对防 symlink 越狱）；Monaco 只读预览 12 种语言，512KB 截断，NUL 嗅探二进制转 base64。
- 2026-05-09  M4 batch 2 · Hooks UI：`~/.claude/settings.json` 和 `<cwd>/.claude/settings.json` 的 `hooks` 段读写（9 种事件 × matcher+command 列表），新建/编辑/删除/🧪测试按钮（`execFile sh -c`，stdout/stderr 32KB 截断），`hook.list` 广播到所有客户端。
- 2026-05-09  M3 batch 1 · MobileKeyBar: 移动端（≤767px）底部固定快捷键条,两行布局（pinned commands + Esc/Tab/↑↓/Enter/slash/^C/Shift+Tab）,visualViewport 跟随软键盘,safe-area-inset-bottom 适配,桌面 command bar 在移动端隐藏。
- 2026-05-09  M3 batch 1 · 审批页: host ApprovalWatcher 启发式扫描 pty.out 捕获 Claude y/n 提示,按工具名三档分级(low/medium/high),新增 approval.{request,response,cleared} 帧,web 端底部滑出卡片(mobile)/居中 modal(desktop),高风险 500ms 防误触,30s 超时自动清除。
- 2026-05-09  M3 batch 1 · PWA: manifest.webmanifest + 手写 sw.js（static cache-first，HTML network-first + offline shell，严格排除 /ws、/pair/*、/health、/tunnel 实时路径），gen-icons.mjs 纯 Node 生成 192/512/maskable PNG，顶栏 📲 安装按钮（beforeinstallprompt 捕获 → prompt；iOS Safari 展开 Share → Add to Home Screen 提示）。
- 2026-05-09  M3 batch 2 · 命名隧道: 新增 `~/.rcc/config.json` (`loadConfig`/`resolveTunnelConfig`) 读 `tunnel.{mode,name,hostname,credentialsFile}`；`RCC_TUNNEL=named` 启用；`NamedCloudflaredTunnel` spawn `cloudflared tunnel --credentials-file ... --url http://localhost:<port> run <name>`,缺 credentials/cert.pem 打印友好 error 并回退到 TryCloudflare；protocol `TunnelInfo` 加 `mode/hostname/name`；UI TunnelBadge 在 named 模式显示 🔒 前缀与命名隧道 tooltip。
- 2026-05-09  M3 batch 2 · Push: VAPID 首次启动生成存 `~/.rcc/config.json` (0600);`~/.rcc/push-subs.json` 订阅持久化;protocol `[push]` 六帧 (public-key(.request) / subscribe(d) / unsubscribe(d) / test);host 在 approvals 广播 + session.exited 时 push.broadcast("all",...) (仅高风险审批),device.revoke 同步清理订阅;sw.js 追加 push + notificationclick;App 顶栏 🔔 PushPrompt 一键开启/测试/关闭。
- 2026-05-09  M3 batch 2 · 语义化对话: host ChatParser 启发式解析 pty.out (ANSI 剥离 + `\n\n` 段落切分 + text/code/diff/tool_use 分类),每会话滚动 100 条;protocol `[messages]` 四帧 (chat.list(.request) / chat.append / chat.reset);前端 ChatView 气泡 + 可折叠 tool_use + 红绿 diff,session header 切换终端↔对话(移动默认对话);user 消息前端本地构造,assistant 靠启发式推断,结构化流留 M5。
- 2026-05-09  M4 batch 3 · CRDT: Yjs Y.Text 同步 input draft 跨设备;新增 `[crdt]` 三帧 (crdt.update / crdt.sync / crdt.sync.request);host 不装 yjs,仅做 sid-scoped byte relay + 每 doc 200 条 update 环形 buffer 供新连接回放;单 update 硬上限 64KB;ChatView textarea 绑 Y.Text,发送后 setValue("") 双端同步清空。
- 2026-05-09  M3 batch 3 · 语音输入: Web Speech API 优先(实时 partial 填入 textarea),不支持/出错回退 MediaRecorder 录 webm/opus → host `POST /whisper` 多部件代理到 OpenAI Whisper(读 ~/.rcc/config.json whisper.{apiKey,model,endpoint},未配置返 501,>10MB 返 413);ChatView 🎙 按钮录音中红色脉冲,权限/配置错误下方短提示;host /whisper 复用 authenticate 拦截非 loopback 必须带 token,不新增 protocol 帧。
- 2026-05-09  M5 batch 1 · E2E 加密: libsodium-wrappers X25519 ECDH 配对协商 per-device sharedKey,host 长期 keypair 在 `~/.rcc/keys.json` (0600),ws 帧 secretbox_easy 加密后外包 `{e2e:1,n,c}` JSON,loopback/未升级设备仍走明文并打 warning。
- 2026-05-09  M5 batch 2 · 重放防护: E2E envelope 扩 `s`(uint32 seq)+`ts`(Date.now ms),host 和 web 各自维护 per-connection 64-slot 滑动窗 + 单调 outbound 计数器,±60s 时间戳倾斜保护,host 拒绝时 close(4402),web 相应重连重置双端序号流。
- 2026-05-09  M5 batch 2 · 崩溃+自升级: host 安装 uncaughtException/unhandledRejection 钩子写 ~/.rcc/crashes.log JSONL(1MB 自动 rotate 到 .1)+ 广播 health.crash 帧;新增 GET /version 和 GET /version/check(读 ~/.rcc/config.json update.manifestUrl,fetch GitHub releases JSON,semver 比对,10 分钟缓存);Web 顶栏 VersionBadge 显示 v<ver>,有更新变橙 + 圆点 + popover 内 release notes 和复制 git pull 命令,health.crash 帧触发右下 toast。
- 2026-05-09  M5 batch 2 · Passkey: @simplewebauthn 服务端+浏览器端落地;trust.json PairedDevice 加可选 `passkey{credId,publicKey,counter,registeredAt}`;`POST /webauthn/{register,assert}/{begin,complete}` 四端点(Host 头派生 rpId,localhost 友好,挑战 5 分钟 TTL 内存 Map);高风险审批触发时 ApprovalWatcher 回调 gate,仅当至少一个连接设备有 passkey 才 require,`approval.response` 携 webauthnToken 被 server-side gate 校验通过才写 y\r 到 pty;DevicesModal 顶部横幅升级/移除按钮,PermissionApproval 高风险+passkey 时按钮改为 🔐 Touch ID/Face ID 确认(调 navigator.credentials.get);hello.device 加 hasPasskey 供前端分支。
- 2026-05-09  M4 batch 3 · 多项目: ProjectStore 读写 ~/.rcc/config.json `projects` 段(保留其他键),启动无 projects 时用 RCC_CWD||cwd 自动建 default(isDefault=true,不可删);protocol 新增 `[projects]` 11 frame(list(.request)/add(ed)/remove(d)/rename(d)/update(d))+ProjectMeta+PROJECT_COLORS(橙青紫粉绿)+SessionMeta.projectId+SessionNew.projectId;host session.new 按 projectId→cwd→default 三段解析项目绑定,所有 project mutation 广播 project.list 全客户端;hello 加 projects;Web App.tsx sidebar 改两级项目+sessions,createMemo 分组(无 projectId 归 default),每项目 header 可折叠+hover 出现 + 按钮新建该项目 session,顶部 + 新建项目;NewProjectModal(name/cwd/颜色)+ ProjectsModal(列表/inline 编辑/删除/默认不可删);NewSessionModal 加项目下拉,留空 cwd 用项目 cwd;Session.projectId 字段 session.meta() 带出。
- 2026-05-09  M4 batch 3 · Marketplace: manifest-driven skills+mcp 目录(~/.rcc/config.json marketplace.manifestUrls 只接 https,10s 超时,512KB 上限,无 url 时走内置 seed),host/marketplace.ts 并发拉取+1h 缓存+按 id 去重;seed 含 3 条 rcc skills(test-writer/commit-message/todo-sweep)和 4 条真实 MCP(filesystem/github/memory/fetch,全 npx 启动);安装复用 skills.writeSkill 和 mcp.addMcp,MCP 仅允许 npx/uvx/node/python 白名单,从不下载二进制;protocol 加 market.{catalog.request,catalog,install.skill,skill.installed,install.mcp,mcp.installed};Web MarketplaceView 全屏 modal 双 tab+搜索+scope+env 表单+source 错误折叠展示,入口位于 SkillsTab 按钮+sidebar footer+tab 内大块卡片。
- 2026-05-09  M6 · SDK driver: 新增 SdkSession 与 CLI Session 并列,通过 @anthropic-ai/claude-agent-sdk@0.2.138 query() 消费 SDKMessage 流,text_delta / tool_use / tool_result / thinking 真实结构化事件映射成 ChatSegment;Protocol 加 SessionDriver 枚举 + SessionMeta.driver + session.new.driver,新 segment kind thinking/tool_result,ChatMessage.streaming,新帧 chat.update(messageId,segmentIndex,segment);host/session.ts 抽 AnySession union + createSession 工厂,SessionRegistry 持 AnySession,approval watcher 仅 instanceof Session 时挂;API key 从 ANTHROPIC_API_KEY 或 ~/.rcc/config.json anthropic.apiKey 取,缺失时 start() 抛错并系统消息通知;Web NewSessionModal 加 CLI/SDK radio 选择(默认 CLI),SessionRow/header 加 DriverChip,SDK 会话强制 ChatView 且终端切换禁用;ChatView 消费 chat.update 做增量更新,新增 ThinkingBlock(灰色斜体可折叠)+ ToolResultBlock(绿/红按 isError),streaming 光标 ▍。
- 2026-05-09  主题/键位自定义: protocol 加 `[ui-prefs]` UiPrefs(accent/fontScale/customKeys/theme) + prefs/prefs.request/prefs.update/prefs.updated 四帧;host/prefs.ts PrefsStore 读写 ~/.rcc/ui-prefs.json(0600),mutation 广播 prefs 全客户端+hello 后单独推一次;tailwind.config 加 accent 300/400/500/600 系列读 `rgb(var(--accent-N) / <alpha-value>)` CSS 变量,index.css 默认 orange 值;Web prefs.ts createPrefsStore 订 prefs 帧+localStorage 镜像+applyPrefs 设 CSS 变量/html font-size/data-theme;SettingsModal 🎨 顶栏入口(圆形色板+0.8-1.4 滑杆+键位 CRUD,send 支持 \x1b/\r/\t/\\ 转义显示+输入),MobileKeyBar/App 硬编码 Esc/Tab/↑↓/^C/⇧Tab 改读 prefs.customKeys;主按钮(New session / pinned project active / file browser toggle / 🎨 hover)和 MobileKey active 态从 orange-* 切 accent-*,保留品牌 R logo/tunnel/pairing 的原 orange-rose 渐变。
- 2026-05-09  观测面板: host/metrics.ts MetricsCollector 单例(1 分钟 rolling + 1s 分辨率 Series/Gauge 环形 buf),sample() 每秒差分算 process CPU% + rotate 所有 series;钩入 send/broadcast/ws message(字节+消息速率)/pty.in+session.subscribe(pty 字节)/chat.onMessage(msgs/s)/authenticate(auth.fails)/replay+decrypt 失败分支/crash broadcast(crashes);新增 GET /metrics(authenticated JSON)+ protocol metrics.subscribe/unsubscribe/tick 三帧 + MetricsSnapshot schema;host 2s 轮询,只在至少一个 ws 订阅时 broadcast(wsStates WeakMap 查订阅位);Web MetricsPanel.tsx 顶栏 📊 按钮 popover,inline SVG sparkline(RSS/CPU + ws in/out)+ sessions 条形 + 计数器红色高亮,open/close 发 subscribe/unsubscribe,onCleanup 取消。
- 2026-05-09  会话持久化跨重启: 新增 host/persistence.ts,每 session 写 ~/.rcc/sessions/<sid>.json (0600 + 原子 tmp→rename),存 meta (含 lastActiveAt/status) + chat 最近 100 条 + ringTail 尾 32KB;单文件硬上限 1MB,超则先砍一半 chat 再 fallback 丢 ringTail;Debouncer 类 500ms collapse 写入,chat.onMessage/onUpdate/pty.out subscribe/session.exit 全挂钩,session.new 和 session.resume 立即 flush,session.close 删文件.新增 DeadSession 类(实现 AnySession 结构子集,replay 返 ringTail 作 seq=0 一次性 chunk,write/resize 为 no-op),host 启动 purgeStale 清 30d+ 后 loadAllSnapshots 全量恢复到 registry 标 exited;只有注册表空时才 spawn 默认 bootstrap session 避免复活后还再冒一个.Protocol 加 session.resume/session.resumed 帧,host 收到 session.resume 时 createSession 复用原 id/cwd/permissionMode/projectId/driver,initialChat 续接,SDK driver 自动 start();前端 client.resumeSession,App.tsx 处理 session.resumed 和 onResumeSession(乐观切 status),SessionRow 存档态多显 💾 存档 chip + hover 出现 "重开" 绿按钮.新增 rcc-admin sessions [--purge|--stale] CLI.SIGINT 前 flush 全部 debouncer.
- 2026-05-09  Git 集成: 新增 host/git.ts(execFile git, 2s timeout, 30KB stdout/stderr cap)+ host/git-watcher.ts(per-session 5s poll branch+dirty+ahead/behind+HEAD, 仅非 git dir 返 null 时静默);protocol 加 GitStatusData/GitCommitInfo + 五帧 git.status(.request)/git.commits/git.exec(.request/.result);host attachGitWatcher 钩进 boot/new/resume 三路径,HEAD 变时 broadcast git.commits 并往 session.chat append "✓ N commits during this session" 系统消息;git.exec.request 仅 whitelist 只读子命令 status/diff/log/branch/blame/show/... 写操作一律拒;Web 新增 BranchChip(branch 名 + 脏黄点 + ↑↓ ahead/behind),挂在 SessionRow 和 session header;sendCommand 拦截 /git:sub 走 git.exec.request 不过 pty;commands.ts builtin 列表加 git:status|diff|log|branch 四条默认可 pin;MobileKeyBar 同样识别 git:* 前缀走 git.exec。
- 2026-05-09  会话只读分享: 新增 host/shares.ts ShareStore 读写 ~/.rcc/shares.json(0600,sha256 存 token,fs.watchFile 热重载,启动 purge);POST /share/new 传 {sid,ttlMinutes} 返 {id,token,url,expiresAt};GET /share/list?sid=;DELETE /share/:id;所有接口 authenticate() 守门。upgrade 握手检测 ?share=<token>,verify 成功则标 rccShare={id,sid,expiresAt},跳 E2E 走明文(TLS 外层已加密传输,share 使用场景下 E2E 额外收益有限且访客没有 sharedKey)。 每条 broadcast 走 broadcastFiltered 按 isFrameAllowedForShare 白名单(hello/chat.*/pty.out/session.exited/pong/error 仅该 sid)过滤;handle() 对 readonly 连接只放行 ping/session.attach(pinned sid)/chat.list.request,其他 mutation 静默忽略。hello 帧含 sharedReadonly/sharedSid/sharedExpiresAt,web 端 RccClient 新增 shareToken 选项走 ?share= + 禁 E2E + send() 白名单拦截;新状态 "readonly",close 4410 时 setStatus("unauthorized") 不重连;新 SharedReadonlyView 独立顶栏(只读 chip + 过期倒计时)+ 只能切终端/对话,无审批/输入/MobileKeyBar;App.tsx 检测 ?share= 早分支直接 render SharedReadonlyView。ShareModal TTL 四档(10m/1h/8h/24h)+ 生成链接 + 复制按钮 + 已有分享列表撤销;SessionRow 🔗 hover 按钮唤起。share 撤销或过期时 host 扫描 + file watch 双路径立即 close(4410,share_expired/revoked)。Protocol 加 ShareSummary/ShareListRequest/ShareList 两帧,share.list 走 broadcastFiltered 对 share 客户端天然过滤。
- 2026-05-09  AI 摘要 + 搜索: host/summary.ts 调 Anthropic Messages API (claude-haiku-4-5) 生成 title + 3-5 bullets,无 apiKey 启发式 fallback(第一条 user msg 前 60 字作 title);host/search.ts SearchIndex 内存倒排索引(token → Set<sid> + per-sid body,AND 匹配 + hit-count 排序,excerpts 200 字),host 启动从 snapshots 重建;chat.onMessage 增量 update(sessionSummaries/chatBySid Map 镜像);session.exit 自动 generateAndBroadcastSummary 写回 snapshot 且广播 summary 帧 + session.list;protocol 加 SessionMeta.summary 可选 + summary.request/summary.refresh/summary + search.request/search.result 五帧;Web App.tsx sidebar 顶部搜索框(输入 200ms 节流发 search.request,空串清结果),结果卡片显示 title+sid+excerpts 可点击跳转;SessionRow 标题改用 summary.title fallback session.title + bullets 作 tooltip。
- 2026-05-09  全局命令 palette: 新增 packages/web/src/CommandPalette.tsx,Cmd+K/Ctrl+K 唤起(window capture keydown 拦截避免 xterm 吞键),居中暗色 modal(20vh top / 600 max-width);条目聚合 sessions(summary.title→title→id)/skills/commands/subagents/actions(New session/Config/Marketplace/Settings/File browser/Projects/Devices)/git(status/diff/log/branch 走 git.exec.request);前缀 `>` 动作 `:` 命令 `@` 会话 `#` skill 过滤分类;手写 score(exact/startswith/indexOf/consecutive 加权)排序;open 时一次性发 skill.list.request/cmd.list.request/subagent.list.request,60s 缓存;↑↓ Enter Esc 全 preventDefault+stopPropagation 防 xterm 冲突。App.tsx 新增 paletteActions memo + 挂 `<CommandPalette>` 于 modals 尾部。
- 2026-05-09  会话录屏 + 回放: 新增 host/recording.ts Recorder(asciinema v2 writer,createWriteStream 模式 0o600 到 ~/.rcc/recordings/<sid>.cast,header JSON 行 + 每 pty.out 块追加 `[elapsedSec,"o",data]` JSONL,50MB cap 命中时自动 stop + 回调 session 清 recorder 引用,pty.onExit 自动 seal);Session 新增 startRecording/stopRecording/recordingStatus,pty.onData 里喂给 recorder 不动 RingBuffer。Protocol 加 record.start/record.stop/record.status.request/record.status 四帧 + RecordingStatusData。host/index.ts handle 三个 ws 帧,仅 CLI(Session) 可录;GET /recording/:sid.cast 返 application/x-asciicast 流(authenticate 必带 token),DELETE /recording/:sid 清文件;sid 正则白名单防穿越。Web RecordingPanel 挂在 session header(idle 红点 · recording 脉冲+实时大小+elapsed mm:ss · 有文件 ▶ 回放/⬇ 下载/🗑 删除 · 50MB 截断 ⚠ chip),每 2s 拉一次 record.status 保持实时。新 RecordingPlayback 独立 xterm 实例(disableStdin,不引 asciinema-player 库)fetch cast → 逐行 parse → requestAnimationFrame 播放按 virtualT,播放/暂停/回到开头/滑杆 seek(重置 term+重放到目标 t)/0.5x/1x/2x/4x 速度切换平滑过渡。
- 2026-05-09  Inbox 活动流: 新增 host/activity.ts ActivityFeed(内存 rolling 200 条 + 单条 ≤4KB 自动截断 summary/subjects/message/notes),broadcast(frame) 直送 activity.append;集成点最小改动 — broadcastApproval 钩 approval.request→append kind:"approval" status:"pending"、approval.cleared→resolveApproval 把对应 id 翻到 resolved;attachApprovalWatcher(CLI + SDK onExit 两路)append kind:"session_exit";attachGitWatcher onCommits append kind:"commits"(subjects 取前 10);installCrashHandler append kind:"crash";启动时 probeUpdate() + 6h 一次 interval 检查 checkForUpdates,latest 与上次不同才 append kind:"update" 避重复。Protocol 加 ActivityItem 五元 zod discriminated union + activity.list.request/activity.list/activity.append 三帧。Web 新增 InboxView.tsx + createInboxStore(connected 时自动拉 activity.list.request,增量消费 activity.append;localStorage rcc:inbox:lastOpenedAt 记上次打开时间,unread memo 按时间戳对比);App.tsx 顶栏 📥 按钮 + 未读 badge(accent 色 99+ 截断),点击滑出右侧 420px 抽屉(移动全屏),标签过滤 全部/审批/提交/系统,按时间倒序,点击 approval/commits/session_exit 跳 sid + 关闭、update 跳 VersionBadge、crash alert 详情;全部已读按钮 + 点遮罩自动标记;总量 / 未读 tooltip。
