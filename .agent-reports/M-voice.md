# M-voice · 语音输入

Web Speech API 优先,MediaRecorder 回退。

## 文件
- 新:`packages/web/src/voice.ts` — `startDictation` 双路径,Speech 实时 partial,否则录 webm/opus 传 /whisper。
- 新:`packages/host/src/whisper.ts` — 手搓 multipart 解析(只取 `audio` field),Node `FormData`+`Blob` 代理 OpenAI,读 `~/.rcc/config.json` whisper 段;未配 apiKey → 501,>10MB → 413。
- 改:`packages/web/src/ChatView.tsx` — 🎙 按钮,录音态红色脉冲,partial 追加到 draft 同步 Y.Text;onError 下方提示。
- 改:`packages/host/src/index.ts` — 挂 `POST /whisper`,复用 `authenticate()`。
- `FEATURES.md` 行与变更日志已更新。

`pnpm -r typecheck` 全绿。不触 protocol/MobileKeyBar/push/tunnel/session。
