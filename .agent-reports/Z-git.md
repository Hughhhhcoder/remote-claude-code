# Z-git — Git 集成

**Host**
- `git.ts`: `runGit` (execFile, 2s timeout, 30KB stdout/stderr cap)、`getStatus` (branch/dirty/ahead/behind/head, 非 git dir 返 null)、`getHead`、`getLogRange`、`isReadOnlyGitArgs` 白名单 (status/diff/log/branch/blame/show/rev-parse/...)。
- `git-watcher.ts`: 5s poll,状态变化时触发 `onStatus`;HEAD 变化时 diff 出 commits 触发 `onCommits`,timer 自 unref。
- `index.ts`: `attachGitWatcher` 挂进 boot / `session.new` / `session.resume` 三路径,广播 `git.status`/`git.commits` 帧,commits 同时 append 系统 chat "✓ N commits during this session"。新 handler:`git.status.request`(当场 getStatus 回复)+ `git.exec.request`(仅允许只读子命令,结果 broadcast `git.exec.result` 并 append code 段 chat)。
- `commands.ts`: builtin 追加 `git:status|diff|log|branch` 四条,用户可 pin。

**Protocol**
新增 `GitStatusData` / `GitCommitInfo` + 五帧:`git.status.request`、`git.status`、`git.commits`、`git.exec.request`、`git.exec.result`。

**Web**
- `App.tsx`: `gitBySid` 订阅 `git.status`;`BranchChip` (分支名 + 脏黄点 + ↑↓ ahead/behind) 挂 SessionRow + session header;`sendCommand` 拦截 `/git:sub` 走 `git.exec.request`;hello/list/created 时触发 `git.status.request`。
- `MobileKeyBar.tsx`: 相同 `git:*` 前缀识别。

**限制**
写操作(commit/push 等)一律不暴露,用户仍可从 pty 手动跑;execFile 无 shell、超时 2s、输出 30KB 截断;非 git 仓库静默返 null,widget 自动隐藏。

**验证**: `pnpm -r typecheck` 全绿。
