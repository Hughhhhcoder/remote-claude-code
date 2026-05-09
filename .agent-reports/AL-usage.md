# AL · Token/Cost 统计

**Scope**: per-session token + cost accumulation for SDK-driver sessions, surfaced to the observability panel and sidebar.

## 实现
- Protocol: 新 `SessionUsage` 类型、`SessionMeta.usage?`、`usage.session { sid, usage }` 帧。
- Host: 新增 `packages/host/src/usage.ts` (UsageTracker 单例, record/get/reset/hydrate/setBroadcast),4 位小数精度。`sdk-session.ts` `onResultMessage` 读 `usage.*` + `total_cost_usd` 喂 tracker,`meta()` 注入 usage。`persistence.ts` SessionSnapshot 加 usage 字段(save/load 双向 + meta 备份)。`index.ts` 在 `metrics.bindRegistry` 后 `usage.setBroadcast` → `usage.session` + `session.list`,snapshot 加载时 `usage.hydrate`,`sessionMetaWithSummary` 合并 usage。
- Web: 新 `UsageChip`(App.tsx,↑N ↓N · $X + hover 详情),SessionRow + session header 渲染。`MetricsPanel` 聚合 SDK 总 token/cost 段。`ChatView` SDK session 右上角浮动 `N turns · $X` 角标,CLI session 条件隐藏。

## 约束合规
- CLI session `usage` 始终 undefined,UI `<Show when={usage}>` 条件渲染。
- Cost `Math.round(x * 10000) / 10000` 锁 4 位精度。
- 未改 starters / federation 文件。
- `pnpm -F @rcc/host typecheck`, `pnpm -F @rcc/protocol typecheck`, `pnpm -F @rcc/web typecheck` 全绿(batch 的预存 starters 错误未触及我方改动)。
