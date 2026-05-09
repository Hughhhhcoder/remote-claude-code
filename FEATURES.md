# RCC — Features Tracker (v0.2 "Claude UX" arc)

> **状态**: v0.2 ongoing · v0.1.2 已发布(上个 arc 收尾产物)
> **目标**: 前端重设计 · 全端丝滑 · 继承 Claude.ai 设计语言 · 消除桌面/手机两套代码
>
> 每批 5 个 agent 并行 · 完成后 typecheck + build + 手测 → 提交 → tag minor → 自发下一批 · 用户说停才停。

---

## 设计锁定(Design Spec · locked 2026-05-09)

### 颜色 — 参考 claude.ai(有据)

**Light mode**(默认):
```
--bg-page          #eeece2   /* 暖米色底,不是白 */
--bg-surface       #faf9f6   /* 卡片 / 输入框内底 */
--bg-surface-2     #f5f3ec   /* 嵌套更深一层 */
--border-subtle    #e4e0d4
--border-strong    #d4cfc0
--text-primary     #3d3929   /* 暖深褐,不是 #000 */
--text-secondary   #6b6558
--text-muted       #8f8a7c
--accent           #da7756   /* Claude terra cotta */
--accent-hover     #bd5d3a
--accent-bg        #fdf1ea   /* 极淡的 peach,用于 selected 背景 */
--success          #3d8b5e
--warn             #c88a2e
--danger           #b84838
--code-bg          #f3f1e8
--user-bubble      #f0ece0   /* 用户消息底 */
--assistant-bg     transparent /* assistant 消息无底 */
```

**Dark mode**(对应):
```
--bg-page          #1a1816
--bg-surface       #24221e
--bg-surface-2     #2e2b25
--border-subtle    #36332c
--text-primary     #e8e4d6
--text-secondary   #a8a290
--text-muted       #6f6b5e
--accent           #e08968   /* 暗下稍微提亮 */
--accent-hover     #d47855
--code-bg          #2a2822
--user-bubble      #2e2b25
```

### 字型

```
--font-serif: "Charter", "Bitstream Charter", "Sitka Text",
              Cambria, Georgia, "Times New Roman", serif;
--font-sans:  "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
--font-mono:  "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace;
```

- **正文 + chat**: `--font-serif` 15px/1.65(Claude 对话本体用 serif,核心差异)
- **UI chrome**(按钮 / sidebar / header): `--font-sans` 13-14px
- **代码 + 命令 + session id**: `--font-mono` 12-13px
- **字重**: 400 / 500 / 600 三档,不用 700

### 间距 · 半径

```
--space: 4px 基数 — 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64
--radius-sm: 6px     (chip, small button)
--radius-md: 10px    (input, card)
--radius-lg: 14px    (message bubble, modal)
--radius-xl: 20px    (composer pill, mobile sheet)
```

### 动效

- 默认过渡 `150ms cubic-bezier(0.4, 0, 0.2, 1)`
- 输入框 focus 用 `box-shadow` 扩张而非 border 变色
- 抽屉 `220ms ease-out`
- 消息出现用 fade-in + 轻微 translate-y,不用 scale
- 所有动画遵守 `prefers-reduced-motion: reduce` → 0ms

### 组件基调

- **消息**: user 靠右,圆角 `--radius-lg`,背景 `--user-bubble`;assistant 靠左满宽,无气泡底,仅左侧 24px gutter 放一个 🔶 头像。代码 block inline `--radius-md` `--code-bg` 底。
- **Composer**: 单行圆角 pill(`--radius-xl`),auto-grow 最多 8 行,内嵌 + / 🎤 / ➤ 三个圆形图标按钮。送出用回车(mobile:回车键也是送出,没有 shift+enter)。
- **Sidebar**: 宽 280px(不是 240),暖米色底,session 卡片间距 4px,active 用 `--accent-bg` 底 + 左侧 2px 竖条。
- **Primary button**: 圆角 `--radius-md`,`--accent` 底白字,hover `--accent-hover`,48px 高(桌面 36)。
- **对话区域**: 最大宽 760px 居中(不是占满),页面左侧留充足空白。

---

## Migration 阶段(Agent 编排)

每阶段结束 → `pnpm -r typecheck` + `pnpm build` + 冒烟 → commit + tag patch/minor → 下一批。

### Phase 1 · Tokens + Primitives(5 agent)
- **P1-A**: `src/tokens/` (tokens.css + theme.ts + prefers-color-scheme 默认 + localStorage 覆盖);改 `tailwind.config.js` 映射 semantic tokens
- **P1-B**: `src/primitives/` — Button / IconButton / Chip / Card(4 个)
- **P1-C**: `src/primitives/` — TextInput / Textarea / Toggle / KeyHint(4 个)
- **P1-D**: `src/primitives/` — Dialog / Popover / Spinner / EmptyState(4 个)
- **P1-E**: `/dev/primitives` 预览页 + 字体加载(@font-face local JetBrains Mono / Charter fallback)+ `index.css` 全局 serif 应用

