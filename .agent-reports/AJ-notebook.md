# AJ · 协作笔记本 (Notebook)

Lazy per-sid notebook at `~/.rcc/notebooks/<sid>.json` (0600, atomic, ≤1MB).

**Protocol**: `NotebookCell` (note|chatRef) + `Notebook` + 7 帧 (`notebook.request/notebook/upsert/upserted/append/delete/deleted`), wired into Frame union.

**Host** (`notebooks.ts`): `NotebookStore` with in-memory cache + miss cache; `get/upsert/append/remove`; index.ts gains 4 handlers; `append` broadcasts `notebook` 到多端。

**Web** (`NotebookView.tsx`): right aside (grid 支持 4 列 files+notebook 共存); cells 竖排渲染 — note 走 textarea + preview toggle(不引 markdown 库),chatRef 查 chat.list 由 messageId 只读渲染 segments。顶栏 ➕/⬇.md/⬇.json/🗑 导出 Blob 下载。ChatView `onPinToNotebook` + MessageRow hover 📎 按钮 → App 发 `notebook.append chatRef` 并自动打开面板。

CommandPalette 加 notebook 切换 action;session header 📓 toggle。`pnpm -r typecheck` 全绿。
