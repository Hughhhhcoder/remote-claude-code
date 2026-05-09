import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TunnelConfig } from "./config.ts";

export interface TunnelStatus {
  state: "disabled" | "starting" | "ready" | "error";
  url: string | null;
  error: string | null;
  startedAt: number | null;
  mode?: "try" | "named";
  hostname?: string | null;
  name?: string | null;
}

export interface TunnelEvents {
  status: (s: TunnelStatus) => void;
}

interface BaseOpts {
  bin?: string;
  restartDelayMs?: number;
}

interface TryOpts extends BaseOpts {
  port: number;
}

interface NamedOpts extends BaseOpts {
  port: number;
  name: string;
  hostname: string;
  credentialsFile: string;
}

abstract class BaseTunnel extends EventEmitter {
  protected child: ChildProcess | null = null;
  protected status: TunnelStatus;
  protected restartTimer: ReturnType<typeof setTimeout> | null = null;
  protected disposed = false;

  constructor(
    protected readonly baseOpts: BaseOpts,
    initial: TunnelStatus,
  ) {
    super();
    this.status = initial;
  }

  getStatus(): TunnelStatus {
    return { ...this.status };
  }

  abstract start(): void;

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
    this.setStatus({
      ...this.status,
      state: "disabled",
      url: null,
      error: null,
      startedAt: null,
    });
  }

  protected setStatus(s: TunnelStatus): void {
    this.status = s;
    this.emit("status", s);
  }

  protected scheduleRestart(): void {
    const delay = this.baseOpts.restartDelayMs ?? 3000;
    this.restartTimer = setTimeout(() => {
      if (!this.disposed) this.start();
    }, delay);
  }
}

/**
 * Wraps `cloudflared tunnel --url http://localhost:<port>` — the "try
 * cloudflare" mode that needs no CF account. URL is a random
 * `*.trycloudflare.com` subdomain that changes every launch.
 */
export class CloudflaredTunnel extends BaseTunnel {
  constructor(private readonly opts: TryOpts) {
    super(opts, {
      state: "disabled",
      url: null,
      error: null,
      startedAt: null,
      mode: "try",
    });
  }

  start(): void {
    if (this.child) return;
    this.disposed = false;
    this.setStatus({
      state: "starting",
      url: null,
      error: null,
      startedAt: Date.now(),
      mode: "try",
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
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && (this.status.state !== "ready" || this.status.url !== match[0])) {
        this.setStatus({
          state: "ready",
          url: match[0],
          error: null,
          startedAt: this.status.startedAt ?? Date.now(),
          mode: "try",
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
        mode: "try",
      });
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.disposed) return;
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      this.setStatus({
        state: "error",
        url: this.status.url,
        error: `cloudflared exited (${reason})`,
        startedAt: this.status.startedAt,
        mode: "try",
      });
      this.scheduleRestart();
    });
  }
}

/**
 * Wraps `cloudflared tunnel run <name>` using a pre-created named tunnel.
 * The user is expected to have run `cloudflared tunnel login`,
 * `cloudflared tunnel create <name>`, and `cloudflared tunnel route dns
 * <name> <hostname>` once before. RCC only reads the credentials file
 * and spawns the long-running tunnel.
 */
export class NamedCloudflaredTunnel extends BaseTunnel {
  constructor(private readonly opts: NamedOpts) {
    super(opts, {
      state: "disabled",
      url: null,
      error: null,
      startedAt: null,
      mode: "named",
      hostname: opts.hostname,
      name: opts.name,
    });
  }

  private preflight(): string | null {
    if (!this.opts.credentialsFile) {
      return "named tunnel: credentialsFile not configured in ~/.rcc/config.json";
    }
    if (!existsSync(this.opts.credentialsFile)) {
      return `named tunnel: credentials file not found at ${this.opts.credentialsFile}. Run \`cloudflared tunnel login && cloudflared tunnel create ${this.opts.name}\` first.`;
    }
    const cert = join(homedir(), ".cloudflared", "cert.pem");
    if (!existsSync(cert)) {
      return `named tunnel: ${cert} missing. Run \`cloudflared tunnel login\` first.`;
    }
    if (!this.opts.hostname) {
      return "named tunnel: hostname not configured in ~/.rcc/config.json";
    }
    if (!this.opts.name) {
      return "named tunnel: name not configured in ~/.rcc/config.json";
    }
    return null;
  }

  start(): void {
    if (this.child) return;
    this.disposed = false;

    const problem = this.preflight();
    if (problem) {
      this.setStatus({
        state: "error",
        url: null,
        error: problem,
        startedAt: Date.now(),
        mode: "named",
        hostname: this.opts.hostname,
        name: this.opts.name,
      });
      return;
    }

    this.setStatus({
      state: "starting",
      url: null,
      error: null,
      startedAt: Date.now(),
      mode: "named",
      hostname: this.opts.hostname,
      name: this.opts.name,
    });

    const bin = this.opts.bin ?? "cloudflared";
    const args = [
      "tunnel",
      "--no-autoupdate",
      "--loglevel",
      "info",
      "--credentials-file",
      this.opts.credentialsFile,
      "--url",
      `http://localhost:${this.opts.port}`,
      "run",
      this.opts.name,
    ];

    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    this.child = child;

    let ready = false;
    const readyHint =
      /Registered tunnel connection|Connection .* registered|Starting metrics server/i;

    const onText = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      process.stdout.write(`[cloudflared] ${text.replace(/\n$/, "")}\n`);
      if (!ready && readyHint.test(text)) {
        ready = true;
        this.setStatus({
          state: "ready",
          url: `https://${this.opts.hostname}`,
          error: null,
          startedAt: this.status.startedAt ?? Date.now(),
          mode: "named",
          hostname: this.opts.hostname,
          name: this.opts.name,
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
        mode: "named",
        hostname: this.opts.hostname,
        name: this.opts.name,
      });
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.disposed) return;
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      this.setStatus({
        state: "error",
        url: this.status.url,
        error: `cloudflared exited (${reason})`,
        startedAt: this.status.startedAt,
        mode: "named",
        hostname: this.opts.hostname,
        name: this.opts.name,
      });
      this.scheduleRestart();
    });
  }
}

export type Tunnel = CloudflaredTunnel | NamedCloudflaredTunnel;

/**
 * Build the appropriate tunnel based on config. Returns null for mode="off",
 * falls back to try-mode (with a warning) if named-mode config is missing
 * required fields — so a typo in config.json doesn't crash the host.
 */
export function startTunnel(config: TunnelConfig, port: number): Tunnel | null {
  if (config.mode === "off") return null;
  if (config.mode === "named") {
    if (!config.name || !config.hostname || !config.credentialsFile) {
      console.warn(
        "[rcc-host] named tunnel missing name/hostname/credentialsFile in ~/.rcc/config.json; falling back to TryCloudflare.",
      );
      return new CloudflaredTunnel({ port });
    }
    return new NamedCloudflaredTunnel({
      port,
      name: config.name,
      hostname: config.hostname,
      credentialsFile: config.credentialsFile,
    });
  }
  return new CloudflaredTunnel({ port });
}
