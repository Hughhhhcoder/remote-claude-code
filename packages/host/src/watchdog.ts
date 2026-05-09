import type { Frame } from "@rcc/protocol";

/**
 * Process watchdog. Every 60s samples a few health signals and broadcasts a
 * `health.warn` frame (kind: memory | handles | sessions) when any of them
 * crosses its threshold. Purely observational — we never kill or restart.
 *
 * Thresholds:
 *   - memory:  process.memoryUsage().rss > RCC_WATCHDOG_MEM_MB (default 1024)
 *   - handles: process.getActiveResourcesInfo().length > 100
 *   - sessions: current session count > 50, or grew by > 20 over the last
 *     minute (caller supplies a snapshot function so we don't bake in a
 *     dependency on SessionRegistry).
 *
 * Each kind warns at most once per "cooldown" window (5 min) to avoid
 * spamming clients — the underlying condition persists, but one tick is
 * enough to surface it.
 */

const TICK_MS = 60_000;
const COOLDOWN_MS = 5 * 60_000;
const DEFAULT_MEM_MB = 1024;
const HANDLE_LIMIT = 100;
const SESSION_LIMIT = 50;
const SESSION_GROWTH_LIMIT = 20;

export type WatchdogBroadcast = (frame: Frame) => void;

export interface WatchdogDeps {
  sessionCount: () => number;
  broadcast: WatchdogBroadcast;
}

export class Watchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly memLimitBytes: number;
  private readonly history: { at: number; sessions: number }[] = [];
  private readonly lastWarn = new Map<string, number>();

  constructor(private readonly deps: WatchdogDeps) {
    const envMb = Number(process.env.RCC_WATCHDOG_MEM_MB);
    const mb = Number.isFinite(envMb) && envMb > 0 ? envMb : DEFAULT_MEM_MB;
    this.memLimitBytes = mb * 1024 * 1024;
  }

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.history.length = 0;
    this.lastWarn.clear();
  }

  /** Exposed for tests / manual probes. */
  tick(): void {
    const now = Date.now();
    const rss = process.memoryUsage().rss;
    if (rss > this.memLimitBytes) {
      this.maybeWarn(now, "memory", { rss, limit: this.memLimitBytes });
    }

    const handles = getActiveHandleCount();
    if (handles !== null && handles > HANDLE_LIMIT) {
      this.maybeWarn(now, "handles", { handles, limit: HANDLE_LIMIT });
    }

    const sessions = this.deps.sessionCount();
    this.history.push({ at: now, sessions });
    const cutoff = now - 60_000;
    while (this.history.length > 0 && this.history[0]!.at < cutoff) this.history.shift();
    const oldest = this.history[0];
    const growth = oldest ? sessions - oldest.sessions : 0;
    if (sessions > SESSION_LIMIT || growth > SESSION_GROWTH_LIMIT) {
      this.maybeWarn(now, "sessions", {
        sessions,
        growthLastMinute: growth,
        limit: SESSION_LIMIT,
      });
    }
  }

  private maybeWarn(now: number, kind: string, details: Record<string, unknown>): void {
    const last = this.lastWarn.get(kind) ?? 0;
    if (now - last < COOLDOWN_MS) return;
    this.lastWarn.set(kind, now);
    console.warn(`[rcc-host] watchdog warn kind=${kind}`, details);
    try {
      this.deps.broadcast({ v: 1, t: "health.warn", at: now, kind, details });
    } catch {
      // ignore — broadcaster failures shouldn't unwind the tick
    }
  }
}

function getActiveHandleCount(): number | null {
  const fn = (process as unknown as { getActiveResourcesInfo?: () => string[] })
    .getActiveResourcesInfo;
  if (typeof fn !== "function") return null;
  try {
    return fn.call(process).length;
  } catch {
    return null;
  }
}
