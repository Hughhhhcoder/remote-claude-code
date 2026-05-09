# RCC — Remote Claude Code

> 从任何设备控制本机 `claude` CLI 的远程终端。
> 移动浏览器 + 桌面 Web + CLI 一致体验;E2E 加密、端到端审计、可扩展。

<!-- hero image placeholder: screenshot/GIF -->

## 为什么

- `claude` CLI 只能在本机跑;手机想继续对话得 ssh + tmux
- 多设备、家里公司切换,session 状态经常丢
- 公网直接暴露终端风险高,需要能用的认证 + 加密

RCC 把 `claude` 包在一个守护进程里,暴露 WebSocket + REST + PWA,配对后任何设备都能安全接回同一个 session。

## 快速开始

```sh
# 一键脚本 (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/Hughhhhcoder/remote-claude-code/main/scripts/install.sh | bash

# 启动 host
rcc

# 想公网访问:
RCC_TUNNEL=1 rcc
```

详见 [docs/install.md](docs/install.md)(Homebrew、手动、源码安装、环境变量全表)。

## 特性概览

- 💬 **双视图**:xterm 原生终端 + 结构化对话(ANSI 剥离 + 段落分类 + tool_use/diff 折叠)
- 🤖 **Claude Agent SDK 驱动**:CLI 或 SDK 双 driver 可选,SDK 走真实结构化流 + token/cost 统计
- 🔐 **E2E 加密**:X25519 ECDH + libsodium secretbox,device pairing、per-device sharedKey、重放防护
- 🔑 **Passkey 二次确认**:高风险审批走 WebAuthn,Touch ID / Face ID 确认
- 📱 **移动优化**:PWA + SW 缓存、虚拟键盘条、权限审批专用页、Web Push、语音输入
- ⚙ **内置管理面板**:Skills / MCP / Slash commands / Subagents / Hooks / Permissions / Workflows / Starters / Prompts / Notebook / Plugins / Audit
- 🌐 **公网访问**:cloudflared 随机隧道或命名隧道,单 URL 同时服务 UI + WebSocket
- 🔌 **Plugin SDK + Marketplace**:manifest 驱动,permissions 声明,iframe sandbox UI
- 🧰 **完整 REST API + OpenAPI 3.1**:`@rcc/cli` 客户端,第三方脚本友好
- 📊 **观测 + 审计**:metrics sparkline、session 录屏 asciinema 回放、append-only JSONL audit log
- 🤝 **多 host 联邦**:订阅远程 host,sessions 合并展示,sid 前缀透传
- 🔗 **只读分享链接**:TTL 可选、可撤销,访客无 E2E key,白名单帧过滤

完整清单:[FEATURES.md](FEATURES.md)

## 文档

- [安装](docs/install.md)
- [架构](docs/architecture.md)
- [威胁模型](docs/threat-model.md)
- [CLI 使用](packages/cli/README.md)
- 变更日志:[CHANGELOG.md](CHANGELOG.md)

## 开发

```sh
pnpm install
pnpm dev:host    # shell 1 — host daemon (默认 :7777)
pnpm dev:web     # shell 2 — web 前端 (:5273,代理 /ws)
# 打开 http://localhost:5273
```

不想装真 `claude` 也能冒烟:

```sh
RCC_CLAUDE_CMD=bash RCC_CLAUDE_ARGS="-l" RCC_CWD=/tmp pnpm dev:host
```

常用环境变量:

| 变量 | 默认 | 用途 |
|---|---|---|
| `RCC_PORT` | `7777` | host 端口 |
| `RCC_CWD` | `process.cwd()` | 新 session 默认 cwd |
| `RCC_CLAUDE_CMD` | `claude` | 被 spawn 的命令 |
| `RCC_PERMISSION_MODE` | `default` | 新 session 默认 `--permission-mode` |
| `RCC_TUNNEL` | 未设 | `1`/`try` 启随机隧道,`named` 启命名隧道,`off` 关闭 |
| `RCC_TRUST_LOOPBACK` | `1` | `0` 要求 loopback 也带 token |

## License

TBD
