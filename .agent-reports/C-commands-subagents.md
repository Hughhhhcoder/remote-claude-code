# Agent C — Slash Commands + Subagents

M4 Batch 1 · 2026-05-09

## 交付

### 后端 (packages/host)
- `src/frontmatter.ts` — 手写 YAML frontmatter parser/serializer（无依赖，仅支持 Claude Code .md 实际用的子集：标量、`>` 折叠、`|` 保留换行）
- `src/commands.ts` — `listCommands` (内置 + `~/.claude/commands` + `<cwd>/.claude/commands`) · `readCommand` · `saveCommand` · `deleteCommand` · `pinCommand` · `reorderPinned` · `loadPinned`。pinned 状态存 `~/.rcc/pinned-commands.json` (mode 0600)。内置列表硬编码 10 个常见 slash (`clear`/`help`/`init`/`review`/`security-review`/`simplify`/…)。
- `src/subagents.ts` — `listSubagents` · `readSubagent` · `saveSubagent` · `deleteSubagent`。解析 frontmatter 的 `name`/`description`/`model`/`tools`（兼容 `allowed-tools`）。

### 协议 (packages/protocol)
在 `[commands]` 标记处加：`cmd.list.request/cmd.list`, `cmd.read.request/cmd.read`, `cmd.save/cmd.saved`, `cmd.delete/cmd.deleted`, `cmd.pin`, `cmd.reorder-pinned`, `cmd.pinned`。
在 `[subagents]` 标记处加：`subagent.list.request/subagent.list`, `subagent.read.request/subagent.read`, `subagent.save/subagent.saved`, `subagent.delete/subagent.deleted`。
Hello 帧新增可选 `pinnedCommands: string[]`。全部 frame 已追加到 `Frame` discriminated union 尾部（没有重排 Agent A/B 的帧）。

### Host 路由 (packages/host/src/index.ts)
在 `[config-handlers]` 之前插入了 9 个 case 块。新增模块级 `pinnedCommandsCache` (启动时 `await loadPinned()`)。命令/subagent 变动时广播 `cmd.list`/`subagent.list` 给全部 clients，pinned 变动时广播 `cmd.pinned`。Hello 帧现在带当前 pinned id 列表。

### UI (packages/web)
- `CommandsTab.tsx` — 按 mockup 的表格布局（6 列：图标/name/description/source/toggle/删除）。顶部 filter chips（全部/已钉/项目/用户/内置）+ 搜索框 + `+ 新建命令` 按钮。内置命令只读、只能 pin，不能编辑/删除。底部有"聊天快捷按钮预览"。编辑 modal 支持 scope 切换（项目/用户）、description、body（支持 markdown / $ARGUMENTS）。
- `SubagentsTab.tsx` — 卡片 grid（2 列）。每张卡片显示图标（按名字 hash 选）、scope chip、模型/工具/调用次数。编辑 modal 有 scope、名称、description、model 下拉、tools 文本框、system prompt。
- `ConfigView.tsx` — `commands` 和 `subagents` 两个 tab 的占位被替换成真实组件。
- `client.ts` — 新增 `pinnedCommandIds: string[]` 字段，hello + `cmd.pinned` 帧都更新它。
- `App.tsx` — 原先硬编码的 `PINNED_COMMANDS` 常量改成响应式：订阅 `cmd.pinned` 和 `cmd.list`，用 `createMemo` 拼出 `CommandSummary[]` 给快捷按钮条。列表为空时回退到 `FALLBACK_PINNED`（4 个内置）。按钮点色彩分 project=橙 / user=青 / builtin=紫，和 CommandsTab 的配色一致。

## 验证
- `pnpm -r typecheck` 全绿 (3 packages)
- 未动 Agent A 的 `skills.ts`/`SkillsTab.tsx`、Agent B 的 `mcp.ts`/`McpTab.tsx`
- 未重排 Frame union 中已有帧
- frontmatter parser 针对你真实 `~/.claude/agents/*.md` 的 `>` 折叠 + `allowed-tools` 字段测过

## 已知行为
- `cmd.list` 广播用 `DEFAULT_CWD`，多会话并存时所有客户端看到的都是 host 默认 cwd 下的 project 级命令（这和 skills/mcp 模块当前的做法一致；未来按 activeSid 切换 cwd 时一起升级）
- pinCommand 不做"id 必须存在于命令列表"的校验，方便离线/乱序；UI 端如果拿不到 meta 会显示降级信息（scope 从 id 前缀解析）
- subagent 调用次数占位为 "—"（host 还没有 invocation tracking）