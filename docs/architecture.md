# RCC 架构

面向开发者与代码审阅者。用户文档见 [install.md](install.md)。

## Monorepo 布局

```
rcc/
├── packages/
│   ├── protocol/   zod schema,所有 ws frames + 共享类型 (纯 types,无副作用)
│   ├── host/       守护进程:pty + session + auth + CRDT relay + plugin host + ...
│   ├── web/        Solid + Vite + Tailwind + xterm + Monaco(lazy)
│   └── cli/        `@rcc/cli` — 纯 REST 客户端,独立于 web
├── scripts/        build-release / install.sh / soak / fix-node-pty 等
├── homebrew/       Homebrew formula (release CI 回填 sha256)
├── examples/       plugins/echo-bot 等示例
└── docs/           本目录
```

依赖关系:

```
web  ─┐
cli  ─┼─► protocol
host ─┘
```

`protocol` 是 source of truth,任何新 ws 帧先改 zod union,然后 web / host / cli 分别消费。

## 数据流

```
┌─────────────┐    https        ┌──────────────┐   spawn    ┌───────────┐
│  browser /  │◄──(cloudflared)─┤              │─(node-pty)►│  claude   │
│  mobile     │    TLS + ws     │  host (7777) │            │  (CLI)    │
│  xterm.js   │◄───────────────►│              │─(SDK API)─►│ Anthropic │
└─────┬───────┘  E2E secretbox  │              │            └───────────┘
      │          on app layer   │   zod ws     │
      │                         │   REST /api  │            ~/.rcc/*
      ▼                         │   /share/*   │◄──────────► trust.json
┌──────────────┐                │   /pair/*    │             keys.json
│  @rcc/cli    │── Bearer ─────►│   /health    │             sessions/
│  (node)      │   REST /api/v1 │   /metrics   │             shares.json
└──────────────┘                └──────────────┘             peers.json
                                                             audit.jsonl ...
```

- 浏览器 ↔ host 默认单一 origin:cloudflared tunnel URL 同时服务 `/` 静态 UI 与 `/ws` WebSocket。
- loopback 免 token;非 loopback 必须带 `?token=` 或 `Authorization: Bearer`。
- 已升级 E2E 的 device 每帧走 `{e2e:1,n,c,s,ts}` envelope(secretbox + seq + timestamp)。
- 只读 share 访客走明文,帧被白名单过滤(仅 `hello / chat.* / pty.out / session.exited / pong / error`)。

## 模块职责

### `@rcc/protocol`

- 所有 ws 帧走 zod `discriminatedUnion("t", ...)`,CI 强制 union 收敛
- 关键 schema: `SessionMeta`, `ChatMessage`, `ChatSegment`, `UiPrefs`, `UpdateManifest`, `MetricsSnapshot`, `ActivityItem`, `Workflow`, `Starter`, `PromptTemplate`, `Notebook`, `PeerInfo`, `AuditEntry`, `SessionUsage`
- 插入标记 `[config-frames]`、`[messages]`、`[push]`、`[crdt]`、`[projects]`、`[ui-prefs]` 给并行 agent 用,加帧时在对应标记下追加

### `@rcc/host`

daemon 单进程。按文件大致切:

| 文件 | 职责 |
|---|---|
| `index.ts` | http + ws server、路由、frame dispatch、插入标记 `[config-handlers]` |
| `session.ts` / `sdk-session.ts` | pty session / Claude Agent SDK session,`AnySession` union |
| `ring-buffer.ts` | per-session 1024 chunk 环形 buf,支持 `attach{since:seq}` 补帧 |
| `pair.ts` / `trust.ts` / `webauthn.ts` | 6 位码配对 / trust.json(0600) / Passkey |
| `e2e.ts` | libsodium X25519 + secretbox envelope + 64-slot replay window |
| `backpressure.ts` | per-connection token bucket + bufferedAmount 阈值 |
| `tunnel.ts` | cloudflared 子进程(try / named 两种),TunnelBadge 所需 status 帧 |
| `skills.ts` / `mcp.ts` / `commands.ts` / `subagents.ts` / `hooks.ts` / `permissions.ts` / `prompts.ts` / `workflows.ts` / `starters.ts` / `prefs.ts` / `notebooks.ts` / `projects.ts` | 配置管理 CRUD,主要读写 `~/.claude/*` 或 `~/.rcc/*` |
| `plugins.ts` / `marketplace.ts` | plugin host(dynamic import + permission gate)+ 三类市场目录 |
| `federation.ts` | peer ws client pool,sid rewrite `<peerId>:<sid>` |
| `rest.ts` / `openapi.ts` | `/api/v1/*` 镜像 ws frames + 静态 OpenAPI 3.1 spec |
| `metrics.ts` / `watchdog.ts` / `audit.ts` / `crash.ts` | 观测 + 审计 + 崩溃捕获 |
| `updater.ts` | 下载 tar.gz + sha256 + 原子 swap + symlink 更新 |
| `shares.ts` | 只读分享 token + TTL + broadcastFiltered 白名单 |
| `recording.ts` | asciinema v2 writer,pty.out 流式写 cast |
| `git.ts` / `git-watcher.ts` | 只读 git 子命令白名单 + per-session 5s poll |
| `chat-parser.ts` / `approvals.ts` | CLI driver 的启发式 ANSI 剥离与 y/n 审批识别(SDK driver 用不到) |
| `whisper.ts` / `push.ts` | OpenAI Whisper 代理 + Web Push(VAPID)|
| `persistence.ts` | per-session snapshot,`~/.rcc/sessions/<sid>.json`,跨重启复用 |
| `admin.ts` | `rcc-admin devices/sessions/...` CLI 入口 |

