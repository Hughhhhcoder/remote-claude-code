# E-permissions — M4 batch 2

**Status:** 🟢 done

## 交付
- Protocol: `PermissionScope` / `PermissionBucket` / `PermissionsConfig` + 10 frames（list / add / remove / set-default / add-dir / remove-dir + ack/响应），注册进 `[config-frames]` discriminatedUnion。
- Host: `packages/host/src/permissions.ts` 读写 `~/.claude/settings.json`、`<cwd>/.claude/settings.json`、`<cwd>/.claude/settings.local.json`，不存在视为空，写入只改 `permissions` 节保留其他键。所有 handler 在 `[config-handlers]` 后追加；变更后 `broadcastPermList()` 广播到所有 ws。规则校验 trim/空串/>1KB/换行。
- Web: `packages/web/src/PermissionsTab.tsx`（未改 ConfigView）—— 三 scope section，每个含 defaultMode 5 选项栅格（user/project 显示，local 不显示）、additionalDirectories 列表+添加、allow/deny/ask 三列 bucket 面板（含规则 tool(pattern) 解析显示 + placeholder 提示）。
- FEATURES.md 进度行 + 变更日志已更新。

## 校验
`pnpm -F @rcc/protocol typecheck` 和 `pnpm -F @rcc/web typecheck` 全绿。`@rcc/host` 的 typecheck 仅报 Agent A `hooks.ts` 的错误,与本 batch 无关。
