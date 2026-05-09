# Agent AY · WS 背压 + per-connection 限流

## 实现

- `packages/host/src/backpressure.ts` 新文件:`RateLimiter` token bucket 类(lazy refill by elapsed ms)、`createWsLimiters()` 工厂、常量 `BACKPRESSURE_DROP=1MB`/`CLOSE=10MB`、`INBOUND_FRAMES=100/s`、`OUTBOUND_BYTES=10MB/s`、`isCriticalFrame()` 白名单(hello/error/approval.request/approval.cleared/update.ready)。
- `packages/host/src/index.ts` 统一出站走 `sendToClient`:先查 `ws.bufferedAmount` 两档阈值(>10MB→close 1013、>1MB→drop 非关键帧并一次性推 `error{code:"backpressure"}`,`bpNotified` 状态位 resume 后复位),再过出站 byte token bucket 非关键帧失败即 drop;关键帧仍放行但也消耗 token 让账目可信。`send`/`broadcast`/`broadcastApproval`/`broadcastDeviceList`/CRDT 转发/`metricsTickTimer` 全部收敛。`ws.on("message")` 首行 `inboundFrames.tryConsume(1)` 失败 close(1008)。WsState 加 `limiters`+`bpNotified`。
- `packages/host/src/metrics.ts` + `packages/protocol/src/index.ts` 扩 4 counters(`wsDropsBackpressure`/`wsDropsRateLimit`/`wsClosesBackpressure`/`wsClosesRateLimit`)。
- `packages/web/src/MetricsPanel.tsx` 新增 4 行 Counter >0 变红。
- `packages/web/src/client.ts`:`ConnStatus` 加 `"slow"`,收到 `error{code:"backpressure"}` → console.warn + 降级 slow;close 1013/1008 路径 `reconnectAttempts=0` 快速重连不走 probeAuth。
- `packages/web/src/App.tsx` `StatusBadge` 加 `slow` 琥珀色徽章。
- `tests/e2e/specs/backpressure.spec.ts`:连发 500 帧 期待 close.code===1008。

## 验证

`pnpm -r typecheck` 全绿。