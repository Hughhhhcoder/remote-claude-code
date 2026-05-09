# AF — Workflows 工作流

## 交付

- `packages/protocol/src/index.ts`: `Workflow` + `WorkflowStep` zod(prompt/slash/git/wait) + 5 帧 `workflow.list(.request)/save/saved/remove/removed`。
- `packages/host/src/workflows.ts`: `WorkflowStore` 读写 `~/.rcc/workflows.json` (0600, atomic); 32KB/条, 50 步硬上限。
- `packages/host/src/index.ts`: 启动 `workflows = await WorkflowStore.load()`,3 个 handler(list.request/save/remove), mutation 后 `broadcastFiltered` `workflow.list`。
- `packages/web/src/workflow-runner.ts`: `createWorkflowRunner(client)` 客户端执行器 — 链式 `setTimeout`, 默认 500ms 间隔, `wait` 步用 `seconds*1000`; `state` 信号暴露 `{workflow,sid,index,total}`; `stop()` 清 timer, `onCleanup` 自动清理。
- `packages/web/src/WorkflowsTab.tsx`: 列表 + 新建/编辑 modal(按 kind 切换输入控件,步骤可增删上下移动),单条有"▶ 运行 / ✎ / 🗑"。
- `packages/web/src/ConfigView.tsx`: 加第 7 个 tab `Workflows`。
- `packages/web/src/App.tsx`: 创建 runner,挂 `<WorkflowRunBar>` 在顶栏下(teal 进度条 + 中止),传 `onRunWorkflow` 给 ConfigView。

## 关键简化(已文档化)

- **不等 Claude 响应完成**:runner 只按固定 delay 发下一步,长任务请插入 wait step。UI 文案和 FEATURES.md 条目都写明。
- `prompt`/`slash` 走 `client.write(sid, ... + "\r")`; `git` 走 `git.exec.request`; `wait` 纯 delay。
- 执行整体在客户端,host 只做 CRUD。

## 验证

- `pnpm -r typecheck` 全绿。
- 未触碰 e2e / context 相关文件。
