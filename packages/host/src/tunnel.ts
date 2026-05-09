import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface TunnelStatus {
  state: "disabled" | "starting" | "ready" | "error";
  url: string | null;
  error: string | null;
  startedAt: number | null;
}

export interface TunnelEvents {
  status: (s: TunnelStatus) => void;
}

/**
 * Wraps `cloudflared tunnel --url http://localhost:<port>` (the "try
 * cloudflare" mode — no CF account needed). Captures the random
 * `*.trycloudflare.com` URL from stderr and exposes it to callers.
 *
 * For production use, swap this for a named tunnel (persists across restarts,
 * pick your own subdomain) — same API shape.
 */
export class CloudflaredTunnel extends EventEmitter {
  private child: ChildProcess | null = null;
  private status: TunnelStatus = {
    state: "disabled",
    url: null,
    error: null,
    startedAt: null,
  };
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly opts: {
      port: number;
      bin?: string;
      /** milliseconds to wait between restarts if the process exits */
      restartDelayMs?: number;
    },
  ) {
    super();
  }

  getStatus(): TunnelStatus {
    return { ...this.status };
  }

  start(): void {
    if (this.child) return;
    this.disposed = false;
    this.setStatus({
      state: "starting",
      url: null,
      error: null,
      startedAt: Date.now(),
    });

    const bin = this.opts.bin ?? "cloudflared";
    const args = [
      "tunnel",
      "--url",
      `http://localhost:${this.opts.port}`,
      "--no-autoupdate",
      "--loglevel",
      "info",
    ];

    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    this.child = child;

    const onText = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      process.stdout.write(`[cloudflared] ${text.replace(/\n$/, "")}\n`);
      // cloudflared emits URLs in the form:
      //   Your quick Tunnel has been created! Visit it at: https://xyz-abc.trycloudflare.com
      // or inside a boxed status banner. Match the URL directly.
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && (this.status.state !== "ready" || this.status.url !== match[0])) {
        this.setStatus({
          state: "ready",
          url: match[0],
          error: null,
          startedAt: this.status.startedAt ?? Date.now(),
        });
      }
    };

    child.stdout?.on("data", onText);
    child.stderr?.on("data", onText);

    child.on("error", (err) => {
      this.setStatus({
        state: "error",
        url: null,
        error: String(err.message ?? err),
        startedAt: this.status.startedAt,
      });
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.disposed) return;
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      this.setStatus({
        state: "error",
        url: this.status.url, // keep last-known url until restart succeeds
        error: `cloudflared exited (${reason})`,
        startedAt: this.status.startedAt,
      });
      const delay = this.opts.restartDelayMs ?? 3000;
      this.restartTimer = setTimeout(() => {
        if (!this.disposed) this.start();
      }, delay);
    });
  }

  stop(): void {
    this.disposed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.setStatus({ state: "disabled", url: null, error: null, startedAt: null });
  }

  private setStatus(s: TunnelStatus): void {
    this.status = s;
    this.emit("status", s);
  }
}
