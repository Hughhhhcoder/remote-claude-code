# AX · Web bundle 瘦身

## Before

| Chunk | Size | Gzip |
|---|---|---|
| index.js | 1,256.98 kB | 370.06 kB |
| editor.main.js (Monaco, eager) | 3,806.25 kB | 982.98 kB |
| xterm (inline) | — (in index) | — |
| sodium / yjs / webauthn | (in index) | — |

总 initial JS (gzip): ~370 kB · Monaco 随 FileBrowser 静态依赖被牵连到主 chunk。

## After

| Chunk | Size | Gzip |
|---|---|---|
| index.js (initial) | 429.41 kB | **114.55 kB** (-69%) |
| monaco (lazy) | 4,291.64 kB | 1,101.46 kB |
| sodium | 433.73 kB | 151.75 kB |
| xterm | 294.20 kB | 73.29 kB |
| yjs | 77.56 kB | 23.46 kB |
| webauthn | 8.76 kB | 2.90 kB |
| FileBrowser (async) | 8.65 kB | 3.55 kB |
| RecordingPlayback (async) | 5.46 kB | 2.67 kB |

## 改动

1. `vite.config.ts`：`build.sourcemap=false`；`rollupOptions.output.manualChunks` 拆 monaco/xterm/yjs/sodium/webauthn 五组 vendor chunk。
2. `App.tsx`：`FileBrowser` 改 `lazy()` → 首屏不再拉 Monaco。
3. `RecordingPanel.tsx`：`RecordingPlayback` 改 `lazy()` → xterm 二次播放复用 xterm chunk。
4. TerminalView 主路径仍静态导入 xterm（用户常用）。

## 效果

Initial gzip 从 ~370 kB → **114.55 kB (-69%)**。Monaco 完全挪到 on-demand chunk，FileBrowser 打开时才拉 1.1 MB gzip 的 monaco 包。e2e 16/16 绿。
