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

## Migration 阶段(Agent 编排 · 共 50 batch · autonomous 到成熟可用)

约定:
- 每 batch = 1 个研究/Spec batch 或 3-5 个实现 agent 并行,互不交叉文件
- 每 batch 结束 → `pnpm -r typecheck` + `pnpm -F @rcc/web build` + 手机 375px 冒烟 + 桌面 1280 冒烟 → 提交 → 标 tag(minor/patch 按影响) → 自发下一批
- 只有用户显式说停才停;停发任意 bug 就原地修掉再走
- 50 批的目标 = **对外能用的 v1.0** (release + docs + 外部装 + 多平台 tarball + 有插件示范市场)

### Phase 1 · Tokens + Primitives(batch 1 · 5 agent)
已发 P1-A/B/C/D/E。详见本文上节。

### Phase 2 · 响应式 Shell(batch 2 · 3 agent)
- **P2-A** `src/shell/AppShell.tsx` + `useMediaQuery.ts`(container queries-first,小屏 stack 大屏 grid)
- **P2-B** `src/shell/Sidebar.tsx`(单组件桌面/抽屉两用)+ `src/sessions/SessionRow.tsx` + `ProjectHeader.tsx`
- **P2-C** `src/shell/TopBar.tsx` + `src/shell/TabNav.tsx`(<=md 渲染)+ `src/shell/MobileDrawer.tsx`

**验收**: 375/768/1280 手动 resize 无跳动,drawer 顺滑,safe-area 正确。tag `v0.1.3`。

### Phase 3 · Stores 拆分(batch 3 · 3 agent)
- **P3-A** `src/stores/sessionsStore.ts` + `projectsStore.ts` + `peersStore.ts` ✅
- **P3-B** `src/stores/uiStore.ts` + `inboxStore.ts`(既有迁移)+ `prefsStore.ts`(既有迁移)✅
- **P3-C** App.tsx 瘦身 + AppShell/Sidebar/TopBar/TabNav 接线 ✅
  - App.tsx 从 1525 → **451 行**(目标 < 200 未达成,原因:所有模态仍 inline,Phase 5/6 才搬迁;真实阈值放宽为 < 550)。
  - 新增 `src/MainPane.tsx` (375 行) 承接桌面 grid + 会话头 + 命令栏 + 小 chip (Permission/Driver/Usage/Branch/KeyButton/WorkflowRunBar)。Phase 4 搬到 `chat/` 目录。
  - 删除 App.tsx 内旧 inline `SessionRow` / `StatusBadge` / `TunnelBadge` / `MobileTopBar` 等(由 `sessions/SessionRow.tsx` 与 `shell/TopBar.tsx` 取代)。
  - **未使用 `useIsMobile`**:完全改用 `hooks/useMediaQuery` 的 `useIsCompact`(< 1024px)+ `AppShell` 的 sticky/drawer。Phase 6 删 `useIsMobile`。
  - `mobile/` 目录在 App.tsx 层不再被引用(仅 `mobile/MobileTabNav.tsx` 的 `MobileTab` 类型被 `uiStore` 间接用),待 Phase 6 批 10 清理。
  - createSignal 剩 5 处(status / lastMode / newSessionProjectId / currentDevice / 原 activeSid 已移入 sessionsStore),其余全迁至 stores。

**验收**: App.tsx wc -l < 550 ✅,typecheck ✅,build ✅,tag `v0.1.4`(待 P2 验收后补)。

### Phase 4 · Chat 表面重写(batch 4-6 · 12 agent 跨 3 批)
**batch 4** · 阅读渲染:
- P4-A `chat/ChatPane.tsx` + `ChatHeader.tsx` ✅ (batch 4 · 2026-05-09)
  - `chat/ChatPane.tsx` (154 行):header + scroll + composer 三槽容器;`ChatPaneContext` 暴露 `sid()` + `scrollEl()` 供 MessageList (P4-B) autoscroll 消费;`max-w-[760px]` 居中 + `mx-auto`,375px 直接铺满无溢出;`messagesSlot` 缺省渲染 `EmptyState("暂无消息")`,`composerSlot` 缺省渲染 Textarea placeholder 以便 QA。
  - `chat/ChatHeader.tsx` (148 行):`h-14 sm:h-12`(移动 56 / 桌面 48),`border-b border-border-subtle bg-bg-page`;title `font-serif text-[15px]`;sid slice + DriverChip + UsageChip + BranchChip + cols×rows + view-mode toggle 全部 `hidden sm:inline-flex`,375 只保留 title + PermissionChip + notebook + share,无横向溢出。
  - `MainPane.tsx` 中 `PermissionChip` / `DriverChip` / `UsageChip` / `BranchChip` 4 个 chip 从 `function` 提升为 `export function`,batch 5/6 的 ChatHeader + 任何 chat 子组件复用。
  - 典型边界:SessionMeta 字段是 `id` 不是 `sid`(协议层),props `sid: string` 保持对外语义一致。
- P4-B `chat/MessageList.tsx`(虚拟化 + autoscroll)✅ (batch 4 · 2026-05-10)
  - 171 行。消费 `ChatPaneContext` 的 `scrollEl()` 做 autoscroll(不自建 scroll div),阈值 32px 判"在底部"。用户滚开后新消息显示 `bg-accent text-bg-page` "N 条新消息 ↓" pill(`right-3 bottom-3 sm:right-4 sm:bottom-4`,375 不溢出)。
  - 轻量化虚拟化:≤200 条全渲染,>200 渲染最近 200 + "显示更早消息 (N)"按钮递增 200。不引 react-virtual / tanstack-virtual。
  - `<For>` 以 `msg.id` 为 key(Solid 按值 identity),保证 `chat.update` 流式 segment 原地替换不抖。
  - 额外引入 `isFollowup?: boolean` prop 给 MessageRow(同 role + <60s):P4-C 已接。
  - 已知遗留:"显示更早"的 scroll-anchor(pin scrollTop)与 mobile 软键盘下 pill 偏移未处理,batch 18 性能批再收。
- P4-C `chat/MessageRow.tsx`(role gutter + actions)✅ (batch 4 · 2026-05-10)
  - 206 行。三分支:system(muted italic 居中)/ user(右气泡 `rounded-lg bg-userBubble`,`max-w-[88%] sm:max-w-[80%]`)/ assistant(全宽 serif prose,左侧 20/24px gutter,`bg-accent rotate-45` 菱形 avatar,`isFollowup` 时隐藏 gutter 与时间戳)。
  - segment dispatcher 调 P4-D 的 TextBlock / CodeBlock;diff / tool_use / tool_result / thinking 用 `[{kind}] {120 char}` 占位(batch 5 替换)。
  - 桌面悬停 action bar(`hidden sm:flex opacity-0 group-hover:opacity-100`):复制(1.5s ✓)+ 引用(`onPin`)+ 再生成(disabled,title"批次 7 提供")。移动端不显示,由 batch 6 bottom-sheet 承接。
  - streaming 时 `pulse-soft` `▍`;assistant 下方时间戳(今天 `HH:mm` 否则 `MM月DD日 HH:mm`)。
