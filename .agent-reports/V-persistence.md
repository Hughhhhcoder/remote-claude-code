# V-persistence — 会话持久化跨重启

**新文件**
- `packages/host/src/persistence.ts` — saveSnapshot/loadAllSnapshots/deleteSnapshot/purgeAll/purgeStale + `Debouncer`. 每 session 一个 `~/.rcc/sessions/<sid>.json` (0600, tmp→rename 原子写), 硬上限 1MB (超先砍 chat 再丢 ringTail).
- `.agent-reports/V-persistence.md`

**改动**
- `session.ts`: Session/SdkSession 构造接受 id/createdAt/initialChat/initialRingTail, 暴露 `ringTail()` + `lastActiveAt`. 新增 `DeadSession` 类(AnySession 结构子集, replay 输出存档 tail 作 seq=0, write/resize no-op). SessionRegistry 去掉 30s 自动删除, 新增 add/remove.
- `index.ts`: boot 时 purgeStale + loadAllSnapshots → DeadSession 注入; 仅空注册表时才 spawn bootstrap. `wirePersistence(session)` 挂 chat.onMessage/onUpdate/pty.out debounced 500ms + exit 立即 flush. 新增 `session.resume` 处理: 复用原 id/cwd/driver/initialChat 建 live, broadcast `session.resumed`+`session.list`. `session.close` 删文件. SIGINT 前 flush 全部 debouncer.
- `protocol/index.ts`: 新增 `SessionResume`/`SessionResumed` 帧,加入 discriminated union.
- `admin.ts`: `sessions` / `sessions --purge` / `sessions --stale` 三命令.
- `client.ts`: `resumeSession(sid)`.
- `App.tsx`: 处理 `session.resumed`, `onResumeSession` 乐观改 status, SessionRow 存档时多 💾 chip + hover "重开" 按钮.
- `FEATURES.md`: M6 新行 + 变更日志.

**约束符合**
- `pnpm -r typecheck` 全绿 (3 包)
- 未触 observability/theme 文件
- 不写入 sharedKey/keys/trust 到 session 存档
- 原子 tmp→rename, 每 session ≤1MB
