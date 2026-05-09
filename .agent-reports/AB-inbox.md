# AB-inbox — Inbox 活动流

**Host**
- `activity.ts`: `ActivityFeed` rolling 200 条(splice shift)+ 单条 ≤4KB 自动截断(summary/subjects/message/notes);`append(item)` 广播 `activity.append` + 本地保留;`resolveApproval(id)` 找到对应 pending 改 `status:"resolved"` 再 append 覆盖。
- `index.ts` 集成点各一行: `broadcastApproval` 钩 `approval.request` / `approval.cleared`;`attachApprovalWatcher` CLI + SDK 两路 `onExit` append `session_exit`;`attachGitWatcher.onCommits` append `commits`(前 10 条 subject);`installCrashHandler` 回调里 append `crash`;启动 + 每 6h 一次 `probeUpdate()` 对比 `lastAnnouncedUpdate` 去重后 append `update`。新 handler: `activity.list.request`。

**Protocol**
`ActivityItem` zod discriminated union(approval/commits/crash/update/session_exit)+ `activity.list.request` / `activity.list` / `activity.append` 三帧。

**Web**
- `InboxView.tsx`: `createInboxStore(client)` 订 `activity.list/append`,connected 时自动请求拉取,`localStorage rcc:inbox:lastOpenedAt` 存上次打开;`unread` memo 按时间戳筛。
- `InboxView` 组件: 右侧 420px 抽屉(移动全屏),tabs 全部/审批/提交/系统,按时间倒序,item 点击 approval/commits/session_exit → `setActiveSid(sid)` + close;update 关闭让用户看 VersionBadge;crash alert。
- `App.tsx`: 顶栏 📥 按钮带 accent 未读 badge(99+ 截断),`inboxStore.dispose()` 并入 `onCleanup`。

**验证**: `pnpm -r typecheck` 全绿。