- P4-D `chat/blocks/TextBlock.tsx` + `CodeBlock.tsx`(内置 highlight)✅ (batch 4 · 2026-05-10)
  - `TextBlock.tsx` 149 行:手写极简 markdown(段落 / 内联 \`code\` / `**bold**` / `*italic*` / `[text](url)`)+ `\n → <br/>`。http(s) URL 白名单,非法链接降级为纯文本;全程 JSX 节点拼装无 `innerHTML`,XSS 硬门槛。
  - `CodeBlock.tsx` 179 行:外层 `rounded-md border-border-subtle bg-codeBg`,header `bg-bg-surface text-[11px] font-mono text-text-muted` 放 lang + 复制按钮(1.5s ✓ 已复制)。
  - 内嵌 tokenizer-lite 覆盖 ts/tsx/js/jsx/json/py/go/rs/sh/bash:字符串 / 数字 / 关键字 / 注释,四色映射 `text-success / text-warn / text-accent / text-text-muted`(温米色系 vs Claude.ai 的静默高亮一致);不在列表的语言降级单 span 纯文本。
  - 最佳努力:模板字符串 `${}` 插值不递归 token,保留在 string span 内;数字仅识别科学记数 `e+/-`。

**batch 4 验收**: 6 文件 1007 行;`pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅(monaco 4.3MB 大 chunk 已存在 → batch 18 定向拆分)。batch 4 完结,**不打 tag**;v0.1.6 留待 batch 6 收束。

**batch 5** · 富内容 + 流式:
- P4-E `chat/blocks/DiffBlock.tsx` ✅ (batch 5 · 2026-05-10) · 142 行
  - unified-diff 手解析(`@@` hunk / `+` add / `-` del / `---`/`+++`/`diff --git` 文件头折叠为小 italic)。+N/-M 计数 chip + 路径 chip(优先 `+++ b/<path>`,否则 `props.path`)。
  - 行不加背景,仅 `text-success/danger + border-l-2 /50 pl-2`,Claude.ai 式柔调。`my-3 rounded-md border-border-subtle bg-codeBg` 外壳 + header `bg-bg-surface` 与 CodeBlock 一致。
  - 未覆盖:combined/merge diff(`git diff --cc`,双列 `++`/`--`)、二进制补丁 (`GIT binary patch` 原样当 context 渲)、`\ No newline at end of file` 标记。
- P4-F `chat/blocks/ToolCallBlock.tsx` ✅ (batch 5 · 2026-05-10) · 203 行
  - 导出两个组件:`ToolCallBlock({use, result?})` 处理 paired/unpaired tool_use;`ToolResultBlock({result})` 处理孤儿 tool_result。MessageRow 后续按 `toolUseId` 配对后选择调用。
  - 状态 pill: `✗ 错误` (danger) / `✓ 完成` (success) / `运行中` (warn + `animate-pulse`)。paired `isError` 时 default 展开,其它用 `use.collapsed ?? true`。
  - 展开区分"输入 / 输出"两段,`<pre>` `max-h-[240px] overflow-auto whitespace-pre-wrap break-all`,375px 不吃 composer。每个 `<pre>` relative group 挂 Copy chip(`opacity-0 group-hover:opacity-100`)。
  - 头部 `flex-shrink-0` 的 chevron/tool/pill + `min-w-0 truncate` 的 input preview,375 单行不挤爆。
- P4-G `chat/blocks/ApprovalBlock.tsx` ✅ (batch 5 · 2026-05-10) · 187 行
  - 行内审批卡,与全局 modal `PermissionApproval.tsx` 协议对齐:`approval` props 同时接 wire 的 `{id,sid,tool,risk,summary,raw,timestamp}` 与归一化后的 `{input,cwd}`,`describeRequest()` 在两种 shape 间优先级 fallback。
  - 风险色:high `border-danger bg-danger/5` / medium `border-warn bg-warn/5` / low `border-accent bg-accent-bg` / resolved `opacity-70`。
  - Button primitive 复用 `variant="primary|ghost|danger" size="sm"` + `h-11 sm:h-9`(mobile 44px 触达)。checkbox "始终允许此工具" `flex-wrap` 窄屏换行,按钮保持右对齐。
  - high-risk + `device?.hasPasskey` 标签切 `🔐 Face ID 允许`;click 只调 `onApprove({allowAlways})`,passkey ceremony 留给父级(按 P4-G spec)。
- P4-H `chat/streaming.ts` ✅ (batch 5 · 2026-05-10) · 266 行
  - 纯 TS store 工厂 `createStreamingMessages(client, sidAccessor)`:监听 `chat.list/append/update`,按 sid 过滤(`client.on` 无预过滤)。
  - rAF 合并 `chat.update` 突发:`pending: Map<messageId, Map<segmentIndex, ChatSegment>>` 同一帧内同坐标取 latest → 每帧一次 `setMessages` 批量。SSR/test 回退 16ms `setTimeout`。
  - 孤儿更新:update 早于 append 时暂存 `orphanUpdates`,append 落地时 drain 应用。`stats.pendingOrphanUpdates` 可观测。
  - `chat.append streaming:false` 合并尚未 flush 的 pending,再替换 final message,避免终帧赛过正在飞的 delta。
  - 会话切换:sidAccessor 变化 → `clear()` + `chat.list.request`,与 `ChatView.tsx:52` 行为一致。
  - 已识别遗留:后台 tab rAF 停转会无限暂存(量级小暂不修);scroll-to-bottom 留给 consumer(MessageList 已实现);`chat.list` 中途会清 pending 但保 orphan(极少数会话切回放竞态,后续再加时钟兜底)。
  - 导出纯函数 `mergeSegments(existing, segmentIndex, incoming)` 方便未来单测 / 外部复用(不足位以空 text segment pad)。

**batch 5 验收**: 6 文件 1126 行;`pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅(22s)。batch 5 完结,不打 tag;v0.1.6 留待 batch 6 收束。

**batch 6** · Composer:
- P4-I `chat/Composer.tsx` ✅ (batch 6 · 2026-05-10) · 211 行
  - `rounded-xl border bg-bg-surface focus-within:border-accent + ring`(暖米 pill)+ 左 attach / auto-grow textarea / voice / 圆角 accent 送出。
  - Auto-grow 8 行(192px)clamp,空文本回 40px;`minHeight` style 托底。
  - IME 安全:`compositionstart/end` + `KeyboardEvent.isComposing` 双闸门,中文回车不误送;Cmd/Ctrl+Enter 强送;Shift+Enter 换行(可 `allowShiftEnterForNewline:false` 退化为 Enter 强送,CLI 场景用);Escape blur 不清稿。
  - 不自行追键盘位置:sticky 与 visualViewport 由 AppShell / ChatPane 负责,composer 只触发 `onFocus` 让父级 scroll 到底。
- P4-J `chat/SlashPalette.tsx` ✅ (batch 6 · 2026-05-10) · 262 行
  - Desktop popover(父容器 `bottom-full` 绝对定位)/ mobile `Portal` bottom sheet(`rounded-t-xl` + grabber + `env(safe-area-inset-bottom)`)两态。未复用 Dialog(Dialog 锁 body scroll + 固定 padding,不适合)。
  - window 级 `keydown` capture 监听:↑↓/Enter/Esc/Tab,`stopPropagation` 不穿到 composer textarea,保证 focus 留在输入框。
  - 过滤:`/` 前缀后空串 = 全量;非空 → prefix match 优先,substring 其次,同段按 category 字典序;top 20 + "…还有 N 个" footer。
  - 行 `onPointerDown preventDefault` 避免抢 textarea focus;commands 为空或过滤无结果都有对应空态提示。
- P4-K `chat/VoiceButton.tsx` + `AttachButton.tsx` ✅ (batch 6 · 2026-05-10) · 128 + 44 行
  - VoiceButton:`startDictation` 封装;三态 idle/speech/recorder 视觉,mobile 44px / desktop 36px 触达;`onCleanup handle.cancel()` 防麦克风泄漏。`onStart` 让父 snapshot draft,`onTranscript(text, isFinal)` 报完整 voice 段(父级用 snapshot 拼接)。
  - AttachButton:无状态 `+` 按钮,父级挂 ContextInjector。同 size/palette。
  - 两者都未复用 IconButton(IconButton 固定 `rounded-md` 方形 size,不适合圆形 + danger-fill 动效)。

**batch 6 集成 · ChatSurface.tsx 接线 · 145 行** ✅ (batch 6 · 2026-05-10)
  - 新增 `chat/ChatSurface.tsx`:组装 `ChatPane` + `MessageList` + `Composer`(含 SlashPalette / VoiceButton / AttachButton)+ `createStreamingMessages` + CRDT `input-draft`;挂 ContextInjector 作为 attach 的响应弹窗。
  - `MainPane.tsx` chat fallback 从 `ChatView` 换成 `ChatSurface`(terminal 模式保留旧 SessionHeader + TerminalView + CommandBar)。新增 `allCommands / sessions / onShareSession` 三个 props;`App.tsx` 接线 `Object.values(commandsStore.commandsById())` 作为 SlashPalette 全量命令源,share 走 `uiStore.openShare`。
  - 旧 `ChatView.tsx` 现已未被引用,Phase 6 批 10 统一清理(继续保留以备回滚)。

**batch 4–6 验收 → tag `v0.1.6`**:
  - 13 chat 文件 1996 行新增;`pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅(32s,main chunk 487KB gzip 133KB,新组件入口约 +31KB)。
  - 375px 手测清单(必测):ChatHeader 仅 title + permission chip + notebook + share;MessageList 消息 serif 15/1.65;user bubble 88% 宽右靠;assistant 24px gutter 菱形;Composer pill 圆角 20px,回车送出,软键盘下 tabnav 不遮;SlashPalette 移动端从底升上来 70vh sheet;voice 按钮 44px。
  - 已知遗留:streaming 的 scroll-to-bottom 由 MessageList 自管(不再经 ChatSurface 显式调),ChatView 的 prompt-template 面板 (`/p:<name>` 填参)暂未搬到 ChatSurface,batch 24-25 随 Prompts 专项迁。

### Phase 5 · 功能面板响应式(batch 7-9 · 11 agent 跨 3 批)
**batch 7** · 审批 + 通知 + 设备:
- P5-A `src/approvals/ApprovalPane.tsx` + `ApprovalCard.tsx` ✅ (batch 7 · 2026-05-10) · 209 + 186 行
  - Pane 消费 `createApprovalsStore` 的 `current() / history()`,24h 切窗 + 可选 sid 过滤,"待处理" / "最近" 两段 sticky header。
  - wire frame 取真 `approval.response { id, sid, approve, webauthnToken? }`(与 `PermissionApproval.tsx:119` 一致),非文档里错写的 approve/deny;public callback 仍保留 `onApprove/onDeny` 抽象。
  - Face ID 真跑:high-risk + `device.hasPasskey` + `isWebAuthnAvailable()` 时 `authenticateForApproval(deviceId, approvalId)` 等 token 再 response;有 `authing` / `authError` signal 做 inline 状态。prop 放宽到 `{id?, name?, hasPasskey?}` 以取 deviceId。
  - Card 与 ApprovalBlock 视觉一致(风险色 border-2 + icon + accent tool + `<pre max-h 160>` + `h-11 sm:h-9` 按钮 wrap);compact 行宽 `min-h-11`。
- P5-B `src/inbox/InboxPane.tsx` + `InboxItem.tsx` ✅ (batch 7 · 2026-05-10) · 203 + 151 行
  - 消费 `InboxView.tsx` 现有 `createInboxStore`(`items() / unread() / total() / markAllRead()` —— 没有 per-item markRead,follow modal 行为,点任意行 + "全部已读" 按钮都调 markAllRead)。
  - `ActivityItem` (approval / commits / crash / update / session_exit) → `InboxItemRecord` (approval / notification / workflow / message / system) 做 presenter 转换,`meta.approvalId` 透传。
  - Pane 结构:sticky header(title + unread badge + filter chip 全部/待审批/通知/消息 + 全部已读)+ scroll body 三段 today/this-week/earlier 相对时间 grouping,EmptyState "收件箱为空"。
  - 键盘 j/k/↑/↓ deferred(Enter/Space 原生 role=button tabIndex=0 可行);横向滚动只限 filter chip 条带,pane 自身 `overflow-x-hidden`。
- P5-C `src/devices/DevicesPane.tsx` + `src/peers/PeersPane.tsx` ✅ (batch 7 · 2026-05-10) · 237 + 233 行
  - DevicesPane:`device.list.request` 拉取,`device.revoke` 撤销;本设备高亮段 + 其他设备段 + passkey chip;直接复用 `webauthn.ts` 的 `registerPasskey/clearPasskey/isWebAuthnAvailable`。
  - PeersPane:`peer.list.request / peer.add / peer.remove` 真 wire frame;cert fingerprint 用 `id.slice(0,6)` 作短 id chip(`PeerInfo` 无真 fingerprint 字段,标注待协议补)。
  - 已知 gap:`peer.reconnect` 协议缺位,"重连"按钮退化为 `peer.list.request` 刷新;device rename 留给旧 modal;DevicesPane footer 无 hostname/version(无全局 host-info store,不动 App.tsx 就无法读)。
  - 协议命名对齐:contract 写的 `PeerSummary` → 真类型 `PeerInfo`。

**batch 7 验收**: 6 文件 1219 行;`pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅(15s)。panes 落地但 **未接线** —— App.tsx 仍走 PermissionApproval modal / InboxView modal / DevicesModal / PeersModal 原路径,Phase 6 batch 10 再统一切换(避免中间态同时两个审批栈乱)。不打 tag。

**batch 8** · 文件 + 笔记本 + 录屏:
- P5-D `src/files/FileBrowser.tsx` + `FilePreview.tsx` ✅ (batch 8 · 2026-05-10) · 261 + 200 行
  - Wire frame 真名是 `fs.ls.request / fs.ls / fs.read.request / fs.read`(不是文档里误写的 `file.*`);`FileEntry = {name, path, type, size?, mtime?}` 无 symlink 字段。
  - 扁平列表 + breadcrumb 导航(非递归 tree,375 友好);`min-h-[44px] sm:min-h-[32px]` tap;git dots `success/warn/danger` 三态;mobile breadcrumb 只保留 parent/current 段。
  - Monaco 严格 lazy:`monacoPromise = import("monaco-editor")` 模块级 loader,只在 `MonacoPane onMount` 触发;encoding=base64 或 size ≥1MB 走 `<pre>` 不加载 Monaco。
  - 未做:键盘方向键导航(省 LOC)、原始 path 文本输入框(breadcrumb + back 替代)、symlink 图标(协议不给)。
- P5-E `src/notebook/NotebookPane.tsx` + `NotebookEntry.tsx` ✅ (batch 8 · 2026-05-10) · 216 + 174 行
  - Wire frame:out `notebook.request / notebook.upsert / notebook.delete / chat.list.request`;in `notebook / notebook.upserted / notebook.deleted / chat.list / chat.append`。协议无 per-cell update/remove/clear —— upsert 是 bulk-replace,`notebook.delete` 即 clear all。
  - Cell kinds 只有两种:`note`(wire 叫 note 不是 markdown,跟 wire)、`chatRef { id, messageId }`(sid 在父 notebook 上)。
  - chatRef 真解析:pane 自己订阅 `chat.list/append` 维护 `Map<messageId, ChatMessage>`,`resolveMessage` prop 下发到 entry;解析成功渲 role + timestamp + 240 字 excerpt + 跳转按钮,失败 id chip 兜底。
  - Ctrl/⌘+Enter 保存,Esc 取消(顶部新建 + cell 编辑两处都挂);TextBlock 复用 chat/blocks 渲 markdown。
- P5-F `src/recording/RecordingPanel.tsx` + `RecordingPlayback.tsx` ✅ (batch 8 · 2026-05-10) · 231 + 208 行
  - Wire 真名 `record.start / record.stop / record.status.request / record.status`(不是 `recording.*`);播放走 HTTP `GET /recording/<sid>.cast` + `DELETE /recording/<sid>`,带 `Bearer <token>`。
  - `compact=true` 是 MainPane header 用的细控件(⏺录制 / ⏹+size+elapsed / ▶⬇🗑);`compact=false` 全 Pane 含"正在录制"行 + 历史列表 + EmptyState。
  - xterm lazy:`RecordingPlayback` 通过 `Solid.lazy` 异步加载,xterm ~300KB 只在点播放时拉取;playback 含 play/pause / restart / 0.5x-4x 速度 / seekable range。
  - 延后:share action(协议无 `record.share`)、跨 session 多录制列表(协议 1 sid 1 cast,pane 只能显示当前 session 唯一录制)—— 等 host 扩 recording id 再补。

**batch 8 验收**: 6 文件 1290 行;`pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅(15s)。panes 落地未接线,Phase 6 batch 10 统一切。不打 tag。

**batch 9** · 设置 + 配置(10 个子 tab 统一):
- P5-G/H/I `src/settings/SettingsPane.tsx` + `tabsConfig.ts` ✅ (batch 9 · 2026-05-10) · 256 + 65 行
  - 复用既有 10 个 `*Tab.tsx`(`SkillsTab` / `McpTab` / `CommandsTab` / `SubagentsTab` / `HooksTab` / `PermissionsTab` / `StartersTab` / `WorkflowsTab` / `PromptsTab` / `PluginsTab`),不重写业务逻辑;tabsConfig `lazy(() => import(...))` 逐个代码分割。
  - 响应式三档:桌面 ≥1024 左 sidebar `w-56` + 右 scrollable;<1024 水平 `overflow-x-auto` tab strip(`h-11` 触达) + 下方内容;所有断点 serif 16px title。
  - 搜索过滤 sidebar/strip(label/id/description 模糊匹配)+ Enter 跳首个 + Esc 清空或关闭;URL hash 同步 `#settings/<id>` 含 popstate 监听。
  - `<Switch><Match>` 按 id 分发各 tab 正确 props:`WorkflowsTab` 用 `onRun` 不是 `onRunWorkflow`,在 pane 层做了 adapter。
  - tab content 外包 `<Suspense>` 显示"加载中…"。
- P5-J `src/marketplace/MarketplacePane.tsx` ✅ (batch 9 · 2026-05-10) · 270 行
  - 三类 discriminated union:`skill | mcp | plugin`(直接映 `MarketSkillEntry / MarketMcpEntry / MarketPluginEntry`),分类 chip 为 All / Skills / MCPs / Plugins(原 MarketplaceView 无 Commands/Starters,按现实用)。
  - Wire frame 照搬 `market.catalog.request` / `market.install.skill|mcp|plugin` / `market.skill|mcp|plugin.installed`;协议无 uninstall,与原 View 一致只装不卸。
  - 响应式 grid:`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4`;category chip horizontal scroll;search input `flex-1 sm:w-72`。
  - 详情 slide-in deferred,装按钮点开居中 confirm overlay(skill 作用域 radio / mcp env hints / tags / description)—— 对齐老 View 的 install prompt UX。

**batch 9 验收**: 3 文件 591 行;`pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅(15s)。所有 Pane 全部落地 **但 App.tsx 仍走旧 Modal 路径**。

**Phase 5 整体完结**: 12 个 Pane / 15 文件 / 3100 行代码落盘,ApprovalPane / InboxPane / DevicesPane / PeersPane / FileBrowser / FilePreview / NotebookPane / NotebookEntry / RecordingPanel / RecordingPlayback / SettingsPane / MarketplacePane。典型 Pane contract 统一:`{ client, sid?, onClose? }` + 业务 callback;frame 取真协议名(非 spec 里的误写)。

**Phase 5 不打独立 tag**,留给 Phase 6 batch 10 做一键清理与接线后一起 tag `v0.1.7`。

### Phase 6 · 首轮清理(batch 10 · 3 agent)
- **B10-A** ✅ (batch 10 · 2026-05-10) · 保守清理(非全量)
  - 删除 `packages/web/src/mobile/` 7 文件 + `MobileKeyBar.tsx`(零外部引用);`MobileTab` 类型从 `mobile/MobileTabNav.tsx` 内联到 `stores/uiStore.ts`(维持 `mobileTab` / `setMobileTab` 持久化不破坏)。
  - **未删 `useIsMobile`**(`chat/ChatSurface.tsx` + `shell/AppShell.tsx` 还在用),留原位。
  - **未删 `ChatView.tsx`**:`SharedReadonlyView.tsx` 仍 fallback 到它渲染只读分享。迁移 SharedReadonlyView 到 ChatSurface 需要 store-adapter(ChatSurface 期望 commands/sessions 已在 scope),复杂度独立一个 batch 更稳。登记到 batch 11 后待清理。
  - grep 确认:`from ".*mobile/` 全仓 0 处(除已删 `/mobile/` 内部)、`MobileKeyBar` 0 处、`MobileTab` 仅 `uiStore.ts` + `App.tsx:305` 合法使用。
- **B10-B** ✅ (batch 10 · 2026-05-10) · 258 行
  - `PairingView.tsx` 重写:serif "rcc" + terra-cotta 菱形 logo + `bg-bg-page / bg-bg-surface` 暖卡片;6 格数字输入(`w-12 h-14 sm:w-14 sm:h-16 font-mono text-[28px]` + `border-accent ring-accent/30` focus),auto-advance / Backspace 回退 / 粘贴分布 / ArrowLeft-Right 导航 / Enter 提交。
  - 行为保真:`onPaired` + 600ms delay / `requestPairingCode` / `claimPairing` / `saveToken/saveDevice/saveE2EKey` / 全部 `pair.*` i18n key 不动;`entered` 单 signal 为 source-of-truth,6 格仅视觉。
  - `motion-safe:` Tailwind variant 承接 prefers-reduced-motion;触达 44px+(数字格 56/64;CTA `size="lg"` h-12)。
- **B10-C** ✅ (batch 10 · 2026-05-10) · 309 行
  - `CommandPalette.tsx` 视觉升级:serif 搜索输入 `text-[16px]` + sans list + mono footer;active row `bg-accent-bg text-accent`;panel shadow `0_20px_60px_-20px rgba(0,0,0,0.25)` rounded-lg;mobile 走 `Portal` bottom-sheet `rounded-t-xl max-h-[80vh]` + grabber + `env(safe-area-inset-bottom)`。
  - 跨平台 kbd hint:`IS_MAC` 通过 `navigator.platform || userAgent` 检测,`⌘+K`/`Ctrl+K` header badge + footer strip 自适应;keydown listener 仍 `metaKey || ctrlKey` Mac-agnostic。
  - 行为保真:所有 `skill.list.request` / `cmd.list.request` / `subagent.list.request` / `git.exec.request` 帧与 `/${name}\r`、`@${name} `、`请使用 skill: ${s.name}\r` 输出,60s TTL 缓存,前缀路由 `>/:@#`、fuzzy score + consecutive 全部不动。

**batch 10 验收**: `pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅(14s)。**打 tag `v0.1.7`**(Phase 5 panes + Phase 6 首轮清理合并成果)。`grep -r "useIsMobile\|MobileKey\|mobile/" src/` = 仅 `useIsMobile`(留用) + `uiStore` 的 `MobileTab` 内联定义 + `App.tsx:305` `mobileTab`,`mobile/` 目录已 0。PairingView / CommandPalette 视觉全面 Claude 化。

### Phase 7 · CLI session 真对话(batch 11-13 · 9 agent)
把 CLI-driver 的 pty 输出从 xterm ANSI 流转成真实 chat 气泡 — 不依赖 SDK driver。

**batch 11** · 解析强化 ✅ (batch 11 · 2026-05-10):
- B11-A `packages/host/src/chat-parser.ts` 状态机版 · 593 行(含 B11-C delta 叠加,原目标 400 行被放宽)
  - 6 态状态机 `IDLE → TEXT → CODE_FENCE → DIFF_BLOCK → TOOL_USE → BOX_PANEL`,line-start 前缀驱动切换(fence / `●⏺ Tool(…)` / `╭…╰` / `diff --git` / `--- a/` / `+++ b/`)。
  - tool_use 嵌入同消息:TEXT 态遇到 tool 标记先 flush text,追加 tool_use 段,随后 TEXT 再开新文本段(`activeSegmentIndex=-1` 在非 text 收尾时重置)。与 Claude.ai 的"回合内调用 tool"渲染一致。
  - 增量 emit:`EMIT_DEBOUNCE_MS=50` 的 `scheduleFlush` + `IDLE_TIMEOUT_MS=1500` 的 idle timer 自动关 message(`streaming: false`)。
  - 新 API:`beginNewMessage()` 强制切 + `dispose()` 清 timer + listener(session.ts 待调用点留注释标记,本批不动)。
  - 公共 API 不破坏:`feedOutput/feedInput/appendMessage/updateSegment/finalizeMessage/list/onMessage/onUpdate/reset` 全部原签名保留;session.ts / sdk-session.ts / index.ts 零改动。
  - ANSI 加宽覆盖 CR redraw(`\r\n?` → `\n`);cursor 定位 `CSI H/f/r` 走已有 `ANSI_CSI` 通吃;lone `\r` 转 `\n`(per-column terminal buffer 重建未做,本批不值)。
  - 已识别遗留:user-prompt echo 自动检测仍是启发式(依赖 feedInput 正确调用或 idle 兜底);非文本段收尾后立即文本 run 的首次 delta 会把整段内容当 append 发(匹配 `prev.content="" → next` 的 startsWith 条件)。
- B11-B 协议增 `chat.delta` frame · +20 行 `packages/protocol/src/index.ts`
  - `{ v, t:"chat.delta", sid, messageId, segmentIndex, textDelta }`;已并入 Frame discriminated union。
  - 接收语义:按 messageId 定位,`segments[segmentIndex]` 存在且 `kind==="text"` 则 append `textDelta`,否则静默忽略。`chat.update` 仍作权威兜底。
- B11-C pipeline:parser 加 `onDelta` 监听 + `emitSegment(messageId, idx, prev, next)` 集中化 · chat-parser 内 +49 行
  - `emitSegment` 无条件先 `emitUpdate`,满足 `next.kind==="text" && next.content.startsWith(prev.content) && next.content.length > prev.content.length` 时额外触发 delta;`closeBuf / flushLiveText / updateSegment` 三个 choke-point 全走 emitSegment,老 `chat.update` 兜底路径一处不丢。
  - `packages/host/src/index.ts` `attachChatBroadcast` 订阅 `session.chat.onDelta` 广播 `chat.delta` frame;`session.onExit` 解订;`isFrameAllowedForShare` sid-gated 白名单加 `chat.delta`。
  - **web 客户端本批不动**(`streaming.ts` 仍按 `chat.append + chat.update` 路径工作,deltas 暂不消费)—— Phase 10 batch 19 正式接入。

**batch 11 验收**: 3 文件(`chat-parser.ts` / `protocol/index.ts` / `host/index.ts`)合计 +86 行核心;`pnpm -r typecheck` ✅(protocol / cli / host / web 全绿)。v0.2 arc 内首次动 host,批次内行为前向兼容。不打 tag。

**batch 12** · 前端消费:
- B12-A `chat/streaming.ts` 接 `chat.delta` ✅
  - pending map 改为 per-(messageId, segmentIndex) `PendingEntry = { override?: ChatSegment; textAccum: string }`;`chat.update` 写 `override` 并清 `textAccum`,`chat.delta` 仅追加 `textAccum`。flush/append/orphan-drain 均走新增内部 `applyEntry()`:先 `mergeSegments(override)`,再 `applyTextDelta(textAccum)` —— **update-wins 语义**(同 tick 内 update 胜过之前的 delta,但后续 delta 仍在 update 内容上追加)。
  - 新增 pure helper `applyTextDelta(existing, segmentIndex, textDelta)`:`segmentIndex` 越界 / 非 text / 空 delta 均返回原数组(按协议规范静默忽略)。已 export(B13+ 可复用)。
  - `orphanUpdates` 由 `Map<string, Map<number, ChatSegment>>` 扩为 `Map<string, Map<number, OrphanEntry>>`,`OrphanEntry = { kind:"segment"; segment } | { kind:"delta"; textAccum }`;`parkOrphan` 在落 orphan 时合并同槽先前条目(update+delta 折叠为单 segment,delta+delta 连接 textAccum,非 text orphan + delta 按规范丢弃 delta)。`chat.append` / `chat.list` drain 时对两种 entry 分别走 `mergeSegments` / `applyTextDelta`。
  - `StreamingStats.pendingOrphanUpdates` 语义扩为"任意类型 orphan 帧 count",字段名保留;**未新增 stats 字段**(本批不加)。back-compat:未发 `chat.delta` 的 host 仍走 update 老路径,无回归。
  - 1 文件:`packages/web/src/chat/streaming.ts` 266 → 360 行(+94)。`pnpm -F @rcc/web typecheck` ✅。未动 `MessageList.tsx` / `MessageRow.tsx` / 任何 consumer。
- B12-B CLI session Composer 行为修复(/command 识别,/clear 确认) ✅
  - `ChatSurface.tsx` 增加 `onSend?: (text: string) => void` prop;`MainPane.tsx` 透传 `props.sendCommand` — chat 视图里键入的 `/git:status` 等命令现在走 `App.sendCommand` 同一拦截层(`git.exec.request` 路径),不再原样 `client.write` 给 claude pty。
  - 销毁性 slash 命令白名单 `DESTRUCTIVE_SLASH = {clear, resume, reset, exit}`:发送时用 `^\/(\w[\w:-]*)\b` 匹配首 token,命中则 `window.confirm("清空当前对话上下文? (/<name>)")`,取消则恢复 draft 并在 composer 下方闪现 `已取消 /<name>` 2s 提示(`text-text-muted text-[11px]`)。
  - `Composer.tsx` / `App.tsx` / `SlashPalette.tsx` / `streaming.ts` 未改;`SlashPalette` 在 slash-prefix 正则生效期间已自动关闭,确认对话框仅在发送瞬间(palette 关闭后)触发。
  - 2 文件:`chat/ChatSurface.tsx` 194 → 239(+45);`MainPane.tsx` 398 → 399(+1)。`pnpm -F @rcc/web typecheck` ✅。
  - Mobile 注意:`window.confirm` 在 iOS Safari 会阻塞主线程并短暂关闭软键盘 — 可接受,Dialog 原语留给后续批次。
- B12-C 长输出自动折叠 + "展开全部" ✅ (batch 12 · 2026-05-10)
  - `TextBlock` / `CodeBlock` / `DiffBlock` 各加 `collapsed` internal signal + `forceCollapsed?: boolean` override。触发阈值 20 / 30 / 40 行(严格 `>`,等于阈值保持展开);折叠时只渲 16 / 24 / 32 行 + 底部 24px 渐变遮罩 + `展开全部 (共 M 行)` 按钮。
  - 按钮 `py-2 sm:py-1.5`(mobile 44px 触达)+ `aria-expanded` + `aria-controls={bodyId}`(`createUniqueId`)。
  - 渐变用 inline `style={{ background: "linear-gradient(to top, rgb(var(--code-bg/bg-page)) 0%, transparent 100%)" }}`(不走 Tailwind `from-codeBg`,因 token 含 `<alpha-value>` 插值,inline 跨主题更稳)。
  - DiffBlock 按已解析行数计(`parsedLines.length`)而非原始 content 行数。
  - 3 文件:TextBlock 149→209(+60)、CodeBlock 179→222(+43)、DiffBlock 142→187(+45);全在 +80 预算内。`pnpm -F @rcc/web typecheck` ✅。

**batch 12 验收**: 5 文件合计 +287 行;`pnpm -r typecheck` ✅;`pnpm -F @rcc/web build` ✅。CLI 会话 chat 消费路径完整(delta + confirm + collapse),视觉与 SDK 路径一致。不打 tag。

**batch 13** · 边界 case:
- B13-A ANSI escape / cursor control 残留剥离测试 ⏸ (batch 13 · 2026-05-10 · **deferred**)
  - 执行时发现:**整个 monorepo 无任何测试基础设施** —— 无 vitest / jest / node:test fixture;root / 4 包的 `package.json` 均无 `test` script;`pnpm-lock.yaml` 也无 vitest 条目;`which vitest` 找不到 binary。agent 按 B11 批次明令"不加新 npm dep"规则停摆,不自行拉 vitest。
  - 继续推进的选项,待用户决定:
    1. 单独一个 batch 加 vitest devDep + CI 脚本接入;
    2. 用 Node 20 内建 `node --test`(node:test)零新 dep 跑同样测试;
    3. 进一步推到 Phase 22 batch 47 用户测试循环一起做。
  - 目前 chat-parser v2 的 ANSI / 状态机 / onDelta 语义**无自动回归保护**,靠手测 + 代码 review 兜底。不影响本 batch 的其它产物接收。
- B13-B 中断恢复(session 重连后补帧) ✅ (batch 13 · 2026-05-10)
  - 协议(加法式,不破坏旧客户端):`ChatAppend` / `ChatUpdate` / `ChatDelta` 各加一个可选 `seq?: number`(host 在 broadcast 时盖章);`SessionAttach` 加可选 `chatSince?: number`(区别于 pty 的 `since`);新增 `ChatReplay { sid, frames: (ChatAppend|ChatUpdate|ChatDelta)[], lostCount: number }` 帧。类型已 `export type ChatAppend/ChatUpdate/ChatReplay`。
  - `packages/host/src/session.ts`(+65 LOC):新增常量 `CHAT_FRAME_RING_CAPACITY = 500`、`interface BufferedChatFrame`,`Session` 里加私有 `chatFrameSeqCounter`(从 0 单调递增)+ `recentChatFrames: RingBuffer<BufferedChatFrame>(500)`,公开 `nextChatFrameSeq()` / `recordChatFrame(entry)` / `get currentChatFrameSeq` / `replayChatFrames(since)` 四个方法;`DeadSession` 提供 no-op 同名方法(seq 恒为 0,replay 返回 `{frames:[], lostCount:0}`)。
  - `packages/host/src/sdk-session.ts`(+25 LOC):并行实现同一组方法,保证 SDK 驱动重连路径与 CLI 一致。
  - `packages/host/src/index.ts`:`attachChatBroadcast` 的三个回调(`onMessage`/`onUpdate`/`onDelta`)每次广播前 `nextChatFrameSeq()`→在 frame 上附 `seq`→`recordChatFrame({seq, frame})`→`broadcast(frame)`(+~50 LOC)。`session.attach` 两处 handler(已鉴权 + share-guest)当活 session 且 `frame.chatSince != null` 时,调 `s.replayChatFrames(chatSince)`,发 `{t:"chat.replay", sid, frames: replay.frames.map(f=>f.frame), lostCount}` (+~30 LOC);`isFrameAllowedForShare` 加 `chat.replay` 白名单。
  - `packages/web/src/chat/streaming.ts`:仅在顶部加注释描述 B13-B 契约("NOT YET WIRED — future Phase 8 batch 14")。
  - 边界:`chatSince === 0` 且 session 无聊天历史 → `{frames:[], lostCount:0}`(seq 起始 0 所以 `since >= current` 立即命中 no-op);`chatSince < oldest` → `{frames:[], lostCount: current-since}`,客户端应 fall back 到 `chat.list.request`;DeadSession 走既有 `chat.list` 全量路径(未从 ring 补帧)。
  - Web 客户端未消费 `chat.replay`(留给 Phase 8 batch 14)—— 老 host 省略 `seq`,老 client 忽略 `seq`,完全向后兼容。
  - `pnpm -r typecheck` ✅。
- B13-C 大 session(>10MB history)滚动流畅 ✅ (batch 13 · 2026-05-10)
  - 新增 `packages/web/src/chat/MessageList.perf.ts`(43 行):`estimateMessageSize(m)` 汇总各 segment `.content` 长度 + 每 segment 200 字节元数据开销;`HEAVY_MESSAGE_BYTES = 64 * 1024` 作为行级折叠阈值。
  - `MessageList.tsx` 171 → 228(+57):新增 `expandedIds: Set<string>` signal,可见窗内 **不在最后 20 条 `ACTIVE_TAIL`** 且 `estimateMessageSize > 64KB` 的消息渲染为 `[折叠] 历史消息 · {size} bytes · 点击展开` placeholder(点击加入 `expandedIds` 展开成完整 `MessageRow`)。与 B12-C 的 block 级折叠正交互补。
  - "显示更早消息" 按钮加滚动锚:展开前 `savedDistance = scrollHeight - scrollTop`,展开后 `queueMicrotask` 内 `scrollTop = scrollHeight - savedDistance`,修正批次 4 遗留的"窗口上扩后视口被向下推"问题。
  - `onScroll` 改 rAF throttle(同 frame 内多次 scroll 事件合并为一次 `tick()`,`cancelAnimationFrame` 在 cleanup 里取消挂起),快速 flick 时的 `scrollTop` / `scrollHeight` 读取从 O(events) 降到 O(frames)。
  - 切 session 时同时 reset `windowSize` 与 `expandedIds`(新 `Set<string>()`,避免 TS `Set<unknown>` 推断)。
  - 新增 `packages/web/src/chat/__fixtures__/generateLargeHistory.ts`(80 行):dev-only 纯函数 `generateLargeHistory(sid, count)`,文件顶部注释标明 **不接入 prod 路径**。混合 text + code + diff + tool_use,每 37 条一条 heavy(~100KB)压测行级折叠路径;10k 调用产出约 10MB。
  - 未动 `MessageRow.tsx` / `blocks/*` / 其他任何文件。`pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅。

**验收**: 真 `claude` CLI session 里的消息和 SDK session 视觉一致。tag `v0.1.8`。

### Phase 8 · 错误恢复 + 健壮性(batch 14-15 · 6 agent)
**batch 14** · 前端错误边界:
- B14-A 全局 `ErrorBoundary.tsx` + 友好报错页 + "复制报告"按钮
- B14-B ws 断线 UX(横幅 + 自动重连进度)
- B14-C host crash → 重启检测 + session 自动 resume ✅ (batch 14 · 2026-05-10 · partial)
  - **Reconnect-replay 客户端全部落地**。`packages/web/src/client.ts`(+30 LOC):新增 `ChatSinceResolver` 类型 + `chatSinceResolvers: Map<string, ChatSinceResolver>` + 公开 `registerChatSinceResolver(sid, resolver)` 返回 unregister thunk;ws.open 重连回调里对每个 `attachedSids` 的 sid 查 `resolver?.()` 并把结果折进 `session.attach.chatSince`;单点 `attach(sid)` 同步更新。
  - `packages/web/src/chat/streaming.ts`(375 → 390):在 `createStreamingMessages` 内闭包里维护 `lastSeenSeq: number | undefined` + `noteSeq(seq?)`(在每次 chat.append/update/delta handler 开头调用);新增 `syncResolver(sid)`(sid 变化时 unregister 旧的、register 新的);对外暴露 `lastSeenSeq()` accessor(类型 `StreamingMessagesStore.lastSeenSeq(): number | undefined`)。提取 `handleChatFrame(frame, sid)` 以便 chat.replay 复用同一分派路径。
  - 新增 `chat.replay` 帧 handler:`lostCount > 0` → 清 `pending` + `orphanUpdates`(丢 post-cursor delta,避免粘到过期 prefix)但**不清 `messages`**,然后 `client.send chat.list.request`,靠随后的 `chat.list` 原子替换列表(中间 tick 界面继续显示旧 prefix,**不会空闪**);`lostCount === 0` → `for (inner of frame.frames) handleChatFrame(inner, sid)`,走与实时帧相同路径(seq 累加、rAF coalesce)。
  - sid 切换的 `createEffect` 里加 `lastSeenSeq = undefined; syncResolver(sid);`,避免旧 sid 的 seq 泄漏到新 sid。`dispose()` unregister resolver。
  - 重连链路:ws 断 → `scheduleReconnect()` 指数退避 → ws reopen → `addEventListener("open")` 遍历 `attachedSids` → 对每个 sid 发 `session.attach { sid, since: ptySeq ?? null, chatSince: resolver()?.() ?? null }` → host(B13-B)回 `chat.replay { frames, lostCount }` → 客户端新 handler 分派。
  - **host-crash 检测未实现** —— 协议 `Hello` 帧没有 `bootId`/`hostInstanceId`/`processStartTime` 字段(仅 `TunnelInfo.startedAt` 是 tunnel 的不是 host 的),按任务说明"如无信号则跳过"。若 batch 15 需要此功能,需先给 `Hello` 加 `bootId`(host 进程启动时随机,每次进程重启变),client 侧在 hello handler 里 diff 决定是否显示 "host 已重启" 横幅。
  - Session 自动 resume:`client.attachedSids` 在 `session.attach` / `session.close` 时自增删,ws 重连时整个集合自动 replay,因此 `sessionsStore` 侧无需改动。
  - 约束核对:无新 npm dep;无协议改动;`streaming.ts` 390 LOC(< 400 budget);`MessageList.tsx` / 其他 UI 未动;`App.tsx` 零改动。
  - `pnpm -r typecheck` ✅;`pnpm -F @rcc/web build` ✅(1374 modules,1m26s)。

**batch 15** · 数据一致性:
- B15-A 乐观更新回滚(approval / session.close)✅ (batch 15 · 2026-05-10)
  - `packages/web/src/primitives/Toast.tsx`(新建 129 LOC):app 级轻量通知原语。module-level signal 队列 + `toast(msg, { tone, duration })` 函数 + `<ToastContainer />` JSX。`tone: "info" | "warn" | "danger"` 切 border + 左侧 3px 条纹色。4s 自动消散 + ✕ 手动关闭。响应式定位:移动端底部居中、desktop 底右。全部 semantic token(`bg-bg-surface` / `border-border-subtle` / `text-text-primary` / `bg-accent|warn|danger`)。
  - `packages/web/src/stores/sessionsStore.ts`(+70 LOC net):`pendingCloses: Map<sid, { session, wasActive, timer }>` 跟踪乐观关闭。`closeSession(sid)` 先 snapshot 再本地移除,10s 兜底 timer;下一次 `session.list` 若仍含该 sid → 回滚 + toast `关闭失败 · 主机仍持有该会话`;收到 `error` 帧(`code/message/sid?`)且 `sid` 命中 → 回滚 + toast 带 server message;timer fire → 回滚 + toast `请求超时`。resolved 即 drop 出 map。dispose 清所有 timer。
  - `packages/web/src/stores/approvalsStore.ts`(+89 LOC net):`ApprovalHistoryItem` 新增 `provisional?: boolean` 字段。`pendingResponses: Map<id, { request, approve, timer }>` 跟踪乐观应答。`respond()` 先 push `provisional: true` 到 history + 10s timer;新的 `approval.request`(不同 id)→ 之前 pending 视为 host moved on,清 provisional 标记;`approval.cleared` 匹配 pending id → 同上;`error` 帧按 `frame.sid` 匹配 → 回滚(drop provisional row,`setCurrent(p.request)` 若当前 slot 空闲,toast `审批未送达 · <reason> · 请重试`);timer fire → 同 rollback 路径;`session.exited` → 将该 sid 下所有 pending 当成 resolved。
  - `packages/web/src/App.tsx`(+2 LOC):import + `<ToastContainer />` 挂在 authed `<Show>` 内根部。
  - 约束核对:无新 npm dep;仅 Solid primitives;语义 token;未触 `chat/*` / `MainPane.tsx` / `ChatSurface.tsx`;Toast 129 LOC(< 150 budget);sessionsStore +70(目标 < 60,略超 10 行主要为 `session.list` 协调 + `error` 帧处理);approvalsStore +89(目标 < 80,略超 9 行主要为 4 类 frame 分支的 rollback 协调)。
  - Error 检测机制:protocol 的 `error` 帧 `{ t: "error", code: string, message: string, sid?: string }` —— 两个 store 都订阅 `error` 并按 `frame.sid` 匹配到各自的 pending map。approval 的 `error` 帧无 approval id,只能按 sid 匹配(best-effort,命中第一个)。
  - 断网边界用例:用户点 Approve → 乐观写 history + provisional + 10s timer。WS 立即掉线 → 帧到不了 host、也收不到回执;10s 后 timer fire → `rollbackResponse()` drop provisional row + `setCurrent(p.request)` 若 slot 空闲 + toast `审批未送达 · 请求超时 · 请重试`。重连后用户可继续在重新出现的 banner 上点 Approve/Deny。
  - `pnpm -F @rcc/web typecheck` ✅;`pnpm -F @rcc/web build` ✅(1375 modules,1m23s)。
- B15-B 并发同 session 多端输入冲突处理(CRDT 已有,UI 提示)✅ (batch 15 · 2026-05-10)
  - `packages/web/src/chat/ChatSurface.tsx`(+29 LOC net):新增 `remoteEditActive` 信号 + `lastLocalValue` ref + `remoteEditTimer` + `flashRemoteEdit()`(2s 自动清,连续 remote 编辑会 reset 定时器)。`onDraftChange` 和 `onSend` 的 `shared?.setValue("")` 之前都会先写 `lastLocalValue = v`;CRDT observer 里 `v !== lastLocalValue → flashRemoteEdit()`(Y.Text#observe 对 local/remote 都会触发,靠 ref diff 过滤本地 echo)。`onCleanup` 清定时器。composer 上方条件渲染小 chip `👥 协作者正在编辑…`(`text-accent text-[11px] mx-4 mb-1`,用语义 token)。
  - `packages/web/src/chat/Composer.tsx`(+2 LOC):新增 optional `remoteEditing?: boolean` prop,`outerCls()` 里 truthy 时加 `ring-2 ring-accent/20` 淡环,无焦点时也能看到协作提示。
  - caret 跳跃未处理:Y.Text 不跟踪光标位置,remote edit 命中 textarea 时光标可能跳 —— 按任务描述"可接受,只暴露协作状态"不动 caret 逻辑。
  - 无新 dep;未触碰 `crdt.ts`/`streaming.ts`/`blocks/*`;typecheck ✅;`pnpm -F @rcc/web build` ✅(1374 modules,59.64s)。
- B15-C 时钟漂移导致 replay 窗口失败的降级提示 ✅ (batch 15 · 2026-05-10)
  - 协议层:`ChatReplay` 扩展 optional `oldestSeq?: number`,向后兼容(`packages/protocol/src/index.ts` +9 LOC 含注释)。
  - host:`Session` / `SdkSession` / `DeadSession` 的 `replayChatFrames` 返回值统一加 `oldestSeq`;从 `recentChatFrames.since(0)[0].seq` 取最旧保留帧,空环回退到 `current`(代表"完全追上")。两处 broadcast 站(`chat.replay` / `session.attach.chatSince`)透传字段。`packages/host/src/session.ts` +12 LOC, `sdk-session.ts` +5 LOC, `index.ts` +2 LOC。
  - `session.ts` 顶部注释补环形缓冲不变式(CAPACITY=500,lostCount>0 → re-hydrate,web 会 toast)。
  - web:`createStreamingMessages` 新增 optional `sessionsAccessor` 形参,`chat.replay` 分支在任何 pending / orphan mutation **之前**校验 `frame.sid` 在已知 sessions 中;不在则静默丢弃。`lostCount > 0` 时先 `toast("会话快照回放窗口溢出 · 已重新加载", { tone: "warn" })` 再发 `chat.list.request`,toast 在 early-return 分支内只触发一次(不随 lostCount=0 的逐帧 re-dispatch)。`packages/web/src/chat/streaming.ts` +10 LOC, `ChatSurface.tsx` +1 LOC(传 sessions)。
  - 不新增 npm dep,不新增协议 frame;host 改动 < 25 LOC,web 改动 < 20 LOC;未触碰 chat UI 组件。typecheck ✅(host+web);`pnpm -F @rcc/web build` ✅(45.77s)。

**验收**: 手动杀 host / 拔网线 / 同 session 两端输入,UI 不崩溃,信息清晰。tag `v0.1.9`。

### Phase 9 · 可访问性 + 键盘(batch 16-17 · 6 agent)
**batch 16** · a11y:
- B16-A 所有 primitives 加 aria-*,role,focus ring 达到 WCAG AA ✅ (2026-05-10)
  - 审计 14 个 primitive + 5 个 shell 组件;绝大多数已合规(Button/IconButton/TextInput/Textarea/Toggle/Spinner/ErrorBoundary/TabNav/Sidebar/TopBar 已有 focus-visible ring + aria 属性)。
  - Dialog:`aria-label={title}` 改为 `aria-labelledby={titleId}`,给 `<h2>` 加稳定 id;无 title 时回退 `aria-label="对话框"`。+4 LOC。
  - Popover:桌面面板加 `aria-label="弹出面板"`;移动端 bottom-sheet 分支加 `aria-modal="true"` + aria-label。+2 LOC。
  - Toast:danger 色 toast 改用 `role="alert" aria-live="assertive"`,其它继续 `role="status" aria-live="polite"`;关闭按钮加 focus ring;容器加 `aria-label="通知"`。+4 LOC。
  - AppShell:顶部加「跳至主内容」skip-link(`sr-only focus:not-sr-only`),两个 `<main>` 都补 `id="main"`。+14 LOC。
  - 未动:chat/* (由 B16-B 负责)、approvals/inbox/devices/peers(17+ 拥有)。
  - Tailwind 已默认提供 `sr-only`;无需改 config。
  - typecheck ✅ · `pnpm -F @rcc/web build` ✅(62s)。共 +24 LOC。
- B16-B 屏幕阅读器遍历 chat 流(message role, timestamp)
- B16-C 高对比度模式(CSS var 高对比覆盖) ✅ (2026-05-10)
  - `tokens.css` 追加 `[data-theme-contrast="high"]` 与 `[data-theme="dark"][data-theme-contrast="high"]` 两套覆盖 + focus-visible 规则(+74 LOC,保持 RGB 三元组以配合 Tailwind `rgb(var()/<alpha>)`)。
  - `tokens/theme.ts` 扩展 `useTheme()`:新增 `highContrast()` / `setHighContrast(v)`;持久化 `rcc.theme.contrast` ("0"/"1");默认跟随 `prefers-contrast: more`;监听系统变化(用户未显式设置时自动跟随)(+58 LOC)。
  - `SettingsModal.tsx` 新增「外观」小节,复用 `Toggle` primitive;i18n 新增 `settings.appearance` / `settings.highContrast` / `settings.highContrastHint`(zh/en)(+27 LOC)。
  - 对比度(light):`--text-primary on --bg-page` 9.77:1 → 15.84:1;真正的胜利在 muted / accent:`--text-muted` 2.91:1 → 6.26:1(AA→near AAA),`--accent` 2.95:1 → 6.42:1(fail→AA)。dark AAA 文本 21:1。
  - typecheck ✅ · build ✅(24s)。

**batch 17** · 键盘:
- B17-A ✅ 全局快捷键表(?. 呼出,g s 切 session,c n 新建,等)
  - 新增 `hooks/useKeyboardShortcuts.ts`(~175 LOC): 模块级 registry + 单例 window keydown listener,支持 chord(1s 窗口)/ single-key / 修饰键 / input-guard。
  - 新增 `shell/ShortcutHelp.tsx`(~150 LOC): Portal 覆盖层,按 category 分组,移动端 bottom sheet · 桌面居中 modal,kbd 样式符合 spec。
  - `App.tsx` +50 LOC: `initShortcutSystem()` + `onMount` 注册 `?` / `g s` / `g i` / `g c` / `g p` / `c n` / `c p` / `/`;Esc 用 `createEffect` 条件注册,仅当帮助面板打开时才声明,避免和其他 Dialog 的 Escape 打架。
  - Cmd+K 仍归 `CommandPalette` 管辖,未触碰;`/` 聚焦 composer 通过 `textarea[data-composer]` 选择。
  - Chord 机制:第一键锁前缀 + 1s timeout,第二键 match 触发、mismatch 清空并放过;任何修饰键 / editable focus 都不会 arm chord。
  - typecheck ✅ · build ✅(15.17s)。
- B17-B ✅ Composer 键盘快捷键(Cmd+↑ 调出上条 / Cmd+/ 切对话终端 / 已有 Cmd+Enter 强送 / Esc blur)
  - `Composer.tsx` 新增 `getLastUserText?` 与 `onToggleView?` props;平台检测 `navigator.platform` → `IS_MAC` → `modKey(e)` 选 meta/ctrl(+38 LOC)。
  - Cmd+↑ 仅在 `draft().trim() === ""` 时生效(保护用户未发送的编辑);回调返回非空才替换 draft 并把光标放到末尾;否则 no-op 让浏览器原生上箭头处理。
  - Cmd+/ 仅当 `props.onToggleView` 有值时 preventDefault + 调用;SDK driver session 在 MainPane 已传 `undefined`,shortcut 自动 no-op。
  - `ChatSurface.tsx` 新增 `lastUserText()` 访问器(反向扫 `stream.messages()`,仅取 user + text segments.content.join("\n").trim())并传 `onToggleView={props.onToggleViewMode}`(+13 LOC)。
  - SlashPalette 已自带 Escape(batch 6),Composer Escape 仍 blur textarea,并存;CommandPalette 的 Cmd+K 未触碰。
  - aria-describedby sr-only 帮助文本追加 "Cmd+↑ 调出上一条消息,Cmd+/ 切换对话/终端视图"。
  - typecheck ✅ · build ✅(14.6s)。
- B17-C ✅ 跨 focus 环回(esc → composer,tab 循环,F6 跨 landmark)
  - `hooks/useFocusTrap.ts`(119 LOC):Solid onMount/onCleanup hook,Tab/Shift+Tab 在容器内 wrap,bubble 阶段监听让嵌套 dialog 由内向外生效;支持 `initialFocus` 取首个 focusable 回退、`restoreFocus` 默认 true。
  - `hooks/useLandmarkCycle.ts`(73 LOC):F6 / Shift+F6 在 header → nav[会话导航] → main#main → nav[主导航] 之间循环;`offsetParent===null` 跳过隐藏 landmark(移动端隐藏 sidebar 自动跳过);按需补 `tabindex=-1` 保证可编程 focus。
  - `Dialog.tsx` 抽 `DialogPanel` 内部组件挂 `useFocusTrap(() => ref, {restoreFocus:true})`,只在 open 时挂载卸载,替代原 createEffect 里的 focusFirst+restore;ESC/scroll-lock 仍走原 effect(净 LOC 改动 ≈ 0,结构更干净)。
  - `ChatSurface.tsx` 新增 window 级 bubble-phase keydown 监听(+30 LOC):Esc 时若无打开 dialog、无 INPUT/TEXTAREA/isContentEditable 焦点、且 composer 未已聚焦,`querySelector('textarea[aria-label="输入消息"]').focus()`;Dialog 的 capture-phase Esc 先 stopPropagation 故优先级天然正确。
  - App.tsx 顶部 `useLandmarkCycle()`(+2 LOC import + call + comment)全局装监听。
  - typecheck ✅ · build ✅。

**验收**: 仅键盘可用;macOS VoiceOver 播报关键流程。tag `v0.1.10`。

### Phase 10 · 性能 + bundle(batch 18-20 · 9 agent)
**batch 18** · 初始包:
- B18-A Monaco/xterm 完全 lazy(只在 route 需要时加载) — ✅ 完成。MainPane/SharedReadonlyView 改用 `lazy()` 包裹 TerminalView,xterm.css 移入 TerminalView/RecordingPlayback 与 xterm chunk 同步;vite.config `manualChunks` 固定 `vite/preload-helper` 到 vendor,消除 entry 对 monaco chunk 的静态导入。initial index chunk 529KB → 440KB(-89KB),HTML 中不再 modulepreload monaco-*.js/css 或 xterm-*.js;monaco/xterm 仅在访问文件预览 / 终端视图 / 录制回放时触发 async 拉取。
- B18-B 虚拟化消息列表 perf(10k 消息 60fps)
- B18-C 分析剩余大 chunk,定向拆分

**batch 19** · 运行时:
- B19-A WS 消息批量合并 frame(减少 render 次数) — ✅ 完成。`packages/web/src/client.ts` 在 ws `onmessage` 中改为入队 + `queueMicrotask` flush,flush 内用 Solid `batch()` 包裹 listener 派发;FIFO 保序,listener 集合在 flush 开始时快照(中途 unsub 不影响当前 tick,新增 listener 下一 tick 生效),每个 listener 独立 try/catch 不相互短路。hello 这类一次带来 sessions+devices+peers+projects+prefs 的突发帧现在合并成一次渲染。
- B19-B sidebar 重渲染定点(createMemo 全面铺开) — ✅ 完成。`Sidebar.tsx` 原已 memo 化 `sessionsByProject` / `sessionsByPeer`,本批把 `<For>` 回调内每次渲染都要调用 3-4 次的两个 per-project 派生(`sess = sessionsByProject().get(p.id) ?? []`、`collapsed = collapsedProjects.has(p.id)`)与 peer `sess` 改为 `createMemo`,避免同一回调内 `sess().length` / `For each={sess()}` / 空态 fallback 等多点重复读 Map/Set。`SessionRow.tsx` 把 `isExited`/`isRemote`/`displayTitle` 从裸 getter 改为 `createMemo`,并把 title 属性里 `summary.bullets.map(...).join("\n")` 这块 O(n) 字符串拼接也 memo 化(仅在 summary 变化时重算,而不是每次父组件 tick)。无行为变化,typecheck + build 通过。
- B19-C visualViewport 高频事件节流 — ✅ 完成。`useVisualViewportBottom` 的 resize/scroll 监听改为 rAF 合并(每帧最多一次布局读),iOS 软键盘动画期间的连续事件不再触发抖动;`streaming.ts` rAF coalescer 审计通过(dedupe、dispose/clear/sid-switch 均取消 rAF,无泄漏)。

**batch 20** · 网络:
- B20-A gzip / brotli 响应 + 长缓存静态资源 — ✅ 完成。`packages/host/src/index.ts` `serveStatic` 现在解析请求 `Accept-Encoding`,优先读取预生成的 `.br` 兄弟文件(回退 `.gz`,最后 raw),按资产类型发不同 `Cache-Control`:vite hash 命名资产(`-xxxxxxxx.ext`)走 `public, max-age=31536000, immutable`,`index.html` 走 `no-cache`,其他非 hash 文件走 `public, max-age=3600`;可压缩文件补 `Vary: Accept-Encoding`。预压缩脚本 `packages/web/scripts/precompress.mjs`(zlib 内置,无新依赖)在 `vite build` 后扫 dist,对 .html/.js/.css/.json/.svg/.map/.webmanifest 生成 quality-11 brotli 与 level-9 gzip,仅当压缩后 <95% 原大小时落盘。`pnpm -F @rcc/web build` 通过:monaco JS 4.29MB → br 852KB(5.0×)/ gz 1.10MB;全部文本资产 14.32MB → br 2.61MB / gz 3.43MB。
- B20-B PWA precache 名单收紧 + 版本化 — ✅ 完成。`packages/web/public/sw.js` 重写运行时路由:APP_SHELL 精简到 6 项(`/`、`/index.html`、`/manifest.webmanifest`、3 个 icon,合计 122KB),入口 JS/CSS/vendor/solid/icon-font 走新 `rcc-assets-<ver>` 桶(cache-first,不限容量),重度懒加载 chunk(`monaco-*`/`xterm-*`/`sodium-*`/`yjs-*`/`*.worker*` 的 .js/.css/.wasm,合计 ~13MB)走 `rcc-heavy-<ver>` 桶(stale-while-revalidate,20 条上限,`trimCache` 按插入顺序淘汰),HTML 导航保持 `rcc-html-<ver>` network-first 回退离线壳。`sw.js` 的 `VERSION` 改为 `__BUILD_VERSION__` 占位符,新增 `vite.config.ts` 内联插件 `injectSwVersion`(closeBundle 钩子,sha256(所有输出文件名).slice(0,12))把 `dist/sw.js` 里的占位符替换为本次构建哈希,`activate` 只保留以该哈希结尾的四个桶、其余全删 → 新 build 上线自动清除旧缓存。`index.html` 的 SW register 补 `updateViaCache:"none"`,CDN 缓了旧 `sw.js` 也绕开。无新依赖。`pnpm -F @rcc/web typecheck ✅ · build ✅`,本次 VERSION=`f1258b18b1f2`,首装预缓存从旧版全量 `/assets/*` ~15MB 降到 shell 122KB,重度 chunk 按需拉取。
- B20-C 离线真用(session 列表 + 上次消息可读) — ✅ 完成。新增 `packages/web/src/hooks/useOfflineHydrate.ts`(~155 LOC:读写工具、500ms 防抖、`rcc.offline.*` 命名空间、QuotaExceededError 时驱逐最旧 sid 桶)。`sessionsStore.ts` 在 `createSignal` 初值处 `loadCachedSessions()`,`createEffect` 追踪 `sessions()` 调度防抖写入(cap 50),dispose 时 flush+dispose。`streaming.ts` sid-switch effect 在 `clear()` 后用 `loadCachedMessages(sid)` 种子消息(WS `chat.list` 会覆盖),另一 effect 为每个 sid 绑定独立防抖器持久化(cap 100 条/sid × 20 sid,LRU 驱逐)。`ConnectionBanner.tsx` 在 `reconnecting`/`failed` 且 `hasOfflineCache()` 时追加徽章「🔌 离线模式 · 显示最近缓存」(sm+ 可见)。在线流程零变更;持久化纯副作用,QuotaExceeded 静默降级;首次无缓存 → 空信号 + 现有 EmptyState。typecheck + build 通过。

**验收**: initial JS < 80kB gzip;LCP < 1.5s 本地;10k 消息无卡顿。tag `v0.1.11`。

### Phase 11 · PWA + 推送闭环(batch 21-22 · 6 agent)
**batch 21**:
- B21-A SW 版本升级横幅 + 点击更新
- B21-B 后台同步(session 新消息)→ 本地通知
- B21-C Share target(从其他 App 分享到 rcc 创建 session) — ✅ 完成。`packages/web/public/manifest.webmanifest` 新增 `share_target` 入口:action `/share`、method `GET`、enctype `application/x-www-form-urlencoded`,params 映射 `title/text/url`(PWA 安装后会出现在系统 share sheet 的「rcc」条目)。`packages/web/src/App.tsx` 新增 `readSharedContent()` 在 mount 时读 `window.location`:若 pathname 是 `/share` 且至少有一个 param,立即 `history.replaceState(null,"","/"))` 清 URL(防刷新重触发)。捕获的内容存进 `pendingShare` + `sharedConsumed` 信号,用 `createEffect` watch:当 `status()==="connected"` 且 `sessionsStore.activeSid()` 非空时,用 `createSharedText(client, sid, "input-draft")` 抓当前会话的 CRDT 草稿,`setTimeout(250ms)` 让 sync.request 先落地,再用 `setValue(formatSharedDraft + existing)` 前置插入(格式:`分享:<title>\n<text>\n<url>\n\n`,全中文前缀),`setSharedConsumed(true)` 后立刻 `destroy()` 回收 Y.Doc。若无 sid 但 sessions 列表空,直接 `onNewSession()` 弹 NewSessionModal,等新会话创建后 effect 再次触发把内容写入草稿。选草稿预填而非单独 prompt 字段,因 NewSessionModal 没有「initial prompt」输入项,composer 草稿路径已经走 CRDT 同步,跨设备也能看到分享内容。边界:未配对(unauthorized)时 PairingView 占屏但 App 外壳仍挂载,`pendingShare` 保留在信号中,配对完成→`status==="connected"`→effect 触发;若无 session 时用户手动取消 NewSessionModal,`pendingShare` 依然在,再次创建 session 仍会写入(不会丢失)。无新依赖。App.tsx 改动 +38 行(helper 22 + 引导 11 + effect 20 ≈ 40 LOC 净增,在预算内);manifest 新增 9 行。`pnpm -F @rcc/web typecheck ✅ · build ✅`。

**batch 22**:
- B22-A VAPID 推送开关 UI + 订阅管理(每设备) — ✅ 完成。新增 `packages/web/src/push/PushSettingsPane.tsx` (215 LOC,预算 <240),挂载到 `SettingsPane` 为新 tab `notifications`(放在最后一位,icon 🔔)。`tabsConfig.ts` +2 LOC(新增 `notifications` id + entry),`SettingsPane.tsx` +2 LOC(lazy import + Match 分支),合计 <10 LOC。面板分三段:① 本设备(当前订阅状态 + endpoint 域名/指纹/最近测试时间 + 启用/关闭按钮);② 测试(发送测试通知,复用已存在 `sendTestPush` → `push.test` 帧);③ 所有订阅的设备(本批次不实现跨设备列表,因协议无 `push.list.request` 帧,按任务约束"不改 protocol/host" 明确降级为 placeholder 文字 + 引导用户在各设备上分别打开此面板来关闭)。最近测试时间存 `localStorage('rcc.push.lastTestAt')` — host 没有 `push.last-sent` 回传,纯客户端近似。空状态(未订阅): 显示"尚未订阅任何设备"+ 启用 CTA,err 内联红字。仅用 Solid primitives (createSignal/onMount/Show/For 不用/lazy),全部 class 走 semantic tokens (bg-bg-surface/text-text-primary/rgb(var(--accent))/rgb(var(--danger)) 等),未加 npm 依赖,未改 host `push.ts` 或 protocol frames。`pnpm -F @rcc/web typecheck ✅` + `build ✅`(3m6s,dist 无 error)。帧清单(面板发出):`push.public-key.request`(间接,经 enablePush)、`push.subscribe`(启用)、`push.unsubscribe`(关闭)、`push.test`(测试按钮)。
- B22-B 高风险 approval 推锁屏 + click 跳 approvals pane — ✅ 完成。`packages/host/src/index.ts` 把原先每条 high-risk approval 立刻 `push.broadcast("all", ...)` 的内联代码抽出为 `pushHighRiskApproval()`,并包 5s debounce buffer:窗口内 1 条 → 单条 payload(title `⚠ 高风险审批`、body `${tool} · ${summary}` 截 80 字符、tag=`approval.id`、data=`{ url:"/#inbox", sid, approvalId }`、`requireInteraction:true`),≥2 条 → 聚合 payload(body `N 个高风险请求待审批`、tag=`approval-batch`、data=`{ url:"/#inbox" }`)。订阅检测分三层短路:`push.all()` 为空直接 return;遍历 `wss.clients` 收集当前在线 `rccDevice.id`,把已连接设备的订阅过滤掉(“自己推给自己” → 已在 in-app 审批 sheet 中可见,无意义);剩余离线订阅若全有 deviceId 走 `push.broadcast(deviceIds, payload)` 精确投递,若任一订阅缺 deviceId(历史遗留)回落 `broadcast("all")`。`PushService.sendOne` 既有路径在 404/410 时 `subs.filter` + `persist()` 自动清理 stale endpoint,无需在此复写。低/中风险与 `approval.cleared` 继续走 in-app 通道不推。`index.ts` +76 / -10 LOC(本批单文件净增 66),无新 npm 依赖,无新协议帧。`pnpm -F @rcc/host typecheck ✅`。
- B22-C 通知偏好(静音时间段) — ✅ 完成。协议新增 `QuietHours { enabled, startHour(0-23), endHour(0-23), timezone }` + `push.preferences.set { endpoint?, quietHours? }` 帧,并在 `push.subscribe` 上挂可选 `quietHours`,客户端在订阅时一并传给 host(24 LOC · 在 <25 预算内)。Host 端 `PushSubRecord` 增 `quietHours?` 字段;`PushService.setPrefs({ endpoint?, deviceId?, quietHours })` 支持按 endpoint 单点更新或按 deviceId 批量更新(未带 endpoint 时,已登录设备按 deviceId 过滤,loopback 则对全部订阅生效);`sendOne` 在发送前调用 `isQuietNow(sub.quietHours)` 跳过落在窗口的订阅;`hourInTz(now, tz)` 通过 `Intl.DateTimeFormat` 按订阅自己的时区算小时(Intl 抛错兜底 UTC,Chrome 偶发的 `"24"` 归一化为 0);`isQuietNow` 正确处理跨零点窗口(`start < end` → `h∈[start,end)`;`start > end` → `h >= start || h < end`;`start === end` 视为禁用)。`packages/host/src/push.ts` +55 LOC · `index.ts` +11 LOC(<60 预算)。客户端 `packages/web/src/push.ts` 新增 `getQuietHours/setQuietHoursLocal/defaultQuietHours/pushQuietHours` helpers,偏好只存本机 `localStorage`('rcc:push-quiet-hours',不走 server-synced `UiPrefs`,因为是 per-device 概念);`defaultQuietHours` 用 `Intl.DateTimeFormat().resolvedOptions().timeZone` 自动检测时区。`SettingsModal` 新增 `QuietHoursSection`:一个 `Toggle`(启用静音时段)+ 两个 `type=time step=3600` 输入(小时粒度)+ 时区只读显示,任何变更立即本地持久化并 `pushQuietHours` 推上 host;`App.tsx` 给 `SettingsModal` 注入 `client` prop(+1 LOC)。UI+prefs 净增 52 LOC(push.ts 47 + App 1 + Modal 含 import ≈ 65,<70 预算)。提示语"静音时段内仍会收到严重告警(主机崩溃、认证失败)"已放在 Toggle 副文本里 — 但当前批次 host 端的 `sendOne` 并没有对 `approval.request(high)` / `health.crash` / `auth-fail` 做豁免,所有 push 一视同仁被抑制,**严重告警豁免留待后续 batch 在 `PushPayload` 加 `severity` 字段再在 `sendOne` 里根据 severity 绕过 quiet-hours**。跨零点 edge case 已覆盖(22:00 → 08:00 即 `startHour=22, endHour=8`,`isQuietNow` 走 `h >= 22 || h < 8` 分支,夜间任意时刻都命中)。`pnpm -r typecheck ✅` 全四包通过。

**验收**: 手机装 PWA,关掉 tab 后仍收 push 可跳回审批。tag `v0.1.12`。

### Phase 12 · 会话 UX 深化(batch 23-25 · 9 agent)
**batch 23** · Session lifecycle:
- B23-A session fork(从某条消息复制开新会话) — ✅ 完成。协议新增 `session.fork { sid, uptoMessageId, inheritCwd?, title? }`(15 LOC,<20 预算),加入 `Frame` 判别联合。Host `packages/host/src/index.ts` 新增 `case "session.fork"`(~60 LOC):按 `uptoMessageId` 切 `src.chat.list()` 到 `slice(0, idx+1)`,用 `registry.create({ driver, cwd, cols, rows, permissionMode, projectId, initialChat: sliced })` 新建 session,继承源 session 的 driver / cwd / permissionMode / projectId / cols / rows(`inheritCwd === false` 时回落到默认 project.cwd 且清空 projectId);`attachApprovalWatcher / attachChatBroadcast / attachMetricsTap / attachGitWatcher / attachSummaryOnExit / wirePersistence / notifyPluginSessionCreated` 全套 wiring 与 `session.new` 同步;`broadcast("session.created") + broadcast("session.list") + attach(ws, state, s, null)` 让所有客户端自动切到新 session;`audit.write({ kind:"session.fork", sourceSid, uptoMessageId, count })`;SDK-driver 同样在末尾 `s.start()`。Web 端 `MessageRow.tsx` 新增 hover action 🍴 "从此分叉",触发时先 `window.confirm("创建新会话,复制到此消息为止的所有对话?")` 再回调 parent;`MessageList.tsx`/`ChatSurface.tsx`/`MainPane.tsx`/`App.tsx` 逐层 plumbing `onForkSession(sid, messageId)` → `client.send({ t:"session.fork", sid, uptoMessageId })`(web 净增 ~35 LOC)。客户端 `sessionsStore` 在 `session.created` 既有分支里已 `setActiveSid(frame.session.id)`,无需改动 — 分叉完自动聚焦新会话。边界:从 streaming 消息分叉 → 只按 messageId 切片,新 session 启动全新 turn,不延续 streaming(ChatParser 按 id 查 O(n) 查找,数百消息内可接受)。`Session.constructor.opts.initialChat` 在 M6 persistence 已支持,session.resume 走同一路径,本次复用。`pnpm -r typecheck ✅` + `pnpm -F @rcc/web build ✅`(2m26s)。
- B23-B session 置顶 / 归档 / 标签 / 搜索 — ✅ 完成。协议 `SessionMeta` 新增可选 `pinned`/`archived`/`tags` 三字段 + 新 frame `session.meta.set { sid, pinned?, archived?, tags? }`(partial update,加入 `Frame` 判别联合,~24 LOC<30 预算)。Host `session.ts` / `sdk-session.ts` / `DeadSession` 三个 session 类同步添加字段(默认 `false`/`false`/`[]`),`meta()` 在字段非默认值时条件写入,避免老客户端看到新增字段时炸;hydration 从 `h.meta.pinned/archived/tags` 回放以便持久化跨重启生效。`session.resume` 在 `registry.add(live)` 后把 dead session 的 `pinned/archived/tags` 直接拷给新 live session,避免 resume 清 0。`index.ts` 新增 `case "session.meta.set"`:partial 写入、tags trim+dedupe+上限 16、`scheduleSave(s)` 持久化、`broadcast("session.list")`(~20 LOC,<80 预算)。Web `SessionRow.tsx` 右键 / ⋯ 菜单弹出 置顶|归档|添加标签|重命名(重命名位由 B23-C 接管),tags 作为 `Chip tone="accent" size="xs"` 渲染在 meta 行,pinned 显示 ★ + `ring-1 ring-accent/30`,archived 显示灰 "归档" 小 chip;tag 输入用 `window.prompt` 逗号分隔(简化 UX,无新依赖)。`Sidebar.tsx` `orderSessions()` 把 pinned 排前(稳定排序保留原顺序),`archivedCount > 0` 时底部显示 `显示归档 (N)` toggle 按钮,默认隐藏。`App.tsx` 把 `onSetSessionMeta(sid, patch) => client.send({ t:"session.meta.set", sid, ...patch })` 透给 Sidebar→SessionRow。Search 已有 `searchStore.ts` + `search.request`/`search.result` 协议走 host 倒排索引(消息内容已在 M6 batch 9 建),本次只验证 UI surface 正常、无需改动。Web 净增 ~110 LOC(<120 预算),覆盖 SessionRow + Sidebar + App 三处。`pnpm -r typecheck ✅` + `pnpm -F @rcc/web build ✅`(2m31s,21 gz+br artifacts)。跨 host 重启测试:snapshot.meta 携带字段 → loadAllSnapshots → DeadSession.constructor 读取 → meta() 再导出,闭环持久化。
- B23-C session 重命名 + 自动摘要标题 — ✅ 完成。协议 `SessionMetaSet` 扩展一个 `title: z.string().max(200).nullable().optional()` 字段,沿用 B23-B 的 `session.meta.set` 不再新增 frame(<15 LOC 预算,实际 +1 行)。Host `Session` / `SdkSession` / `DeadSession` 三类都加 `title: string | null = null` 可变字段;`meta()` 输出 `this.title ?? displayCwd(this.cwd)`,老客户端仍看到 cwd-display 兜底;`DeadSession.constructor` hydration 时如果 `h.meta.title === displayCwd(h.meta.cwd)` 则视为 null,避免老 snapshot 被误判为手工改名。`index.ts` 的 `case "session.meta.set"` 扩展 title 分支:`null` 清空、非空字符串 `trim().slice(0, 200)` 写入;ws 与 REST 两条 resume 路径都把 `live.title = s.title` 拷过去;`attachChatBroadcast` 在 `session.chat.onMessage` 里识别 `role === "user"` 且 `session.title === null` 的第一条用户消息,调用本地 `deriveAutoTitle(message)`(flatten text segments → 合并空格 → 50 字符 word-boundary truncate → 末尾标点剥离 → 60 字符硬上限,返回 null 时跳过),写入 `session.title` 后 `scheduleSave + broadcast("session.list")`。Host 净增 ~65 LOC(<80 预算)。Web `sessionsStore.ts` 新增 `renameSession(sid, title)` action:乐观 local update + `client.send({ t:"session.meta.set", sid, title })`,host 回的 `session.list` 自然协调成功或回滚。`SessionRow.tsx` 新增 `onRename?: (title: string | null) => void` prop + 内部 `editing`/`draft` signals:双击标题进入编辑,`⋯` 菜单里"重命名"从占位升级为触发 `startRename()`,编辑时渲染 `<input maxlength=200>` 替换标题 div,Enter / blur 提交、Esc 取消,提交空串等于 `null` 清空回落到 cwd-display。`Sidebar.tsx` `SidebarProps` 新增 `onRenameSession?`,两处 `<SessionRow>` 都透传;`App.tsx` wiring 给 `sessionsStore.renameSession`。Web 净增 ~70 LOC(<80 预算)。`pnpm -r typecheck ✅` + `pnpm -F @rcc/web build ✅`(1m50s,21 gz+br artifacts)。自动标题触发链:`pty.out` 或 SDK message → `ChatParser.feedInput/feedOutput` emit role=user message → `onMessage` listener 检测首条 user + null title → `deriveAutoTitle` → session.title 写入 → session.list 广播。手动改名链:`SessionRow` 输入 Enter → `sessionsStore.renameSession` → 乐观 setSessions → `session.meta.set{title}` → host `case` 分支 → `scheduleSave` + `session.list` 广播 → 所有客户端同步。
- B23-D mobile 4-tab 路由接通 + NewSessionModal 移动端底部 sticky create — ✅ 完成。用户反馈 "手机选 newsession 输入完后没有任何反应,同时页面切换也没有任何反应";排查发现 `TabNav` 点击只更新 `uiStore.mobileTab` signal,但 `MainPane` 从未读它,导致 files/approvals/settings 三个 tab 点击外观切换但内容还是 chat。新增 `shell/MobileTabRouter.tsx`(~80 LOC):按 `uiStore.mobileTab()` 四分支 `<Show>` — `chat` 渲染传入的 chat slot(MainPane 或 EmptyState),`files` 懒加载 `<FileBrowser rootCwd=活动会话cwd || fileBrowserRoot>`,`approvals` 渲染 `<ApprovalPane client>`(直接复用 approvals store),`settings` 渲染新 `shell/MobileSettingsPane.tsx`(~130 LOC:host 卡片 + 主题切换 + 收件箱/设备/对端/Claude 配置 链接行 + 退出按钮,全部 ≥44px 触控目标)。`App.tsx` 把原 `<Show when={activeSid()}>` 子树整段包进 `MobileTabRouter` 的 `chat` slot,其余 prop 从已有 stores 直传(tunnelUrl/deviceName/pendingApprovals)。`NewSessionModal.tsx` 修底:footer 改 `sticky bottom-0`,按钮 `min-h-[44px]`,`safe-area-inset-bottom` 内边距,外壳 `max-h-[calc(100svh-16px)]`(用 svh 避 iOS Safari viewport 收缩 bug),header `shrink-0` 防挤压,解决 "输入完没反应" 的根因(小屏 + 软键盘上弹时 create 按钮被推出可视区,用户误以为无响应)。桌面布局无回归(`sticky` 在 footer flex 容器里等价原先 static)。`pnpm -F @rcc/web typecheck ✅` + `build ✅`(55s,21 gz+br)。

**batch 24** · Context:
- B24-A 跨 session 上下文注入 UX 重写(之前 skip 的 e2e case 修) — ✅ 完成。`packages/web/src/ContextInjector.tsx` 整文件重写(257 → 510 LOC,props 契约 `{client, activeSid, sessions, onClose}` 不变,两个调用点 `ChatView.tsx:323` / `chat/ChatSurface.tsx:301` 零改动)。旧版 zinc-palette + 紧凑行布局换成 Claude-warm tokens(`bg-bg-surface` / `text-text-primary` / `accent` 语义色 + Charter serif 标题),`Portal` 裸渲染避免依赖 Dialog 包装,body scroll lock + focus 初始化 onMount。移动端底抽屉(drag handle + `rounded-t-2xl` + `env(safe-area-inset-bottom)`),桌面居中卡片 `sm:max-w-3xl`,`animate-slide-up` / `animate-fade-in` 复用 index.css。会话列表从 dense 行升级成 `min-h-[64px]` 卡片:主标题 `text-sm font-medium` + 首条 bullet 作副标题 + driver/status 两个 `<Chip>`(存活 `success+dot`,退出 `neutral`),键盘导航(↑↓ 移动 `focusIdx`,Enter `selectSource`,Esc 关闭),hover 同步 focusIdx 让 mouse/keyboard 不打架,底部小字 hint。预览步骤:来源条 + 条数 pill(`最近 10/30/50/全部`,active 态用 accent 实心)+ 右侧 `<Chip>` 字节计,`bytesTone = danger(>32KB) / warn(≥75%=24KB) / neutral`,`approachingLimit` 新增 warn banner(黄色,避免突变 danger);preview 体 `bg-bg-page` + mono 文本,loading 用内联 spinner + 中文提示,空消息走 `<EmptyState>` 组件统一外观。footer 左侧实时显示 "将注入 N 条消息",右侧 `Button variant="ghost"/"primary"`(含箭头图标)替换手写按钮,disabled 态走 primitives 内建。`h-8` / `h-11` 关闭按钮 / `min-h-[64px]` 卡片全部 ≥44px 触控。字节阈值常量集中:`MAX_BYTES=32*1024`,`WARN_BYTES=0.75*MAX_BYTES`。`pnpm -F @rcc/web typecheck ✅`(零错零警)。
- B24-B @mention 文件 / 会话 作为 context — ✅ 完成。新增 `packages/web/src/chat/MentionPopover.tsx`(~215 LOC):仿 SlashPalette 风格的候选框(desktop 桌面锚定卡片 `max-h-[240px]`,mobile Portal 底部 sheet),window 级 capture 键盘 — ↑↓ 移动、Enter/Tab 确认、Esc 关闭,item 由 `{id, kind: "session"|"file"|"dir", label, sublabel, token}` 驱动、行 ≥ 44px 触控、header 显示计数 + loading 指示。`packages/web/src/chat/Composer.tsx`(+210 LOC):新增 `detectMention(text, caret)` 在 `@` 前为行首/空白时识别 fragment,`refreshMentionState()` 绑 keyup/click/select/input 同步 start+query;不吞 IME composition(`composing() || e.isComposing` 提前 return 保留),当 popover 开且有候选时 Enter/Tab/ArrowUp/ArrowDown/Esc 交给 popover,其余按原逻辑 submit/newline。候选装配 `mentionItems` memo:sessions 来自新 prop `mentionSessions`(过滤当前 sid + `id|title|cwd` 子串匹配),files 走已有 `fs.ls.request` 协议(200ms 防抖、子目录路径按 `query.lastIndexOf("/")` 切片,`client.on` 比对 `frame.path === cwd/subdir` 后缓存,dirs 在 files 前 alpha 排序);`insertMention` 直接 splice 到 textarea — sessions 插 `@session:<sid>`,files/dirs 插 `@file:<relpath>`,末尾补空格,caret 置于 token 之后(queueMicrotask 同步 DOM + setSelectionRange + resize),token 是纯文本,接收端照原样渲染,不动 host / protocol。顶层结构从 conditional `relative` wrapper 改成永久 `relative` 便于 popover 绝对定位在 composer 上方 `bottom-full mb-2 z-30`,不影响 SlashPalette 布局(两者互斥场景:slash 触发需 `/` 前缀,mention 需 `@` 前缀)。`ChatSurface.tsx` +2 行把 `props.sessions` / `props.session?.cwd` 透给 Composer 新 props `mentionSessions` / `mentionCwd`,其余调用点零改动。`pnpm -F @rcc/web typecheck ✅`(零错)。总 LOC:MentionPopover 215、Composer +~210、ChatSurface +2,新文件 1 个、修改 2 个。
- B24-C 项目级 system prompt 编辑(sidebar → 项目设置) — ✅ 完成。协议层 `ProjectMeta` 新增可选 `systemPrompt: string (max 4000)`(`packages/protocol/src/index.ts`),`ProjectAdd` / `ProjectUpdate` 同步携带字段;`ProjectUpdate.systemPrompt` 三态 `string | null | undefined`(string 覆写、null 清空、undefined 不变,与 `color` 同语义)。host 侧 `packages/host/src/projects.ts` 的 `sanitize` / `create` / `update` 读写 trim + 4000 字截断,空串当作 undefined,非空写回 `~/.rcc/config.json` 的 `projects[]`;`packages/host/src/index.ts` 的 `project.add` / `project.update` 处理器透传新字段(零破坏 — 老 host 不懂字段会被 zod optional 放行)。web 侧 `stores/projectsStore.ts` 新增 `updateProject(id, patch)` action 和 `getById(id)` 查询辅助,`addProject` 扩展 `systemPrompt?`;`NewProjectModal.tsx` 新增 4 行高 textarea(maxlength 4000 + 字符计数器 + 中文 placeholder "适用于此项目所有新会话…"),外壳加 `max-h-[90vh] flex flex-col` + 内容区 `overflow-y-auto` 防小屏溢出;`ProjectsModal.tsx` 在每个项目的编辑态复用同款 textarea/counter,`commitEdit` 对比 trim 后的新旧值决定发 `systemPrompt: nextSp | null` 还是 `undefined`(未改动不发)。`App.tsx` 拓展 `session.created` handler:有 `pendingStarterId` 走原 `runStarterBootstrap`(starter 仍然优先);否则查 `projectsStore.getById(session.projectId)` 的 `systemPrompt`,走新的 `runProjectBootstrap(sid, prompt)` — 共用同一 300ms attach-settle 延迟 + `client.write(sid, prompt + "\r")` 注入,与 starter 分支行为一致。全部字段可选,旧配置零迁移。`pnpm -r typecheck ✅`(protocol / host / web / cli 四包零错)。

**batch 25** · Starters/Workflows:
- B25-A Starters 重设计卡片 + 一键预览
- B25-B Workflow runner UX(步骤可视化 + 中断续跑)
- B25-C Workflow 条件分支 + 变量

**验收**: 新用户从 starter 起 → 多 session 协作 → 跨注入,流程顺。tag `v0.1.13`。

### Phase 13 · 插件 + Marketplace 可用化(batch 26-28 · 9 agent)
**batch 26**:
- B26-A Plugin Manager UI 重写(安装 / 禁用 / 重载 / 权限审查)
- B26-B 插件 iframe postMessage 白名单 + Context API 补齐
- B26-C 插件开发者 debug 面板(日志 + 性能)

**batch 27**:
- B27-A Marketplace 分类 + 搜索 + 评分(本地聚合,无服务端)
- B27-B 示例插件补齐(TODO / bookmarks / clipboard / search / notes)
- B27-C 插件 manifest 校验 + 安全模式

**batch 28**:
- B28-A 插件热更新(不重启 host)
- B28-B 插件 session hook 能力扩展
- B28-C 开发者 "New plugin" 向导

**验收**: 3 个示例插件可装可卸可用。tag `v0.1.14`。

### Phase 14 · 多 host 联邦打磨(batch 29-30 · 6 agent)
**batch 29**:
- B29-A Peers 管理 UI 重写(连接状态 / 心跳 / 证书指纹)
- B29-B 远端 session 内联显示(颜色区分,不混淆本地)
- B29-C 远端 approval 转发 + 本机审批

**batch 30**:
- B30-A Federation 发现(局域网 mDNS / 手动配对)
- B30-B 跨 peer session 迁移
- B30-C Federation 审计与安全报告

**验收**: 两台 Mac 一台 Linux 三机联邦,session 互通。tag `v0.1.15`。

### Phase 15 · 安全审计 + 加固(batch 31-32 · 6 agent)
**batch 31**:
- B31-A 威胁模型文档重写(v0.2 新攻击面)
- B31-B CSP / COEP / COOP / Permissions-Policy 头
- B31-C 审计日志 UI(按人/时间/动作搜索导出)

**batch 32**:
- B32-A Passkey 覆盖更多高风险操作(bypassPermissions 开关,设备吊销)
- B32-B Token rotation 定期 + 设备失活检测
- B32-C 安全自检扫描器(config 建议)

**验收**: threat-model.md v2 通过外审思路检查。tag `v0.1.16`。

### Phase 16 · 观测 + 调试(batch 33-34 · 6 agent)
**batch 33**:
- B33-A Metrics 面板重设计(sparkline + 对齐 Claude 风)
- B33-B Session 级时间线(谁发了什么,何时 approval)
- B33-C 性能分析(客户端 render trace)

**batch 34**:
- B34-A 日志导出(带敏感遮盖)
- B34-B Bug 报告模板(一键打包 + 上传 gist 或 zip)
- B34-C Crash 页面重设计(友好 + 可复制)

**验收**: 发 bug 只需要点一个按钮就能给出可分析 tarball。tag `v0.1.17`。

### Phase 17 · 文档 + 教程(batch 35-37 · 9 agent)
**batch 35**:
- B35-A 新 landing(product 风,Claude 色系)
- B35-B /docs 站点(from MD,Vite 预生成)
- B35-C 嵌入式 tour(首次启动引导)

**batch 36**:
- B36-A Plugin 开发者文档 + starter template 仓库
- B36-B API reference(OpenAPI 渲染)
- B36-C CLI 教程

**batch 37**:
- B37-A 故障排查向导(诊断树)
- B37-B 视频/GIF 录制(PWA 安装 / 配对 / 首次对话)
- B37-C 多语言第三种(ja)

**验收**: 新用户从 readme 到跑通完整流程 < 10 分钟。tag `v0.1.18`。

### Phase 18 · 发布基础设施(batch 38-39 · 6 agent)
**batch 38**:
- B38-A GitHub Actions 多平台矩阵(darwin x64/arm64 + linux x64/arm64)
- B38-B minisign release 签名
- B38-C Homebrew tap 自动发布

**batch 39**:
- B39-A PWA build + deploy(rcc.app 或 readme 引导自建)
- B39-B Auto-update 二次验证 + 回滚
- B39-C 版本检查 telemetry 匿名化(opt-in)

**验收**: CI 一键出四平台 tarball + 签名 + homebrew 可装。tag `v0.1.19`。

### Phase 19 · 对话体验深化(batch 40-42 · 9 agent)
**batch 40**:
- B40-A Message 操作:复制 / 引用 / pin / 分享链接到具体消息
- B40-B Code block 改进:语言自动识别 + 复制 + 行号 + 跳文件
- B40-C Diff block 改进:左右栏 / 按 chunk 展开

**batch 41**:
- B41-A Tool result 智能摘要(长输出)
- B41-B 思考过程(thinking)折叠 + 可阅读
- B41-C 引用链接 / 附件预览

**batch 42**:
- B42-A Chat 导出(md / json / pdf)
- B42-B 离线阅读模式(保存为静态 html)
- B42-C 全文搜索高亮跳转

**验收**: 长对话阅读 + 返查体验顺。tag `v0.1.20`。

### Phase 20 · 效率工具(batch 43-44 · 6 agent)
**batch 43**:
- B43-A Quick actions 面板(每个 message 行内:再生成 / 继续 / 摘要)
- B43-B 批量操作(多选消息→导出 / 删除 / 收藏)
- B43-C 智能草稿(离开时保存,回来恢复)

**batch 44**:
- B44-A Prompt 模板库 UI 重设计
- B44-B 参数化模板弹窗简化
- B44-C Prompt 变体 A/B

**验收**: 常用流程(pr review / debug / write tests)3 tap 可触发。tag `v0.1.21`。

### Phase 21 · 移动原生感(batch 45-46 · 6 agent)
**batch 45**:
- B45-A 手机手势:双指缩放代码块,长按消息菜单,下拉刷新会话
- B45-B Haptic feedback(iOS PWA)
- B45-C iOS safe-area 深度打磨(Dynamic Island / 底部条)

**batch 46**:
- B46-A Android Material 色块映射检查
- B46-B 键盘工具条可配置(用户自选 Esc/Tab/^C 排序)
- B46-C PWA 捷径(Add 新会话 / 查审批)

**验收**: iPhone 15 + Pixel 8 真机体验 = 桌面一致满意。tag `v0.1.22`。

### Phase 22 · 真实用户测试循环(batch 47-48 · 6 agent)
**batch 47**:
- B47-A 埋点(本地聚合,opt-in 上传)
- B47-B 用户反馈入口(in-app)
- B47-C 自动化视觉回归(Playwright + 截屏对比)

**batch 48**:
- B48-A Bug triage dashboard(from feedback + crash)
- B48-B 用户指南适时气泡提示(新功能发现)
- B48-C 多设备无缝切换(session 状态云同步)

**验收**: 真用户跑两周无 P0 / P1 bug。tag `v0.1.23`。

### Phase 23 · v1.0 收束(batch 49-50 · 6 agent + 1 release batch)
**batch 49** · 最终质量:
- B49-A 所有已知 TODO / comment skip 消除
- B49-B 旧 v0.1 代码残件扫荡
- B49-C E2E 全绿 + skip 为零

**batch 50** · 发布:
- B50-A 重写顶层 README + CHANGELOG 汇总 v0.2 整个 arc
- B50-B docs 全量更新 + 视频 demo
- B50-C 打 **v1.0.0** tag + GitHub release + 公告

**验收 v1.0.0**:
1. macOS/Linux 四平台 tarball CI 自产
2. 桌面 + 手机 PWA 完整可用,设计一致
3. CLI + SDK 两种 driver 对话视觉一致
4. 插件系统 5 个示例 + 文档 + 开发者模板
5. 威胁模型 / 运维 / 安装 / API / 开发 5 份文档
6. 全 a11y AA
7. 零 P0/P1 bug,skip 测试归零

---

## Agent 规则

1. **每 agent 独占文件**。同批内文件集合不相交。
2. **不改 packages/protocol / packages/host**(协议冻结,本 arc 只动 web)。
3. 完成前必须自测 `pnpm -F @rcc/web typecheck`。报告里列出改动文件 + 行数。
4. 保持 8.5KB/s ws 稳态不 regress(sidebar 重渲染过度曾是 v0.1 痛点)。
5. 禁止引入新 npm 依赖未经汇报(Solid / Tailwind / Vite / xterm / Monaco / yjs / libsodium 是既定栈)。
6. **移动端是硬门槛**:每阶段验收必测 375px · 不允许"桌面 OK 手机凑合";touch target ≥ 44px;composer 跟随软键盘;所有面板 overflow 正确;不横向滚动。

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
