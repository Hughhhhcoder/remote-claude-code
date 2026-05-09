# F · 文件树 + Monaco 预览

**Date**: 2026-05-09 · Batch 2

## Delivered
- **Protocol** (`packages/protocol/src/index.ts`): 新增 `[files]` 区块 — `FileEntry` schema + `fs.ls(.request)` / `fs.read(.request)` / `fs.stat(.request)` 六个帧，append 到 discriminatedUnion 末尾。
- **Host** (`packages/host/src/fs.ts` 新建): `ls/read/statEntry`。路径策略：`~` 展开 + `path.resolve` + 只允许 `<RCC_CWD>` 和 `~` 子树，用 `fs.realpath` 二次比对防 symlink 越狱。`ls` 并行 stat + dir/file 分组字母序 + 过滤 `.DS_Store`。`read` 最大 512KB（截断标记 `truncated: true`），前 8KB 嗅探 NUL → base64 + `encoding: "base64"`，否则 utf8。Wired to index.ts `[config-handlers]` 附近三个 case，错误走统一 `fs_*_failed` error 码。
- **Web** (`FileBrowser.tsx` 新建 + `App.tsx` 修改): Monaco 只读预览（懒 import + dummy worker 规避 worker 请求），12 种语言扩展名映射。右栏 toggle（侧栏底部 📁 按钮），grid 从 `240px 1fr` 切到 `240px 1fr 360px`。首条 hello/session.list 自动 seed rootCwd 到活跃 session cwd，默认 `~`。树形懒加载（点击目录才请求 fs.ls），文件点击触发 Monaco load。底部状态行显示 size + 截断警告；二进制显示 "二进制文件 (N bytes) — 无预览"。
- **monaco-editor**: `pnpm -F @rcc/web add monaco-editor@0.55.1` 已装。

## Typecheck
- `@rcc/web` ✅
- `@rcc/protocol` ✅
- `@rcc/host` ✅（我的新增）— 报出的 2 个 `never` 错误在 Agent B 的 `hooks.ts`，与本任务无关。

## Files
- 新：`packages/host/src/fs.ts`、`packages/web/src/FileBrowser.tsx`、`.agent-reports/F-files.md`
- 改：`packages/protocol/src/index.ts`、`packages/host/src/index.ts`、`packages/web/src/App.tsx`、`packages/web/package.json`、`FEATURES.md`
