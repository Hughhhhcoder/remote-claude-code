# AO · Audit Log (Batch 14 B)

- **host/audit.ts** 新增 AuditLog 单例,append-only JSONL → ~/.rcc/audit.jsonl(0600);按日 rotate `audit.jsonl.YYYY-MM-DD` + 30 天 retention;启动 hydrate 最近 500 条到 rolling memory;write 走 fire-and-forget 序列化 queue 不阻塞,单 entry details 超 8KB 自动 preview 截断。
- 集成点每处一行 `audit.write(...)`:pair.claim(onClaimed 回调)→ `auth.pair`;device.revoke/rename → `auth.revoke|rename`;session.new/resume/close;share HTTP 创建/撤销 → `share.new|revoke`;mcp.add/remove;hook.write/delete;skill.toggle/save/delete;perm.add/remove/set-default;starter.save/remove;peer.add/remove;installCrashHandler 回调 → `crash`;probeUpdate 首次发现新版本 → `update.available`。
- Protocol `AuditEntry` + `audit.query.request` / `audit.entries`(authenticated only,share 守卫天然拦截所有 mutation 帧,audit.query 不在 share 白名单)。
- Web `AuditView.tsx` → ConfigView 第 11 tab(📜);kind 下拉 + 时间范围 + 关键词过滤;kind 按前缀(auth/session/share/config/peer/crash/update)染色;点击展开 details JSON。
- `pnpm -r typecheck` 全绿。
