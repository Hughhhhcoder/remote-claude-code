# Batch 7 / Agent A · Claude Agent SDK driver

Added in M6. **SDK version:** `@anthropic-ai/claude-agent-sdk@0.2.138`.

## 新增

- Protocol: `SessionDriver` enum, `SessionMeta.driver` + `session.new.driver`, 两种新的
  `ChatSegment` (`thinking` / `tool_result`), `ChatMessage.streaming`, 新帧
  `chat.update { messageId, segmentIndex, segment }`。所有字段对旧 host/client
  可选,老会话默认按 CLI 解析。
- Host: `packages/host/src/sdk-session.ts` 新建 `SdkSession`,与 `Session` 并列。
  - `query({ prompt: AsyncIterable<SDKUserMessage>, options })` 流式消费
    `SDKMessage`。`includePartialMessages: true` 开启 `stream_event`。
  - API key: `ANTHROPIC_API_KEY` env 或 `~/.rcc/config.json anthropic.apiKey`
    (两者都没有时 start() reject 并通过 system 消息广播错误)。
  - `write(data)` 按 `\r`/`\n` 切成 user prompts 推入 iterator queue。
  - `session.ts` 抽出 `AnySession` union + `createSession(opts)` 工厂,
    `SessionRegistry` 存 AnySession; `approvals.ts` 仍只绑 CLI(`instanceof Session`)。
- Web: `NewSessionModal` 加 CLI/SDK 选择, App 会话 header / 列表加 `DriverChip`,
  SDK 会话强制 chat view 且隐藏终端切换。ChatView 消费 `chat.update` 做增量更新,
  新增 `ThinkingBlock` (灰色可折叠) 和 `ToolResultBlock` (绿/红按 isError)。

## 事件映射

| SDK event | ChatSegment |
|---|---|
| `SDKPartialAssistantMessage` + content_block_start `text` / `thinking` / `tool_use` | 对应 segment 插入 |
| `BetaTextDelta` / `BetaThinkingDelta` (stream_event.delta) | 更新 buf,广播 `chat.update` |
| `SDKAssistantMessage` (最终态) | 重写 segments,`streaming:false` |
| `SDKUserMessage.isSynthetic` + `tool_result` block | 按 `toolUseId` 映射到对应 tool_use 消息的新 segment |
| `SDKResultMessage.subtype === "error"` | system 消息 |

## 已知限制

- Tool `input_json_delta` 不做增量流,靠最终 assistant 消息重写。
- SDK 会话没 pty,`pty.out` replay 总是空,依赖 `chat.list.request` 回填。
- 审批 UI 仍只对 CLI 生效(SDK 权限走 SDK 自己的 canUseTool,未接入 RCC approval)。
- 多轮历史由 SDK 内部 session persist 管;重连恢复到多轮状态需要 query 选项的
  `resume`,本批未接。