host 无 DB。所有状态要么内存 + 广播,要么写 `~/.rcc/*` 文件。

### `@rcc/web`

- Solid + Vite + Tailwind,入口 `App.tsx`
- `client.ts` 单例 ws client:reconnect、outbox、E2E decrypt、status 信号、ring-buffer seq 记账
- `xterm` 直装;`Monaco` 和 `xterm-recording-player` 走 `lazy import`(manualChunks 切片,initial gz 114KB)
- `prefs.ts` + Tailwind CSS 变量 `--accent-{300,400,500,600}` 主题化
- i18n 零依赖手写 (`i18n/{zh,en}.ts`)
- PWA:`public/sw.js` 手写 SW(static cache-first、HTML network-first,排除 `/ws`、`/pair/*`、`/health`、`/tunnel`)

### `@rcc/cli`

- 无 npm 依赖,原生 `fetch` + argv parse + ANSI 转义
- profile 配置 `~/.rcc/cli-config.json`(0600,原子 tmp→rename)
- 命令:`login / sessions / prompt / chat / share / devices / projects / version`
- 走 REST(`/api/v1/*` + `/api/openapi.json`),不连 ws

## 存储清单 (`~/.rcc/`)

| 文件 | 内容 |
|---|---|
| `config.json` | tunnel 配置、anthropic/whisper API key、push VAPID、update manifestUrl、projects、marketplace |
| `trust.json` | 配对 device token sha256 + passkey + sharedKey (0600,fs.watchFile 热重载) |
| `keys.json` | host 长期 X25519 keypair (0600) |
| `sessions/<sid>.json` | 会话 snapshot(meta + chat 最近 100 条 + ringTail 32KB),debounced 500ms 写 |
| `recordings/<sid>.cast` | asciinema v2,50MB cap |
| `notebooks/<sid>.json` | 笔记 cells(note / chatRef) |
| `shares.json` | 只读分享 token sha256 + TTL |
| `peers.json` | 多 host 联邦 peer 列表(token 明文,0600)|
| `mcp-disabled.json` | claude CLI 无原生 disable,RCC 快照实现 |
| `pinned-commands.json` | 置顶 slash commands,实时广播到移动键盘条 |
| `push-subs.json` | Web Push 订阅 |
| `prompts.json` / `workflows.json` / `starters.json` / `ui-prefs.json` | 各管理面板持久化 |
| `plugins/<id>/` | 第三方 plugin manifest + entry + ui/ |
| `audit.jsonl[.YYYY-MM-DD]` | append-only 审计,按日 rotate,30d retention |
| `crashes.log[.1]` | uncaughtException/unhandledRejection,1MB rotate |
| `install/rcc-<ver>/` | 自升级解压目录,`~/.local/bin/rcc` symlink |

## 外部依赖

| 依赖 | 用途 | 备注 |
|---|---|---|
| `node-pty` | spawn `claude` 到 pty | postinstall 修 spawn-helper +x |
| `libsodium-wrappers` | X25519 + secretbox | Node 25 CJS/ESM interop 需 `ensureSodium()` shim |
| `@anthropic-ai/claude-agent-sdk` | SDK driver 结构化流 | 可选,需 `ANTHROPIC_API_KEY` |
| `cloudflared` | 外部二进制,`brew install` | try / named 两模式 |
| `web-push` | VAPID 推送 | 首次启动自动生成密钥 |
| `@simplewebauthn/*` | Passkey 服务端 + 浏览器端 | rpId 从 Host 头派生 |
| `yjs` | 仅 web 端 | host 做无 yjs 依赖的 byte relay |
| `solid-js` / `xterm` / `monaco-editor` | web UI | Monaco/录屏播放器 lazy |

## 扩展点

- **Plugins**:`~/.rcc/plugins/<id>/` + `manifest.json`,host 启动 dynamic import,permissions 白名单 (`session:read/write`、`chat:read`、`broadcast`);UI 走 `/plugins/:id/*` + iframe sandbox。详情 `docs/plugin-authoring.md`(另一 agent 在写)。
- **Marketplace**:`marketplace.manifestUrls`(https only,1h 缓存)→ skills / mcp / plugins 三目录;内置 seed 作 fallback。
- **Starter kits**:`~/.rcc/starters.json`,`SessionNew.starterId` 触发客户端 runner(复用 workflow-runner)注入 systemPrompt / enable skills / 跑 firstSteps。
- **Workflows**:纯客户端链式执行,host 只负责 CRUD;steps: `prompt / slash / git / wait`。
- **Protocol 插入标记**:`[config-frames]`、`[config-handlers]`、`[messages]`、`[push]` 等。新 agent 加帧/handler 必须落在标记下,保持 merge-free。
- **REST API**:`/api/v1/*` 与 ws frames 一对一,`/api/openapi.json` 可直接导 Postman。扩展新 resource 时遵循现有风格(Bearer auth、JSON body 1MB、统一 `{error,code}`)。
