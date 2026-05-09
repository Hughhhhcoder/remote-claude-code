# Agent A · M4 Batch 1 · Skills 管理

## 完成项

- `packages/host/src/skills.ts` — listSkills / toggleSkill / readSkillContent / writeSkill / deleteSkill
  - 读取 `~/.claude/skills` (scope=user) 和 `<cwd>/.claude/skills` (scope=project)
  - 启用/禁用通过目录前缀 `_disabled_` 实现（重命名）
  - 单个坏 SKILL.md 不会阻塞整个列表（try/catch per entry）
  - id 格式 `<scope>:<name>`
- `packages/protocol/src/index.ts` — 新增 `skill.list.request` / `skill.list` / `skill.toggle` / `skill.read.request` / `skill.read` / `skill.save` / `skill.delete` / `skill.deleted`，全部放在 `[skills]` 标记 block 内；Frame union 在 `[config-frames]` 标记之后加入（与 mcp 相同位置，未触碰 B/C 的代码）
- `packages/host/src/index.ts` — 在 `[config-handlers]` 标记之后、`mcp.list.request` 之前加入 5 个 skill.* case
- `packages/web/src/SkillsTab.tsx` — 卡片 grid、filter chips（全部/已启用/已禁用/项目/用户）、搜索、toggle、查看器（只读 textarea）、新建（可编辑 textarea + scope/name 输入）、删除、试运行（往 activeSid 发送中文提示）、Marketplace 占位
- `packages/web/src/ConfigView.tsx` — 去掉 skills 的 PlaceholderTab，换 `<SkillsTab>`；新增 `activeSid` prop（传给 SkillsTab 供试运行用）
- `packages/web/src/App.tsx` — 传 `activeSid` 给 `<ConfigView>`
- `FEATURES.md` — M4 表格中 "Skills 管理" 行改为 🟢 并写清实现要点

## 关键决策

- **启用/禁用实现方式**：目录前缀 `_disabled_` + `fs.rename`。理由：Claude Code 不提供首选配置关闭 skill 的官方方式，移动目录是最稳妥——skill 的加载器按 "SKILL.md 存在的目录名" 识别，前缀后的目录不再匹配。
- **id schema**：`<scope>:<name>`。单值字符串比对象清爽，scope 就两个值。
- **试运行文案**：往活跃 session 写 `请使用 skill: <name>\n` 而不是硬敲 skill 触发器——claude 的 skills 是 LLM 自主选用的，显式提示就能触发。
- **editor 仍是 textarea**：v1 只做只读查看 + 创建时的纯文本编辑。Monaco 等到 M4 batch 2 的文件树再引。
- **frame 插入位置**：`[config-frames]` 标记注释写的是 "after this marker"（而非用户 prompt 说的 "之前"）。遵循源文件注释，放到 marker 之后、McpListRequest 之前。Agent B/C 的代码完全未动。

## 踩到的坑 / 观察

- 写本文件时 Agent B 和 Agent C 的代码已合并进 `index.ts`（imports 增加了 `commands.ts` / `subagents.ts`），这是并行任务必然发生的情况。我只编辑了 `[config-frames]` / `[config-handlers]` 标记锚点附近，没碰他们的部分。
- 真实 `~/.claude/skills/` 下的 SKILL.md frontmatter 确实是 `name` + `description` + 可选 `tags` / `version` / `allowed-tools`。frontmatter 解析器（已有的 `frontmatter.ts`）足够用。
- `tags` 在 frontmatter 里可能是 `[a, b, c]` 数组语法，现有的 parser 只返回原始字符串——我在 `skills.ts` 里加了 `parseTags` 把 `"[a, b]"` / `"a, b"` 都展开成数组。
- `parseFrontmatter` 已经支持 `description: >` 折叠 scalar，所以像 geo-content 那种长描述能正确提取到单行。

## Remaining questions

- **内置 skill 识别**：mockup 里有"内置"chip 用蓝色。但实际 `~/.claude/skills/` 里全部是用户级目录（包括 claude-plugins 安装的），CLI 没有"内置"概念，所以我只保留 "用户" / "项目" 两个 scope chip。如果需要把 plugin 目录（`~/.claude/plugins/marketplaces/*/plugins/*/skills/`）也列出为另一个 scope，可以未来加 `plugin` 第三个值。
- **试运行**的最佳姿势：目前是发一行中文文本。更严谨的是用 `/skill <name>` slash command（需要确认 Claude Code 支持），但没找到官方文档确认，先保持简单。
- **多设备同步广播**：当前 skill.toggle/save 完成后只对当前 ws 回传 `skill.list`。其他设备需要手动刷新才能看到变化。如果要实时同步，应 `broadcast` 而非 `send`——留到 M5 CRDT 时统一处理。
- **Marketplace** 按钮只是占位，未实现浏览社区 skills 的真实 UI。

## 验证

- `pnpm -r typecheck` 全绿 ✓
- 逻辑路径：空列表时渲染提示、有 skill 时正确展示卡片、toggle 后 host 实际 rename 目录、+ 新建写 SKILL.md 到选定 scope 目录、删除走 `rm -r`。
