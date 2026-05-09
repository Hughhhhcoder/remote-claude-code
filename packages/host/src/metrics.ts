import type { SessionRegistry } from "./session.ts";

/**
 * Lightweight, in-process metrics. No external deps. Keeps a 60-sample rolling
 * window (1 sample/sec) of rate counters + gauges and exposes a single
 * {@link snapshot} JSON for HTTP and ws push. A host can opt a single ws
 * connection in/out of the push stream via metrics.subscribe / .unsubscribe;
 * HTTP /metrics returns the same snapshot on demand.
 *
 * Rate series are rotated once per second by {@link sample}; gauges are
 * re-sampled each tick from live process/registry state.
 */

const WINDOW = 60;

export interface MetricsSnapshot {
  at: number;
  uptimeSec: number;
  process: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    cpuPct: number;
  };
  /** process.rss over the rolling window (60 entries, oldest → newest). */
  rssSeries: number[];
  cpuSeries: number[];
  sessions: {
    total: number;
    running: number;
    exited: number;
    byDriver: { cli: number; sdk: number };
  };
  ws: {
    connections: number;
    subscribers: number;
    bytesInPerSec: number;
    bytesOutPerSec: number;
    msgsInPerSec: number;
    msgsOutPerSec: number;
    bytesInSeries: number[];
    bytesOutSeries: number[];
  };
  pty: {
    bytesInPerSec: number;
    bytesOutPerSec: number;
  };
  chat: {
    msgsPerSec: number;
  };
  counters: {
    crashes: number;
    replayRejects: number;
    decryptFails: number;
    authFails: number;
  };
}

type CounterName =
  | "ws.bytes.in"
  | "ws.bytes.out"
  | "ws.msgs.in"
  | "ws.msgs.out"
  | "pty.bytes.in"
  | "pty.bytes.out"
  | "chat.msgs"
  | "crashes"
  | "replay.rejects"
  | "decrypt.fails"
  | "auth.fails";

class Series {
  private readonly buf: number[] = new Array(WINDOW).fill(0);
  private head = WINDOW - 1;
  /** Accumulator for the current (still-open) second. */
  private live = 0;

  add(n: number): void {
    this.live += n;
  }

  /** Close the current second and advance. Returns the just-closed value. */
  rotate(): number {
    const closed = this.live;
    this.live = 0;
    this.head = (this.head + 1) % WINDOW;
    this.buf[this.head] = closed;
    return closed;
  }

  /** Snapshot oldest → newest. */
  series(): number[] {
    const out = new Array<number>(WINDOW);
    for (let i = 0; i < WINDOW; i++) {
      out[i] = this.buf[(this.head + 1 + i) % WINDOW]!;
    }
    return out;
  }

  /** Latest closed-second value (not the live accumulator). */
  latest(): number {
    return this.buf[this.head]!;
  }
}

class Gauge {
  private readonly buf: number[] = new Array(WINDOW).fill(0);
  private head = WINDOW - 1;

  set(v: number): void {
    this.buf[this.head] = v;
  }

  rotate(v: number): void {
    this.head = (this.head + 1) % WINDOW;
    this.buf[this.head] = v;
  }

  series(): number[] {
    const out = new Array<number>(WINDOW);
    for (let i = 0; i < WINDOW; i++) {
      out[i] = this.buf[(this.head + 1 + i) % WINDOW]!;
    }
    return out;
  }

  latest(): number {
    return this.buf[this.head]!;
  }
}

export class MetricsCollector {
  private readonly series = new Map<CounterName, Series>();
  private readonly counters = new Map<string, number>();
  private readonly rssGauge = new Gauge();
  private readonly cpuGauge = new Gauge();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = Date.now();
  private readonly startedAt = Date.now();
  private registry: SessionRegistry | null = null;
  private wsStats: () => { connections: number; subscribers: number } = () => ({
    connections: 0,
    subscribers: 0,
  });

