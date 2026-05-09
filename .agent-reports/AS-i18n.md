# AS-i18n (Batch 15 C)

## 交付

- `packages/web/src/i18n/{index.ts,zh.ts,en.ts}` 手写零依赖 i18n;`t(key)` + `setLocale(lang)` + `getLocale()` + `availableLocales()`
- Flat key dict ~120 条 (zh + en 镜像),覆盖顶栏 / 侧栏 / NewSessionModal / ChatView 输入框 / MetricsPanel / PairingView / InstallPrompt / SettingsModal / 通用按钮
- 持久化到 localStorage `rcc.locale`;首次加载按 `navigator.language.startsWith("zh")` 选 zh 否则 en
- Solid signal reactive,切换即时生效,无需刷新
- `SettingsModal` 顶部新增 "Language / 语言" 下拉(简体中文 / English)

## 替换范围

`App.tsx` (顶栏、侧栏、session row、workflow bar、status badge、main empty state、view toggle、command bar hint)、`NewSessionModal.tsx` (全部 label + 按钮)、`PairingView.tsx` (全流程)、`InstallPrompt.tsx` (iOS 提示)、`MetricsPanel.tsx` (等待数据 + title)、`ChatView.tsx` (placeholder + 发送 + 语音 aria)、`SettingsModal.tsx` (区块标题 + 按钮)。

## 未覆盖

大量低频字符串仍硬编码中文:ConfigView 各 tab (Skills/MCP/Commands/Subagents/Hooks/Permissions/Audit/Plugins/Prompts/Starters/Workflows)、MarketplaceView、DevicesModal、PeersModal、ProjectsModal、NewProjectModal、ShareModal、InboxView、CommandPalette、NotebookView、FileBrowser、RecordingPanel、ContextInjector、MobileKeyBar、WorkflowRunner 提示等。按 80/20 原则先交付演示面。

## 验证

`pnpm -r typecheck` 全绿(4/4 workspace)。不引入任何 i18n 库。
