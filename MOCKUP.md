# RCC — Remote Claude Code

> 在任何网络环境下，通过手机或电脑 Web 端稳定控制本地机器上的 Claude Code。
> 体感与本地使用无差别。

---

## 1. 产品目标（Acceptance Criteria）

| 维度 | 目标 |
|---|---|
| **可达性** | 任意网络（4G/公共 WiFi/酒店）均能连上家里/公司那台跑 CC 的 Mac |
| **延迟** | 键入到屏幕回显 < 150ms（同城），< 400ms（跨国） |
| **功能完整度** | CC 的 100% 功能：slash commands、MCP、hooks、plan mode、权限弹窗、图片、PDF、多 session |
| **移动端体验** | 单手可用、虚拟键盘友好、语音输入、推送通知 |
| **跨设备连续性** | 手机看到的 session，电脑打开 Web 立即接续，同一会话多端镜像 |
| **稳定性** | 网络抖动自动重连，不丢字符、不乱序、不重复执行 |
| **安全** | E2E 加密 + 设备配对 + 权限审批走手机侧 |

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        你的本地 Mac (Host)                       │
│                                                                 │
│   ┌──────────────────┐         ┌──────────────────────────┐     │
│   │ rcc-host daemon  │ ◄─pty─► │  claude (真实 CC CLI)    │     │
│   │  (Node/Bun)      │         │  + 工作目录 + MCP + hooks│     │
│   └────────┬─────────┘         └──────────────────────────┘     │
│            │ WebSocket (本地)                                    │
│   ┌────────▼─────────┐                                          │
│   │ cloudflared      │ ── 出站长连接 ──►  Cloudflare Edge       │
│   └──────────────────┘                                          │
└─────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTPS / WSS
                                        │ (自定义子域, 固定)
                                        ▼
                       ┌────────────────────────────┐
                       │    Cloudflare Tunnel        │
                       │  rcc-<yourname>.trycf.com   │
                       └──────────────┬──────────────┘
                                      │
                           ┌──────────┴──────────┐
                           ▼                     ▼
                  ┌─────────────────┐   ┌─────────────────┐
                  │   手机浏览器     │   │   电脑浏览器     │
                  │   (PWA 安装)    │   │   (PWA 安装)    │
                  └─────────────────┘   └─────────────────┘
