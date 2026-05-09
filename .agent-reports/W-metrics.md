# W-metrics

Observability panel — B/8.

**Host** (`packages/host/src/metrics.ts`): singleton `MetricsCollector` with a
60-sample rolling window (1s resolution) of Series (counters) and Gauges
(RSS/CPU%). `sample()` rotates every second and computes CPU% via
`process.cpuUsage()` differentials. Small API: `metrics.incr(name, n)` +
`bindRegistry` + `bindWsStats`. `dispose()` clears the timer for tests.

Hook points wired (minimally intrusive): `send()` / `broadcast()` count ws
bytes/msgs out, ws `onmessage` counts in, `pty.in` handler + per-session
`subscribe()` tap count pty bytes, `chat.onMessage` bumps chat msgs,
`authenticate()` bumps `auth.fails`, replay/skew/decrypt failure branches
in the E2E envelope handler bump their counters, and the crash broadcast
lambda bumps `crashes`.

**Route** `GET /metrics` (authenticated) returns `metrics.snapshot()`.

**Protocol**: `metrics.subscribe` / `metrics.unsubscribe` / `metrics.tick` +
`MetricsSnapshot` schema. A 2s `setInterval` broadcasts ticks only when ≥1
ws is subscribed; per-ws state is tracked via a `WeakMap<WebSocket, WsState>`.

**Web** (`MetricsPanel.tsx`): 📊 top-bar button → popover. Sends subscribe on
open, unsubscribe on close / cleanup. Inline SVG sparklines for RSS/CPU/ws
in/out, colored bars for sessions-by-status, counters go red when >0.

Typecheck: `@rcc/protocol` + `@rcc/web` green. `@rcc/host` has two pre-
existing errors from other in-flight agents (`DeadSession.start`,
`createSessionDirect`) unrelated to metrics.
