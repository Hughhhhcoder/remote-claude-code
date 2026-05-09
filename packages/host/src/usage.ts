import type { SessionUsage } from "@rcc/protocol";

/**
 * Per-session token + cost accumulator. Only SDK-driver sessions record;
 * CLI-driver sessions have no structured usage hook and stay absent from
 * `all()` entirely so clients can conditionally render.
 *
 * The tracker is a process singleton — host/index.ts imports `usage` and
 * wires a broadcast callback via {@link UsageTracker.setBroadcast}. Persistence
 * is handled by the snapshot writer (packages/host/src/persistence.ts), not
 * here; {@link hydrate} simply restores the in-memory Map on boot.
 */
export class UsageTracker {
  private readonly map = new Map<string, SessionUsage>();
  private broadcast: ((sid: string, usage: SessionUsage) => void) | null = null;

  setBroadcast(fn: (sid: string, usage: SessionUsage) => void): void {
    this.broadcast = fn;
  }

  get(sid: string): SessionUsage | undefined {
    return this.map.get(sid);
  }

  all(): ReadonlyMap<string, SessionUsage> {
    return this.map;
  }

  hydrate(sid: string, usage: SessionUsage): void {
    this.map.set(sid, usage);
  }

  reset(sid: string): void {
    this.map.delete(sid);
  }

  /**
   * Fold one SDKResultMessage's usage + cost into the session's running total
   * and emit an update. Caller must pass already-cleaned integers; absent
   * fields are treated as 0 so partial SDK payloads don't NaN-out the sum.
   */
  record(
    sid: string,
    delta: {
      inputTokens?: number;
      outputTokens?: number;
      cacheCreate?: number;
      cacheRead?: number;
      costUsd?: number;
    },
  ): SessionUsage {
    const prev = this.map.get(sid) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      turns: 0,
    };
    const next: SessionUsage = {
      inputTokens: prev.inputTokens + safeInt(delta.inputTokens),
      outputTokens: prev.outputTokens + safeInt(delta.outputTokens),
      cacheCreateTokens: prev.cacheCreateTokens + safeInt(delta.cacheCreate),
      cacheReadTokens: prev.cacheReadTokens + safeInt(delta.cacheRead),
      costUsd: round4(prev.costUsd + safeNum(delta.costUsd)),
      turns: prev.turns + 1,
    };
    this.map.set(sid, next);
    this.broadcast?.(sid, next);
    return next;
  }
}

function safeInt(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function safeNum(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export const usage = new UsageTracker();