```

**为什么这样选：**
- Cloudflare Tunnel 出站连接 → 不用开端口、不怕 NAT、免费且可绑自定义域名
- PWA → 一套代码适配手机+电脑+桌面快捷方式，Service Worker 缓存 + Web Push
- Host daemon 用 `node-pty` 包 `claude` CLI → 零侵入，CC 升级自动受益

---

## 3. 关键技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| Host daemon | **Bun** + TypeScript + `node-pty` | Bun 启动快、原生 TS、单二进制；pty 保证完整终端语义 |
| 传输协议 | **WebSocket** + 自定义 JSON 帧 + binary 分片 | 双向、低开销、易调试；二进制用于图片/文件 |
| 序列化 | JSON + MessagePack（二进制帧） | 文本走 JSON（可读），大载荷走 MsgPack |
| 前端框架 | **SolidJS** + Vite + Tailwind | 渲染终端输出比 React 省一个数量级的 CPU |
| 终端渲染 | **xterm.js** + WebGL addon | 工业标准，移动端触控支持好 |
| 隧道 | **Cloudflare Tunnel** (cloudflared) | 自带 HTTPS、固定子域、免费额度充足 |
| 认证 | Passkey（WebAuthn）+ 设备配对码 | 无密码、防钓鱼、手机 Face ID 即可解锁 |
| 加密 | TLS (CF 边缘) + **应用层 E2E**（libsodium） | 即便 CF 被攻破，内容仍加密 |
| 状态同步 | CRDT（Yjs）用于多端 session 镜像 | 两端同时输入不会冲突 |
| 推送 | Web Push（VAPID） | 权限请求弹窗能推到锁屏 |
| 语音 | Web Speech API（本地）+ 回退到 Whisper API | 优先零成本，弱环境用云端 |

---

## 4. 模块拆分

```
rcc/
├── packages/
│   ├── host/                 # 本地 daemon（你 Mac 上跑）
│   │   ├── src/
│   │   │   ├── index.ts           # 入口，CLI: `rcc-host start`
│   │   │   ├── session.ts         # Session 管理（多个 CC 实例）
│   │   │   ├── pty-bridge.ts      # node-pty ↔ WS 的桥
│   │   │   ├── protocol.ts        # 帧编解码（见 §5）
│   │   │   ├── transport/
│   │   │   │   ├── ws-server.ts   # WebSocket 服务（被 cloudflared 反代）
│   │   │   │   └── cf-tunnel.ts   # 自动拉起 cloudflared
│   │   │   ├── auth/
│   │   │   │   ├── pairing.ts     # 首次配对（QR + 6位码）
│   │   │   │   ├── passkey.ts     # WebAuthn 服务端
│   │   │   │   └── e2e.ts         # 应用层加密
│   │   │   ├── fs-bridge.ts       # 文件浏览/读取/diff 暴露
│   │   │   ├── approval-relay.ts  # 权限弹窗转发到客户端
│   │   │   └── hooks.ts           # 自动注入到 CC 的 hooks 做事件
│   │   └── package.json
│   │
│   ├── web/                  # PWA 前端（手机+电脑共用）
│   │   ├── src/
│   │   │   ├── app.tsx
│   │   │   ├── views/
│   │   │   │   ├── terminal.tsx      # xterm.js 核心视图
│   │   │   │   ├── sessions.tsx      # 会话列表/切换
│   │   │   │   ├── files.tsx         # 文件浏览器 + diff 预览
│   │   │   │   ├── approvals.tsx     # 权限审批页
│   │   │   │   ├── voice.tsx         # 语音输入 overlay
│   │   │   │   └── pair.tsx          # 首次配对流程
│   │   │   ├── layout/
│   │   │   │   ├── mobile.tsx        # 手机布局（底部 tab）
│   │   │   │   └── desktop.tsx       # 桌面布局（侧栏 + 主区）
│   │   │   ├── transport/
│   │   │   │   ├── client.ts         # WS 客户端 + 重连 + 缓冲
│   │   │   │   └── crypto.ts         # libsodium 解封/封包
│   │   │   ├── state/
│   │   │   │   └── crdt.ts           # Yjs 多端同步
│   │   │   ├── pwa/
│   │   │   │   ├── sw.ts             # Service Worker
│   │   │   │   └── push.ts           # Web Push 订阅
│   │   │   └── theme/
│   │   └── vite.config.ts
│   │
│   ├── protocol/             # 前后端共用的协议/类型
│   │   └── src/
│   │       ├── frames.ts
│   │       └── schema.ts
│   │
│   └── shared/               # 工具
│
├── docs/
│   ├── architecture.md
│   ├── security.md
│   └── protocol.md
│
├── .claude/                  # 这个项目自己也用 CC
├── MOCKUP.md                 # ← 本文档
├── README.md
└── package.json              # pnpm workspace
```

---

## 5. 协议设计（核心）

所有帧统一结构：

```ts
type Frame =
  | { t: "pty.out";       sid: string; seq: number; data: Uint8Array }   // pty → client
  | { t: "pty.in";        sid: string; data: string }                    // client → pty
  | { t: "pty.resize";    sid: string; cols: number; rows: number }
  | { t: "session.list";  sessions: SessionMeta[] }
  | { t: "session.new";   cwd: string; args?: string[] }
  | { t: "session.attach";sid: string; since?: number }                  // since = 续传点
  | { t: "approval.ask";  sid: string; id: string; payload: ApprovalPayload }  // Host → Client
  | { t: "approval.ans";  id: string; decision: "allow"|"deny"|"always" }
  | { t: "fs.ls";         path: string }
  | { t: "fs.read";       path: string; range?: [number,number] }
  | { t: "fs.diff";       path: string }                                 // 返回 unified diff
  | { t: "push.register"; endpoint: string; keys: PushKeys }
  | { t: "voice.stream";  sid: string; chunk: Uint8Array }               // Opus 编码
  | { t: "ping"; ts: number } | { t: "pong"; ts: number };
