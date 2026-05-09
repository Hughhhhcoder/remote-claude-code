# H · Mobile KeyBar

Sticky 底部快捷键条,移动端 (≤767px) 专用。

## 文件

- `packages/web/src/useIsMobile.ts` — `matchMedia("(max-width: 767px)")` + onCleanup 解绑,SSR safe。
- `packages/web/src/MobileKeyBar.tsx` — 两行:pinned commands 横滑 + Esc/Tab/↑↓/Enter/`/`/^C/⇧Tab。按钮 h-9 (36px) min-w 42px,`onPointerDown` preventDefault 避免失焦键盘,active 态橙色 pulse。`visualViewport.resize/scroll` 监听动态算 `bottomOffset`,键盘弹出时跟随抬起;`env(safe-area-inset-bottom)` 刘海屏适配。
- `packages/web/src/App.tsx` — 桌面 command bar 包 `<Show when={!isMobile()}>`;移动端 reserve 96px+safe-area spacer 防止遮终端;根容器外挂 `<MobileKeyBar />`。
- `packages/web/src/index.css` — 加 `.no-scrollbar` 工具类(hide webkit scrollbar)。
- `FEATURES.md` — 状态 🟢 + changelog。

## 约束

- 未碰 protocol / host / PWA/Permissions 文件。
- `pnpm -r typecheck` 三包全绿。
- 按钮 touch target ≥36×42px,符合 iOS HIG。
