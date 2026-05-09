# AW · Leak audit + watchdog + soak

## Fixes applied

1. **ws attach() onExit leak** — `packages/host/src/index.ts::attach()` added a fresh `session.onExit` on every reattach but never removed it. The closure captured `ws`, so a session outliving many client reconnects accumulated dead listeners. Now tracked in `WsState.exitUnsubs` and disposed on `ws.on("close")`.
2. **session.close per-sid maps** — `chatBySid`, `sessionSummaries`, `usage`, `searchIndex` all grew unbounded across session create/close cycles. `case "session.close"` now deletes each entry (`searchIndex.remove`, `usage.reset`, plus Map .delete).
3. **SdkSession.kill cleanup** — `toolIndex`, `activeDeltas`, `pendingInputs`, `inputBuffer` kept references to large strings (tool_use JSON, streaming text buffers) for the lifetime of the object. kill() now clears them all so a closed session releases its tool/chat payloads immediately rather than waiting on the DeadSession archive.

Other files reviewed and cleared: `approvals.ts` (dispose clears pending timeout), `git-watcher.ts` (disposed, unref'd), `federation.ts` (reconnectTimer cleared on dispose), `metrics.ts` (timer unref'd, dispose clears), `trust.ts` / `shares.ts` (watchFile unsubscribed via stopWatching; PairingCodes GC'd), `crash.ts` (once-per-process handler; not a leak), `updater.ts` (AbortController nulled in finally, setTimeout unref'd), `chat-parser.ts` (bounded buffers), `activity.ts` (200-item rolling window), `persistence.ts` (Debouncer cancels).

## Watchdog

`packages/host/src/watchdog.ts`: 60s tick (unref'd interval). Emits `health.warn { kind, details }` on:
- `memory` — `process.memoryUsage().rss > RCC_WATCHDOG_MEM_MB * 1MiB` (default 1024)
- `handles` — `process.getActiveResourcesInfo().length > 100`
- `sessions` — count > 50 OR minute-over-minute growth > 20

Per-kind cooldown 5 min to avoid flooding. Wired in `index.ts` post-crash-handler, disposed on SIGINT.

Protocol: new `HealthWarn` frame shipped in `@rcc/protocol`, added to `Frame` union.

## Soak script

`scripts/soak.mjs` (no external deps, uses global WebSocket / fetch):
- spawns host on `RCC_PORT=7899` with `RCC_CLAUDE_CMD=cat` (cheap pty)
- opens 5 ws clients, each creates a session, sends "." every second, every 30s rotates (close + recreate)
- samples `/metrics` every 10s → `soak-logs/soak-<ts>.csv` (rss, heap, cpu, sessions)
- final ASCII sparkline + stability check (steady-state swing > 50MB fails exit code 2)

Usage: `node scripts/soak.mjs --duration=7200` (2h default), `--sessions=5 --port=7899`. Not in CI — ops-only.

## 5-minute soak result

```
[soak] t=20s  rss=68.1MB sessions=9
[soak] t=50s  rss=60.9MB
[soak] t=80s  rss=58.3MB
[soak] t=111s rss=86.7MB
[soak] t=141s rss=60.0MB
[soak] t=171s rss=56.2MB
[soak] t=201s rss=58.0MB
[soak] t=231s rss=75.6MB
[soak] t=261s rss=53.2MB
[soak] t=292s rss=57.8MB
[soak] rss MB min=53 max=185 first=185 last=58 drift=-127
[soak] steady-state RSS within 50MB band (53-87MB) — stable
```

Startup peak 185MB, GC'd to 53MB, oscillates 53-87MB over 5 min. No monotonic growth. `pnpm -r typecheck` all green.