```

**关键设计决策：**
1. **`seq` 序号** — 客户端记住最后收到的 seq，断线重连时发 `session.attach{since}`，Host 从 ring buffer 重放；保证不丢不重
2. **权限带外通道** — CC 的权限弹窗被 Host 拦截（通过 hook 或 pty 识别），变成 `approval.ask` 帧；所有已配对设备都收到，任一设备响应即决定
3. **多端镜像** — 同一个 sid 可以被多个客户端 attach，Host 广播 pty.out 到所有 attached client；输入也广播给其他端显示（带 origin 标识）
4. **二进制复用 WS** — 图片/文件内容用 binary frame，首字节 magic 区分

---

## 6. UI Mockup

### 6.1 手机端（竖屏，414×896）

```
┌────────────────────────────────┐
│  ◄ rcc · Mac-Studio   ⚡ 🔔 3  │  ← 顶栏（连接状态/通知）
├────────────────────────────────┤
│                                │
│  > 修改 App.tsx 让按钮变蓝色    │
│                                │
│  ● Reading App.tsx             │
│  ● Editing App.tsx             │
│  ┌──────────────────────────┐  │
│  │ - bg-red-500             │  │  ← 折叠的 diff，点开全屏
│  │ + bg-blue-500            │  │
│  └──────────────────────────┘  │
│  ✓ Done                        │
│                                │
│  ──────────────────────────    │
│                                │
│  ⚠ 请求权限                    │  ← 醒目卡片 + 振动 + 推送
│  ┌──────────────────────────┐  │
│  │ Bash: npm run build      │  │
│  │ [ 拒绝 ] [ 允许 ] [总是] │  │
│  └──────────────────────────┘  │
│                                │
├────────────────────────────────┤
│ ┌──────────────────────────┐   │  ← 输入条（贴键盘上方）
│ │ 输入消息…           🎤 ➤│   │
│ └──────────────────────────┘   │
├────────────────────────────────┤
│ 💬 对话  📁 文件  📋 审批  ⚙  │  ← 底部 Tab
└────────────────────────────────┘
```

**移动端细节：**
- 「对话」tab 不是裸终端，而是**语义化渲染**：tool_use 卡片、diff 折叠、图片内联
- 长按消息 → 复制/引用/跳转文件
- 🎤 按住说话 → 实时转文字 → 松开发送（Whisper 回退）
- 键盘上方浮一条**快捷条**：`ESC` `Tab` `↑↓` `/` `@` `ctrl+C`（CC 常用键）
- 掉线时顶栏变黄：「重连中 (已缓冲 3 条输入)」

### 6.2 桌面端（1440×900）

```
┌───────────────────────────────────────────────────────────────────────┐
│  rcc                                                 ⚡ Mac-Studio · 🔔│
├───────┬───────────────────────────────────────────────┬───────────────┤
│       │                                               │               │
│ 会话  │  ~/projects/rcc (main)                        │ 文件树        │
│       │                                               │               │
│ ● 当前│  $ claude                                     │ ▸ packages/   │
│   rcc │  > 帮我把 protocol.ts 改成 zod schema         │ ▸ docs/       │
│       │                                               │ ▸ .claude/    │
│ ○ blog│  ● Reading protocol.ts                        │   MOCKUP.md   │
│   /api│  ● Editing protocol.ts (+24 -12)              │               │
│       │   ┌─────────────────────────┐                 │ ─────────     │
│ ○ site│   │ diff view (click: full) │                 │               │
│   /fix│   └─────────────────────────┘                 │ 最近打开:     │
│       │  ✓ Done                                       │ • frames.ts   │
│ + 新  │                                               │ • schema.ts   │
│       │  > _                                          │               │
│       │                                               │               │
│       │                                               │               │
├───────┴───────────────────────────────────────────────┴───────────────┤
│  > [此处是真实 xterm 视图，支持 CC 的全部交互]              🎤 send  │
└───────────────────────────────────────────────────────────────────────┘
```

**桌面端细节：**
- 左栏：多个 CC session（每个对应一个工作目录），可并行
- 中栏：默认「语义化对话视图」，按 `⌘T` 切换到**纯 xterm 视图**（完全一致于本地）
- 右栏：工作目录浏览 + 最近打开；点击跳转到内嵌的 Monaco 预览
- 所有快捷键与本地 CC 保持一致（ESC 打断、Shift+Tab 切模式、`/` slash commands 自动补全）

### 6.3 首次配对（手机扫电脑屏）

```
电脑端:                        手机端:
┌──────────────────┐          ┌──────────────────┐
│                  │          │                  │
│   [  QR CODE  ]  │          │   扫到了         │
│                  │          │   ┌────────────┐ │
│   或输入:        │          │   │ Mac-Studio │ │
│   ┌──────────┐   │   ──►    │   │ 172.x.x.x  │ │
│   │ 4 8 2 9  │   │          │   └────────────┘ │
│   │ 1 7      │   │          │   [ Face ID 确认]│
│   └──────────┘   │          │                  │
└──────────────────┘          └──────────────────┘

