# Agent C — 主题 + 键位自定义

## 交付

- `packages/protocol/src/index.ts`: `[ui-prefs]` 块, `UiPrefs` + `prefs / prefs.request / prefs.update / prefs.updated` 四帧, 加入 Frame union
- `packages/host/src/prefs.ts`: `PrefsStore` 读写 `~/.rcc/ui-prefs.json`(0600, zod 校验, 默认值)
- `packages/host/src/index.ts`: hello 后推送一次 prefs; 处理 `prefs.request` / `prefs.update` 并广播
- `packages/web/src/prefs.ts`: `createPrefsStore(client)` + `applyPrefs()`(设 `--accent-{300,400,500,600}` CSS 变量、html font-size、data-theme) + `decodeSendEscapes`/`encodeSendEscapes` + `DEFAULT_CUSTOM_KEYS`
- `packages/web/src/SettingsModal.tsx`: 🎨 面板(色板/字体滑杆/键位表 CRUD/重置)
- `packages/web/tailwind.config.js`: `accent` 色系读 `rgb(var(--accent-N) / <alpha-value>)`
- `packages/web/src/index.css`: `:root` 默认 orange 变量
- `packages/web/src/App.tsx`: prefs store + 顶栏 🎨 + New session/pinned project/文件浏览器按钮切 accent-*;KeyButton 列表从 `customKeys()` 渲染
- `packages/web/src/MobileKeyBar.tsx`: 新增 `customKeys` prop 驱动按键条, active 态切 accent
- `FEATURES.md`: 新行 + 变更日志

## 验证

- `pnpm -F @rcc/protocol typecheck` / `@rcc/web typecheck` 全绿
- `pnpm -F @rcc/web build` 成功(1.1MB index, accent 类出现)
- host typecheck 的 SdkSession `start()` 报错为另一 agent 留下的预先存在问题(非本 batch)
- 保留 R logo / PairingView / ChatView send 按钮的品牌 orange-rose 渐变, 只换高频主色
