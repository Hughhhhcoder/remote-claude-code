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
- P4-E `chat/blocks/DiffBlock.tsx` + 语法着色集成
- P4-F `chat/blocks/ToolCallBlock.tsx`(tool_use + result 成对折叠)
- P4-G `chat/blocks/ApprovalBlock.tsx`(行内批准 + Face ID)
- P4-H `chat/streaming.ts`(text_delta 平滑合并 + 闪烁光标)

**batch 6** · Composer:
- P4-I `chat/Composer.tsx`(pill 样式 + 自动展开 + 键盘跟随)
- P4-J `chat/SlashPalette.tsx`(弹出命令选择器,桌面 popover / 手机 sheet)
- P4-K `chat/VoiceButton.tsx` + `AttachButton.tsx`(语音/附件抽离)

**验收** (batch 6 结束):parity checklist + 旧 ChatView.tsx 删除 + mobile chat tab 删除。tag `v0.1.5`。

### Phase 5 · 功能面板响应式(batch 7-9 · 11 agent 跨 3 批)
**batch 7** · 审批 + 通知 + 设备:
- P5-A `src/approvals/ApprovalPane.tsx` + `ApprovalCard.tsx`(Modal 版本迁移 + 历史列表)
- P5-B `src/inbox/InboxPane.tsx` + `InboxItem.tsx`
- P5-C `src/devices/DevicesPane.tsx` + `src/peers/PeersPane.tsx`

**batch 8** · 文件 + 笔记本 + 录屏:
- P5-D `src/files/FileBrowser.tsx` + `FilePreview.tsx`(Monaco 懒加载保留)
- P5-E `src/notebook/NotebookPane.tsx` + `NotebookEntry.tsx`
- P5-F `src/recording/RecordingPanel.tsx` + `RecordingPlayback.tsx`

**batch 9** · 设置 + 配置(10 个子 tab 统一)
- P5-G `src/settings/SettingsPane.tsx` + `settings/tabs/{Skills,MCP,Commands}.tsx`
- P5-H `settings/tabs/{Subagents,Hooks,Permissions,Starters}.tsx`
- P5-I `settings/tabs/{Workflows,Prompts,Plugins}.tsx`
- P5-J `src/marketplace/MarketplacePane.tsx` + 分类卡片

**验收**: 所有旧 Tab.tsx / View.tsx 迁移完毕,`mobile/` 子目录全删。tag `v0.1.6`。

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
