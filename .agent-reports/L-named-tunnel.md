# Agent L · Named Cloudflared Tunnel (M3 batch 2)

## 交付

- 新增 `packages/host/src/config.ts`：`loadConfig()` 读 `~/.rcc/config.json`，`resolveTunnelConfig(cfg, env)` 合并 env `RCC_TUNNEL` 与 `tunnel.mode`（env 优先）。
- 重构 `packages/host/src/tunnel.ts`：抽 `BaseTunnel` 基类；`CloudflaredTunnel`（try）保持原行为；新增 `NamedCloudflaredTunnel` spawn `cloudflared tunnel --credentials-file <file> --url http://localhost:<port> run <name>`，启动时 preflight 检查 credentialsFile + `~/.cloudflared/cert.pem`，缺失就给友好 error 并停在 `error` 状态（不 crash）；导出 `startTunnel(config, port)` 统一入口。
- `packages/host/src/index.ts`：启动时 `loadConfig` + `resolveTunnelConfig`，根据 mode 分支；缺关键字段的 named 配置回退到 try 模式并 warn。
- `packages/protocol/src/index.ts`：`TunnelInfo` 加可选 `mode/hostname/name`（`[tunnel-config]` 标记）。
- `packages/web/src/App.tsx`：TunnelBadge 在 named 模式加 🔒 前缀 + “命名隧道”tooltip，try 模式照旧。
- README.md 新增 “公网访问（命名隧道 - 推荐生产）” 章节 + env 表更新。
- FEATURES.md 该行改 🟢 + 变更日志追加一行。

## 校验

`pnpm -r typecheck` 全绿。
