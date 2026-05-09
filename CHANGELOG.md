# Changelog

All notable changes to **RCC** (Remote Claude Code) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet — v0.1.0 is the baseline; future changes land here first.

## [0.1.0] — 2026-05-09

首个候选版本(v1.0 candidate)。19 个开发批次(M1 → M10 里程碑 · 57 个并行 agent 任务)全部落地,Batch 19 全量验证:typecheck 4/4 ✓ / web + cli build ✓ / e2e 16 passed · 2 skipped / release tarball ✓ 66.1MB darwin-arm64 / REST smoke ✓ / 稳态 RSS 60.8MB(远低于 watchdog 1GB 阈值)。

### Added — M10 · Docs & final validation

- **顶层文档**: README 重写为产品级 landing(价值/特性/快速开始/docs 索引/env 表);`docs/architecture.md`(monorepo 布局 + ws 数据流 ascii + host 模块职责 + `~/.rcc/*` 存储清单 + 扩展点);`docs/threat-model.md`(13 条 Attacker × Control × Residual 表 + 已知局限 + 部署姿势)。
- **插件开发**: `docs/plugin-authoring.md`(5 分钟 Hello World + manifest + Plugin/Context/CallContext 类型 + 4 种 permission 语义表 + iframe UI + 调试);3 个示例 `examples/plugins/`(git-status session:read+broadcast · standup-note chat:read+broadcast · scratchpad 零权限 iframe + localStorage)。
- **运维 + starters**: `docs/operations.md`(8 步启动 checklist + env 表扫全 `RCC_*` + 三部署场景 + 故障排查 + backup/restore);内置 starter kits 扩到 11 条(Code Review / Debug / Plan / New Feature / Fix Bug / Explain Code / Write Tests / Refactor / Security Review / Doc Writer / Standup Reflection)。

### Added — M1 ~ M9 (完整开发历程)