  constructor() {
    const names: CounterName[] = [
      "ws.bytes.in",
      "ws.bytes.out",
      "ws.msgs.in",
      "ws.msgs.out",
      "pty.bytes.in",
      "pty.bytes.out",
      "chat.msgs",
    ];
    for (const n of names) this.series.set(n, new Series());
    const ctrs = ["crashes", "replay.rejects", "decrypt.fails", "auth.fails"];
    for (const n of ctrs) this.counters.set(n, 0);
  }

  bindRegistry(r: SessionRegistry): void {
    this.registry = r;
  }

  bindWsStats(fn: () => { connections: number; subscribers: number }): void {
    this.wsStats = fn;
  }

  incr(name: CounterName | "crashes" | "replay.rejects" | "decrypt.fails" | "auth.fails", n = 1): void {
    const s = this.series.get(name as CounterName);
    if (s) {
      s.add(n);
      return;
    }
    this.counters.set(name, (this.counters.get(name) ?? 0) + n);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), 1000);
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private sample(): void {
    for (const s of this.series.values()) s.rotate();
    const mem = process.memoryUsage();
    this.rssGauge.rotate(mem.rss);
    const now = Date.now();
    const cpu = process.cpuUsage();
    const dtMs = Math.max(1, now - this.lastCpuAt);
    const userUs = cpu.user - this.lastCpu.user;
    const sysUs = cpu.system - this.lastCpu.system;
    const pct = ((userUs + sysUs) / 1000 / dtMs) * 100;
    this.cpuGauge.rotate(Math.max(0, Math.min(100, pct)));
    this.lastCpu = cpu;
    this.lastCpuAt = now;
  }

  snapshot(): MetricsSnapshot {
    const mem = process.memoryUsage();
    const at = Date.now();
    const sessionStats = this.sessionStats();
    const ws = this.wsStats();
    return {
      at,
      uptimeSec: Math.round((at - this.startedAt) / 1000),
      process: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        cpuPct: Math.round(this.cpuGauge.latest() * 10) / 10,
      },
      rssSeries: this.rssGauge.series(),
      cpuSeries: this.cpuGauge.series().map((v) => Math.round(v * 10) / 10),
      sessions: sessionStats,
      ws: {
        connections: ws.connections,
        subscribers: ws.subscribers,
        bytesInPerSec: this.series.get("ws.bytes.in")!.latest(),
        bytesOutPerSec: this.series.get("ws.bytes.out")!.latest(),
        msgsInPerSec: this.series.get("ws.msgs.in")!.latest(),
        msgsOutPerSec: this.series.get("ws.msgs.out")!.latest(),
        bytesInSeries: this.series.get("ws.bytes.in")!.series(),
        bytesOutSeries: this.series.get("ws.bytes.out")!.series(),
      },
      pty: {
        bytesInPerSec: this.series.get("pty.bytes.in")!.latest(),
        bytesOutPerSec: this.series.get("pty.bytes.out")!.latest(),
      },
      chat: {
        msgsPerSec: this.series.get("chat.msgs")!.latest(),
      },
      counters: {
        crashes: this.counters.get("crashes") ?? 0,
        replayRejects: this.counters.get("replay.rejects") ?? 0,
        decryptFails: this.counters.get("decrypt.fails") ?? 0,
        authFails: this.counters.get("auth.fails") ?? 0,
      },
    };
  }

  private sessionStats(): MetricsSnapshot["sessions"] {
    if (!this.registry) {
      return { total: 0, running: 0, exited: 0, byDriver: { cli: 0, sdk: 0 } };
    }
    let running = 0;
    let exited = 0;
    let cli = 0;
    let sdk = 0;
    const all = this.registry.list();
    for (const s of all) {
      if (s.status === "running") running++;
      else exited++;
      if (s.driver === "sdk") sdk++;
      else cli++;
    }
    return { total: all.length, running, exited, byDriver: { cli, sdk } };
  }
}

export const metrics = new MetricsCollector();
