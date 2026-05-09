# U-projects · 多项目工作区

M4 batch 3, Agent C.

## 要点

- `~/.rcc/config.json` 新增 `projects` 段（保留其他 key)；空/缺 default 时自动用 `RCC_CWD || cwd` 生成默认项目（`isDefault: true`，不可删）。
- Protocol: `ProjectMeta`, `PROJECT_COLORS`, 11 条 `project.*` frame；`SessionMeta.projectId?`, `SessionNew.projectId?`, `Hello.projects?`，全部 optional 向后兼容。
- `packages/host/src/projects.ts` `ProjectStore` — list/getById/getDefault/findByCwd/create/remove/rename/update，每次 mutation 持久化 + emit。host handler 通过 `broadcastProjectList()` 推到全部客户端。
- `session.new` 绑定优先级：`projectId` → `cwd` 匹配 → `default`。`Session` 带 `projectId` 字段，`meta()` 带出（也补了 `driver:"cli"` 避免 SDK 字段缺失）。
- Web: `NewProjectModal`（name/cwd/5 色选择）和 `ProjectsModal`（列表 + inline edit + delete，默认项目禁用删除）。`NewSessionModal` 加项目下拉；`App.tsx` sidebar 改成两级（项目 header + 会话列表），按 `projectId` 分组，无 projectId 归 default；项目 header 可折叠，hover 出 `+` 在该项目下新建 session；顶部 `+ 新建项目` 按钮和 `管理` 入口。

## 类型检查

`pnpm -F @rcc/protocol typecheck`, `@rcc/host`, `@rcc/web`（除 MarketplaceView.tsx 来自并行 agent 未跟踪文件）全部通过。
