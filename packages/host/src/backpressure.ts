import type { Frame } from "@rcc/protocol";

export const BACKPRESSURE_DROP_THRESHOLD = 1 * 1024 * 1024;
export const BACKPRESSURE_CLOSE_THRESHOLD = 10 * 1024 * 1024;

export const WS_CLOSE_BACKPRESSURE = 1013;
export const WS_CLOSE_RATE_LIMIT = 1008;

export const INBOUND_FRAMES_PER_SEC = 100;
export const OUTBOUND_BYTES_PER_SEC = 10 * 1024 * 1024;

export function isCriticalFrame(t: Frame["t"]): boolean {
  switch (t) {
    case "hello":
    case "error":
    case "approval.request":
    case "approval.cleared":
    case "update.ready":
      return true;
    default:
      return false;
  }
}

export class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec = capacity,
  ) {
    this.tokens = capacity;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const add = (elapsed / 1000) * this.refillPerSec;
    if (add > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + add);
      this.lastRefill = now;
    }
  }

  tryConsume(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}

export interface WsLimiters {
  inboundFrames: RateLimiter;
  outboundBytes: RateLimiter;
}

export function createWsLimiters(): WsLimiters {
  return {
    inboundFrames: new RateLimiter(INBOUND_FRAMES_PER_SEC, INBOUND_FRAMES_PER_SEC),
    outboundBytes: new RateLimiter(OUTBOUND_BYTES_PER_SEC, OUTBOUND_BYTES_PER_SEC),
  };
}
