# G-pwa — PWA 外壳

**状态**: 🟢 done · 2026-05-09 · M3 batch 1

## 交付

- `packages/web/public/manifest.webmanifest` — name/short_name/display=standalone/theme=#09090b/三种图标
- `packages/web/public/icon-{192,512,maskable-512}.png` — 纯 Node 生成（`scripts/gen-icons.mjs`，zlib+手写 PNG 编码器+手画 "R" 字形，无 sharp 依赖）
- `packages/web/public/sw.js` — 手写 service worker，cache 名 `rcc-v1`
- `packages/web/src/InstallPrompt.tsx` — Solid 组件，顶栏 📲 按钮
- `packages/web/index.html` — 加 link rel=manifest / apple-touch-icon / theme-color / SW 注册脚本
- `packages/web/src/App.tsx` — 顶栏 `<InstallPrompt />`（TunnelBadge 之后）

## SW 策略

- static cache-first：`/assets/*` + png/css/js/woff2 + manifest
- HTML navigation network-first，离线回退缓存的 `/` shell，再次回退内置 offline HTML
- **硬 bypass**：`/ws`、`/pair[/...]`、`/health`、`/tunnel`、所有 websocket upgrade、跨 origin 请求
- activate 时清除非当前版本 cache，`skipWaiting` + `clients.claim`

## InstallPrompt

- 捕获 `beforeinstallprompt` 存 signal，按钮点击调用 `prompt()`
- iOS Safari 检测（UA + iPadOS maxTouchPoints），展开手动 Share→Add to Home Screen 指南
- `appinstalled` 事件和 `display-mode: standalone` 匹配时自动隐藏
- 用户关闭 iOS 提示后写 localStorage，不再打扰

## 验证

- `pnpm -r typecheck` 全绿
- `pnpm -F @rcc/web build` 成功，`dist/` 含 sw.js + manifest.webmanifest + 3 个 PNG（file 验证均为合法 8-bit RGBA）
- host 已有通用静态托管器（MIME 表含 png/json，webmanifest 走 octet-stream 回退，浏览器照常识别）

## 约束遵守

- 未改 `packages/host/` 任何文件
- 未改其他 agent 的 MobileKeyBar / PermissionApproval
- 未改 protocol 帧
