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
- **B10-A** 删 `mobile/` 7 文件 + `MobileKeyBar` + `useIsMobile` + 旧 `ChatView.tsx` 残件;`App.tsx` 彻底清掉桌面硬分支
- **B10-B** `PairingView.tsx` 重设计(卡片居中,6 位码 mono 大字体,暖底)
- **B10-C** `CommandPalette.tsx` 视觉升级(serif / accent)+ 跨平台快捷键提示

**验收**: `grep -r "useIsMobile\|MobileKey\|mobile/" src/` 为空。`pnpm build` 体积降低。tag `v0.1.7`。

### Phase 7 · CLI session 真对话(batch 11-13 · 9 agent)
把 CLI-driver 的 pty 输出从 xterm ANSI 流转成真实 chat 气泡 — 不依赖 SDK driver。

**batch 11** · 解析强化:
- B11-A host 新增 `packages/host/src/chat-parser.ts` v2(状态机替代 regex,支持 tool_use inline)
- B11-B 协议 `chat.delta` frame(text delta + segment 流式)
- B11-C host 端 pty→chat 流水线重写

**batch 12** · 前端消费:
- B12-A `chat/streaming.ts` 接 `chat.delta`
- B12-B CLI session Composer 行为修复(/command 识别,/clear 确认)
- B12-C 长输出自动折叠 + "展开全部"

**batch 13** · 边界 case:
- B13-A ANSI escape / cursor control 残留剥离测试
- B13-B 中断恢复(session 重连后补帧)
- B13-C 大 session(>10MB history)滚动流畅

**验收**: 真 `claude` CLI session 里的消息和 SDK session 视觉一致。tag `v0.1.8`。

### Phase 8 · 错误恢复 + 健壮性(batch 14-15 · 6 agent)
**batch 14** · 前端错误边界:
- B14-A 全局 `ErrorBoundary.tsx` + 友好报错页 + "复制报告"按钮
- B14-B ws 断线 UX(横幅 + 自动重连进度)
- B14-C host crash → 重启检测 + session 自动 resume

**batch 15** · 数据一致性:
- B15-A 乐观更新回滚(approval / session.close)
- B15-B 并发同 session 多端输入冲突处理(CRDT 已有,UI 提示)
- B15-C 时钟漂移导致 replay 窗口失败的降级提示

**验收**: 手动杀 host / 拔网线 / 同 session 两端输入,UI 不崩溃,信息清晰。tag `v0.1.9`。

### Phase 9 · 可访问性 + 键盘(batch 16-17 · 6 agent)
**batch 16** · a11y:
- B16-A 所有 primitives 加 aria-*,role,focus ring 达到 WCAG AA
- B16-B 屏幕阅读器遍历 chat 流(message role, timestamp)
- B16-C 高对比度模式(CSS var 高对比覆盖)

**batch 17** · 键盘:
- B17-A 全局快捷键表(?. 呼出,g s 切 session,c n 新建,等)
- B17-B Composer: Cmd+↑ 编辑上条,Cmd+K 命令面板,Cmd+/ 切 tab
- B17-C 跨 focus 环回(esc → composer,tab 循环)

**验收**: 仅键盘可用;macOS VoiceOver 播报关键流程。tag `v0.1.10`。

### Phase 10 · 性能 + bundle(batch 18-20 · 9 agent)
**batch 18** · 初始包:
- B18-A Monaco/xterm 完全 lazy(只在 route 需要时加载)
- B18-B 虚拟化消息列表 perf(10k 消息 60fps)
- B18-C 分析剩余大 chunk,定向拆分

**batch 19** · 运行时:
- B19-A WS 消息批量合并 frame(减少 render 次数)
- B19-B sidebar 重渲染定点(createMemo 全面铺开)
- B19-C visualViewport 高频事件节流

**batch 20** · 网络:
- B20-A gzip / brotli 响应 + 长缓存静态资源
- B20-B PWA precache 名单收紧 + 版本化
- B20-C 离线真用(session 列表 + 上次消息可读)

**验收**: initial JS < 80kB gzip;LCP < 1.5s 本地;10k 消息无卡顿。tag `v0.1.11`。

### Phase 11 · PWA + 推送闭环(batch 21-22 · 6 agent)
**batch 21**:
- B21-A SW 版本升级横幅 + 点击更新
- B21-B 后台同步(session 新消息)→ 本地通知
- B21-C Share target(从其他 App 分享到 rcc 创建 session)

**batch 22**:
- B22-A VAPID 推送开关 UI + 订阅管理(每设备)
- B22-B 高风险 approval 推锁屏 + click 跳 approvals pane
- B22-C 通知偏好(静音时间段)

**验收**: 手机装 PWA,关掉 tab 后仍收 push 可跳回审批。tag `v0.1.12`。

### Phase 12 · 会话 UX 深化(batch 23-25 · 9 agent)
**batch 23** · Session lifecycle:
- B23-A session fork(从某条消息复制开新会话)
- B23-B session 置顶 / 归档 / 标签 / 搜索
- B23-C session 重命名 + 自动摘要标题

**batch 24** · Context:
- B24-A 跨 session 上下文注入 UX 重写(之前 skip 的 e2e case 修)
- B24-B @mention 文件 / 会话 作为 context
- B24-C 项目级 system prompt 编辑(sidebar → 项目设置)

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