配对成功后生成:
  - 设备 keypair (存手机 Keychain / Secure Enclave)
  - Passkey (WebAuthn)
  - 应用层 E2E 共享密钥
之后永不再问密码。
```

---

## 7. 安全模型

| 威胁 | 防御 |
|---|---|
| 中间人窃听 | TLS (CF) + 应用层 libsodium E2E |
| CF 账号被盗 | E2E 密钥不经过 CF，攻击者只看到密文 |
| 手机丢失 | 电脑端 `rcc-host revoke <device>` 一键吊销；Passkey 绑定设备 |
| 恶意输入从公网注入 | 所有连接必须持有已配对的 passkey 才能 attach |
| CC 被诱导执行危险命令 | 权限弹窗**必须**手机/电脑某端明确批准，默认 plan mode |
| 重放攻击 | 每帧带 nonce，Host 维护滑动窗口 |

---

## 8. 开发路线图（建议分 5 个 milestone）

### M1 — 最小可用骨架（1 周）
- [ ] Host daemon 拉起 `claude` pty，本地 WS echo
- [ ] Web 端 xterm.js 连本地 WS，能完整使用 CC
- [ ] pnpm workspace + protocol 包

**验收**：本地浏览器打开 `localhost:7777` 和本地跑 CC 无差别

### M2 — 公网可达（3–4 天）
- [ ] 集成 cloudflared，首次启动自动建隧道
- [ ] 配对流程（QR + 6 位码）
- [ ] 基本重连 + ring buffer 补帧

**验收**：手机 4G 打开 PWA URL，能用 CC 跑任务

### M3 — 移动端体验打磨（1 周）
- [ ] 语义化对话视图（tool_use 卡片、diff 折叠）
- [ ] 权限审批专用页 + Web Push + 振动
- [ ] 虚拟键盘上方的快捷键条
- [ ] 语音输入（Web Speech → 失败回退 Whisper）

**验收**：全程用手机完成一个 feature（改代码 + 审批 + 看 diff）

### M4 — 多端镜像 & 文件浏览（1 周）
- [ ] Yjs CRDT 做输入同步
- [ ] 文件树 + Monaco 预览 + 实时 diff
- [ ] 多 session 并行

**验收**：电脑上开着任务，手机打开立即看到进度，批准后继续

### M5 — E2E 加密 & 生产级稳定性（3–4 天）
- [ ] 应用层 libsodium E2E
- [ ] 设备管理/吊销
- [ ] 崩溃上报、metrics、自升级

**验收**：连续一周每天使用无故障

---

## 9. 风险与开放问题

| 问题 | 当前想法 |
|---|---|
| CC 的 TUI 有大量 ANSI 控制符，xterm.js 能完美渲染吗？ | 实测过可以，但需要把 xterm 的 `allowProposedApi` 打开，对 sixel/图片做扩展 |
| 权限弹窗在 pty 里是纯文本，怎么语义化拦截？ | 方案 A：用 CC 的 hooks 机制（PreToolUse hook 回传到 daemon）；方案 B：pty 输出做模式匹配。倾向 A |
| Cloudflare Tunnel 免费版有连接数限制 | 个人使用远低于限制；若超限换 `localhost.run` 或升级 |
| 手机端长按退格/方向键的终端交互 | 快捷键条里给硬按键；长按用 haptic 反馈 |
| 流量消耗（图片/大 diff） | 图片走二进制帧 + WebP 转码；diff 超过 200 行折叠，点开按需拉取 |
| 后台杀进程 | Service Worker 保活 + 推送拉活；iOS 限制较多，接受「进后台 30s 后断开，前台自动重连」 |

---

## 10. 我想和你确认的事

在我开始写代码前，请过一遍 §6 的 UI 和 §8 的 milestone，特别是：

1. **移动端默认视图**：你希望是「语义化卡片」（我上面画的样子），还是「纯终端」（和电脑一模一样）？我目前默认前者、`⌘T` 切换，你觉得呢？
2. **会话持久化**：CC 进程崩了，重启后要不要尝试恢复 context？（需要把最近 N 轮历史注入回去）
3. **单用户还是多用户**：你自己一个人用，还是会有「把这个 Mac 临时分享给同事」的场景？会影响权限模型复杂度
4. **M1 是否可以先不做 PWA**，先搞定本地 Web → 本机 CC 的管道，再加公网？
5. 上面技术栈里有没有你不喜欢的（比如不想用 SolidJS，想用 React/Vue）？

看完告诉我要改什么，改完我就开始搭 M1。