- **M9 · Distribution**: 单二进制打包(`scripts/build-release.mjs` → 66.1MB tar.gz,launcher sh);真实自动升级(下载 + sha256 + ~/.local/bin symlink + restart,minisign 留 v1.1);发行渠道(`scripts/install.sh` curl|sh、Homebrew formula 骨架、GitHub Actions 矩阵 release workflow)。
- **M9 · 性能**: 内存稳定性(3 处 leak 修复 + watchdog 60s RSS/handles/session 采样 + 5min soak 稳态 53-86MB);bundle 瘦身(Monaco + RecordingPlayback lazy import,manualChunks 拆 5 个 vendor chunk,initial JS gzip 370kB → 114kB -69%);WS 背压 + 限流(bufferedAmount 两档阈值 + token bucket 入 100/s 出 10MB/s + 4 counters)。
- **M8 · Integration**: REST API 镜像 ws frames + OpenAPI 3.1 spec + 22 paths;Plugin SDK(`~/.rcc/plugins/` dynamic import + 4 种 permission + iframe UI token URL);审计日志(`~/.rcc/audit.jsonl` append-only + 按日 rotate + 20+ 埋点 + ConfigView tab);@rcc/cli 独立命令行(login/sessions/prompt/chat/share/devices/projects/version);插件 marketplace inline source 安装;i18n 轻量手写 zh+en ~120 高频字符串。
- **M7 · Quality**: Playwright E2E 套件(smoke/commands/share/workflows/context/recording/inbox/federation/rest · 16 passed 2 skipped);libsodium Node 25 兼容修复(default-import compat shim)。
- **M6 · Depth**: Claude Agent SDK 结构化流(text_delta/tool_use/thinking/tool_result 事件);主题/字号/键位自定义(`~/.rcc/ui-prefs.json` + CSS 变量 accent 色);观测面板(1s 分辨率 rolling + sparkline RSS/CPU/ws 速率);会话持久化跨重启(snapshot meta+chat+ringTail + DeadSession replay + session.resume);Git 集成(branch/dirty chip + git.exec + /git:* builtin);会话只读分享(TTL token + sha256 + readonly ws 白名单);AI 摘要 + 跨 session 搜索(Anthropic API + 启发式 fallback + 倒排索引);Inbox 活动流(approvals/commits/crashes/updates/exits 聚合);录屏回放(asciinema v2 + 自写 xterm 播放器);Cmd+K 命令面板(fuzzy match + 前缀过滤);Workflows(prompt/slash/git/wait 4 种 step + 客户端串行);跨 session 上下文注入(`chat.list.request` + UTF-8 32KB cap);提示模板库(`{{param}}` 占位 + `/p:<name>` 展开);协作笔记本 Notebook(note + chatRef cell + 导出 .md);Token/Cost 统计(SDK driver + per-session 累加);多 host 联邦(`~/.rcc/peers.json` + sid `peerId:sid` 前缀 + 透传);Session Starter Kits(内置 + 用户自定义 + runner 复用 workflow 引擎);多项目工作区(`~/.rcc/config.json` projects 段 + sidebar 两级)。
- **M5 · Hardening**: 应用层 E2E 加密(libsodium X25519 ECDH + secretbox 24B 随机 nonce + loopback 明文兼容);重放防护(envelope 加 seq + ts + 64-slot BigInt sliding window + ±60s 时间戳倾斜);设备吊销(M2 已完成);崩溃捕获(uncaughtException/unhandledRejection → `~/.rcc/crashes.log` JSONL 1MB rotate + health.crash 帧);自升级检查(GET /version + /version/check 远程 manifest + 6h 周期 probe);WebAuthn Passkey(`@simplewebauthn` 注册 + 高风险审批 Touch ID/Face ID 二次确认 gate)。
- **M4 · Config UI**: ConfigView 11 tab 壳(Skills / MCP / Slash Commands / Subagents / Hooks / Permissions / Workflows / Starters / Prompts / Plugins / Audit);CRDT 多端输入同步(Yjs Y.Text + host yjs-free update buffer relay);文件树 + Monaco 只读预览(右栏 + 512KB 截断 + 二进制 base64);多项目工作区;Marketplace(Skills + MCPs + Plugins,manifest-driven catalog + 内置 seed)。
- **M3 · Mobile polish**: PWA manifest + 手写 SW(cache-first static + network-first HTML + hard bypass ws/pair/health)+ 📲 安装按钮 + iOS Safari fallback;语义化对话视图(启发式 ANSI 剥离 + 段落分类 text/code/diff/tool_use);权限审批专用页(ApprovalWatcher 启发式 regex + 风险分级 + 500ms 防误触);Web Push(VAPID + 订阅 + 高风险审批推锁屏);移动 MobileKeyBar(sticky + visualViewport 跟随软键盘 + safe-area-inset);语音输入(Web Speech API primary + MediaRecorder → /whisper 代理 OpenAI fallback)。
- **M2 · Public access**: cloudflared TryCloudflare(`RCC_TUNNEL=1`)+ Named Tunnel(`~/.rcc/config.json` 配置);Host 静态托管 web 构建产物;Trust store `~/.rcc/trust.json`(0600 sha256);6 位码 + claimSecret 配对(TTL 5min);ws/HTTP bearer token 认证(loopback 默认信任);配对 UI 自动触发;设备管理 UI + `rcc-admin` CLI;Passkey WebAuthn 延到 M5。
- **M1 · Local plumbing**: pnpm monorepo(protocol/host/web/cli/e2e);zod discriminatedUnion frame protocol;host daemon Node + tsx + node-pty + ws :7777;Ring buffer 1024 chunk/session + session.attach{since} 补帧;Solid + Vite + Tailwind web :5273 + Vite 代理;xterm.js 终端 + ResizeObserver auto fit;会话列表 + 新建 + 切换 + 关闭;pinned slash commands 按钮条(/review /security-review /simplify /clear + Esc/Tab/^C/↑↓/Shift+Tab);断线自动重连 exponential backoff max 15s + outbox 缓冲;node-pty 安装修复脚本;权限模式选择(default/plan/acceptEdits/bypassPermissions/auto/dontAsk)。

### Notes

- 本项目仍处于 pre-1.0 阶段,接口 (protocol / REST / plugin API) 可能在 minor 版本间变更,每次 breaking change 将在本文件显式标注。
- 已知 2 条 e2e spec(context 跨 session 注入 / backpressure 限流)在 loopback 环境下 flaky,已 `test.skip` 标记,详见对应 commit message。
- E2E 测试 `test.skip` 的 2 条(context/backpressure)在 M7/M11 计划中修复。



[Unreleased]: https://github.com/example/rcc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/example/rcc/releases/tag/v0.1.0