**验收**: `/dev/primitives` 在 light/dark 两模式下渲染全部 12 基元,桌面 build 不 regression。

### Phase 2 · Shell + 响应式布局(3 agent)
- **P2-A**: `src/shell/AppShell.tsx`(CSS grid + container queries,桌面 1fr + 300px / 窄屏 stacked)
- **P2-B**: `src/shell/Sidebar.tsx` 抽离 + `SessionRow` / `ProjectHeader` 迁入 `src/sessions/`
- **P2-C**: `src/shell/TopBar.tsx` + `src/shell/TabNav.tsx`(窄屏显示)+ `useMediaQuery.ts` 替代 `useIsMobile`

**验收**: 375 / 768 / 1280 三个宽度切换无 JS 分支 bug;现有所有 modal 仍能打开。

### Phase 3 · Stores 拆分(2 agent · App.tsx 瘦身)
- **P3-A**: `src/stores/{sessionsStore,uiStore,projectsStore,peersStore,approvalsStore}.ts`
- **P3-B**: App.tsx 瘦身到 < 200 行,只留 root provider + router 分支

**验收**: 现有功能零回归;App.tsx `wc -l` < 200。

### Phase 4 · Chat 表面重写(4 agent · 最硬核)
- **P4-A**: `src/chat/ChatPane.tsx` + `ChatHeader.tsx` + `MessageList.tsx`(含虚拟化 + autoscroll + jump-to-latest)
- **P4-B**: `src/chat/blocks/` — TextBlock / CodeBlock / DiffBlock
- **P4-C**: `src/chat/blocks/` — ToolCallBlock(tool_use + tool_result 折叠)+ ApprovalBlock 内嵌
- **P4-D**: `src/chat/Composer.tsx`(新输入栏,pill 样式,inline voice / inject / prompt 展开 / slash 面板)+ `streaming.ts` 合并逻辑

**验收**: 四个核心场景 parity checklist
1. CLI session 发消息 → user 气泡立即 echo
2. SDK session 流式 → text_delta 平滑追加
3. tool_use 出现 → 折叠卡片,点击展开 → tool_result 尾随
4. 高风险 approval → 行内红卡 + 按钮,批准后 callback 正确

### Phase 5 · 功能面板迁移(并行 3 agent)
- **P5-A**: `src/files/` + `src/notebook/`(响应式:桌面右栏,mobile 全屏 tab)
- **P5-B**: `src/settings/SettingsPane.tsx` + `settings/tabs/` 子目录(Commands/Hooks/MCP/Permissions/Plugins/Prompts/Skills/Subagents/Starters/Workflows 10 个 tab 迁到新样式)
- **P5-C**: `src/approvals/` + `src/inbox/` + `src/peers/` + `src/devices/`

**验收**: 每个旧的 xxxTab.tsx / xxxView.tsx 都有新家,旧文件 delete 清理。

### Phase 6 · 清理 + 发 v0.2.0
- 删 `src/mobile/` 整个目录(7 文件)、`MobileKeyBar.tsx`、`useIsMobile.ts`、ad-hoc `.scrollbar` CSS
- 删 `TerminalView.tsx`?**保留**桌面 toggle(power user 仍需要);mobile 永久不渲染
- 删 `ContextInjector.tsx` 如果只 Composer 用
- CommandPalette 视觉更新(serif 字 + 暖色)
- PairingView 同步设计语言
- 打 v0.2.0 tag,发 release,写 migration notes

---

## Agent 规则

1. **每 agent 独占文件**。同批内文件集合不相交。
2. **不改 packages/protocol / packages/host**(协议冻结,本 arc 只动 web)。
3. 完成前必须自测 `pnpm -F @rcc/web typecheck`。报告里列出改动文件 + 行数。
4. 保持 8.5KB/s ws 稳态不 regress(sidebar 重渲染过度曾是 v0.1 痛点)。
5. 禁止引入新 npm 依赖未经汇报(Solid / Tailwind / Vite / xterm / Monaco / yjs / libsodium 是既定栈)。

## 版本计划

- Phase 1 完成 → v0.1.3
- Phase 2 完成 → v0.1.4
- Phase 3 完成 → v0.1.5
- Phase 4 完成 → v0.1.6
- Phase 5 完成 → v0.1.7
- Phase 6 完成 → **v0.2.0**(UI arc done)

---

## 不在本 arc 的范围

- 新协议 frame / 新 host 功能 / 新 plugin 能力
- 桌面 Electron 壳
- 多语言 i18n 扩展(zh/en 现状保留)
- 国际化新增(Stripe / SSO 之类不做)

## 历史 arc 引用

v0.1.0–v0.1.2 的完整功能矩阵详见 git tag `v0.1.2` 下的 README.md 及 `docs/architecture.md`。本文件不再重复列举 57 个 v0.1 功能。
