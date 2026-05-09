# Changelog

All notable changes to **RCC** (Remote Claude Code) are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **M9 · 发行渠道**: `scripts/install.sh` (curl | sh 一键安装,自动 Node 版本检测 + sha256 校验 + `~/.local/bin` symlink),Homebrew formula 骨架 (`homebrew/rcc.rb` 四平台 stanza + placeholder sha256),GitHub Actions release workflow (`.github/workflows/release.yml` 矩阵 build darwin/linux × arm64/x64,发布 tar.gz + SHA256SUMS,自动渲染 Homebrew formula),首版 `CHANGELOG.md` 与 `docs/install.md`。
- **M9 · Plugin Marketplace tarball**: Protocol 扩展 `MarketPluginEntry` 支持 inline / tarball 两种 source(tarball 解压留待后续 agent)。
- **M8 · Integration**: REST API + OpenAPI 3.1 spec、Plugin SDK (host 动态载入 `~/.rcc/plugins/*`)、审计日志 (`~/.rcc/audit.jsonl` append-only + 按日 rotate)、`@rcc/cli` 命令行客户端、轻量 i18n (zh + en)。
- **M7 · Quality**: Playwright E2E 套件、libsodium Node 25 兼容修复。
- **M6 · Depth**: Claude Agent SDK 结构化流、主题/字号/键位自定义、观测面板 (sparkline 实时 RSS/CPU/ws 速率)、会话持久化跨重启、Git 集成 (branch chip + git.exec)、会话只读分享、全局 Cmd+K 命令面板、asciinema 录屏回放、Inbox 活动流、跨 session 上下文共享、工作流 Workflows、提示模板库 Prompts、协作笔记本 Notebook、Token/Cost 统计、多 host 联邦、Session Starter Kits。
- **M5 · Hardening**: libsodium X25519 应用层 E2E 加密、重放防护 (seq + 64-slot sliding window + ±60s ts 倾斜)、崩溃捕获 + 自升级检查。
- **M4 · Config UI**: ConfigView 5-tab 壳、Skills / MCP / Slash Commands / Subagents / Hooks / 权限策略 / 多项目工作区 / Marketplace / Starters / Audit / Plugins 全量管理、CRDT 多端输入同步 (Yjs)、文件树 + Monaco 只读预览。
- **M3 · Mobile polish**: PWA manifest + SW、语义化对话视图、权限审批专用页、Web Push (VAPID)、移动虚拟键盘快捷键条、语音输入 (Web Speech + Whisper fallback)。
- **M2 · Public access**: cloudflared TryCloudflare / Named Tunnel 集成、信任存储 (`~/.rcc/trust.json`)、6 位码配对、ws/HTTP token 认证、设备管理 UI + CLI、Passkey (WebAuthn) 叠加高风险审批二次确认。
- **M1 · Local plumbing**: pnpm monorepo 骨架、zod frame protocol、host daemon (node-pty)、Ring buffer 补帧、Solid + Vite + Tailwind web 前端、xterm.js 终端视图、会话生命周期、快捷按钮条、断线自动重连、权限模式选择。

### Notes
- 本项目仍处于 pre-1.0 阶段,接口 (protocol / REST / plugin API) 可能在 minor 版本间变更,每次 breaking change 将在本文件显式标注。

## [0.1.0] — 2026-05-09

首次预览版本 — 详见上方 Unreleased 条目 (M1-M9)。所有功能内建于首个 tag,后续版本将以增量形式更新。

[Unreleased]: https://github.com/example/rcc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/example/rcc/releases/tag/v0.1.0
