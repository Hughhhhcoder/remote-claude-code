# J · 语义化对话视图

**状态**: 🟢 done · 2026-05-09

## 落地

- `packages/host/src/chat-parser.ts` ChatParser: ANSI 三类正则剥离 (CSI/OSC/simple)，pending 512KB 硬顶，在最后一个 `\n\n` 处 flush；classify → text / code (```围栏) / diff (>40% +/- 行) / tool_use (● ⏺ 前缀 或 ╭│╰ 面板)；每会话 100 条滚动窗口。
- `packages/host/src/session.ts` Session 挂 `chat: ChatParser`，pty.onData 同时喂 listeners、buffer、chat。
- `packages/host/src/index.ts` 新增 `attachChatBroadcast(session)` + `chat.list.request` / `chat.reset` handler。
- Protocol `[messages]` 帧已就绪（前 agent 已落），未改动。
- `packages/web/src/ChatView.tsx` 气泡视图 + 本地 echo user message + Cmd/Ctrl+Enter 发送。
- `App.tsx` session header 💬/▶ toggle，移动端默认 chat。

## 启发式局限

- pty 流是渲染后字节流；快速连续输出会被合并成一条 message。
- Cursor-relative 重绘片段会被 ANSI 剥离后残留为乱码。
- tool_use 依赖 CLI glyph（●/⏺）稳定性，Claude CLI 升级可能漂移。
- user 消息只在前端本地回显（host ChatParser.feedInput 保留但未调用）。
- 结构化事件流需接入 Claude Agent SDK，留给 M5。
