import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { PermissionMode, SessionMeta } from "@rcc/protocol";
import { RingBuffer } from "./ring-buffer.ts";

export interface BufferedChunk {
  seq: number;
  data: string;
}

export type SessionListener = (chunk: BufferedChunk) => void;
export type ExitListener = (code: number | null) => void;

/**
 * A single Claude Code session: wraps a pty running `claude`, keeps a ring
 * buffer of output so late/reconnected clients can catch up, and fans out
 * live output to any number of subscribed WebSocket clients.
 */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly createdAt = Date.now();
  readonly permissionMode: PermissionMode;
  cols: number;
  rows: number;
  status: "running" | "exited" = "running";
  exitCode: number | null = null;

  private readonly pty: IPty;
  private readonly buffer = new RingBuffer<BufferedChunk>(1024);
  private readonly listeners = new Set<SessionListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private nextSeq = 0;

  constructor(opts: {
    command: string;
    args?: string[];
    cwd?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    permissionMode?: PermissionMode;
  }) {
    this.id = randomUUID().slice(0, 8);
    this.cwd = opts.cwd ?? process.cwd();
    this.cols = opts.cols ?? 120;
    this.rows = opts.rows ?? 32;
    this.permissionMode = opts.permissionMode ?? "default";

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(opts.env ?? {}),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG ?? "en_US.UTF-8",
    };

    const args = [...(opts.args ?? [])];
    // Inject --permission-mode unless caller already provided it.
    const hasMode =
      args.includes("--permission-mode") ||
      args.some((a) => a.startsWith("--permission-mode="));
    if (!hasMode && this.permissionMode !== "default" && isClaudeLike(opts.command)) {
      args.push("--permission-mode", this.permissionMode);
    }

    this.pty = pty.spawn(opts.command, args, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env,
    });

    this.pty.onData((data) => {
      const chunk: BufferedChunk = { seq: this.nextSeq++, data };
      this.buffer.push(chunk);
      for (const l of this.listeners) l(chunk);
    });

    this.pty.onExit(({ exitCode }) => {
      this.status = "exited";
      this.exitCode = exitCode;
      for (const l of this.exitListeners) l(exitCode);
    });
  }

  write(data: string): void {
    if (this.status !== "running") return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    if (this.status === "running") this.pty.resize(cols, rows);
  }

  subscribe(l: SessionListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onExit(l: ExitListener): () => void {
    this.exitListeners.add(l);
    return () => this.exitListeners.delete(l);
  }

  /** Replay buffered output since a given seq. If since is null, replay the whole buffer. */
  replay(since: number | null): BufferedChunk[] {
    if (since === null || since < 0) {
      return this.buffer.since(-1) ?? [];
    }
    const tail = this.buffer.since(since);
    if (tail === null) {
      // Client is too far behind; send whatever we still have.
      return this.buffer.since(-1) ?? [];
    }
    return tail;
  }

  kill(): void {
    try {
      this.pty.kill();
    } catch {
      // already dead
    }
  }

  meta(): SessionMeta {
    return {
      id: this.id,
      cwd: this.cwd,
      title: displayCwd(this.cwd),
      cols: this.cols,
      rows: this.rows,
      createdAt: this.createdAt,
      status: this.status,
      permissionMode: this.permissionMode,
    };
  }
}

function displayCwd(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(home + "/")) return "~" + cwd.slice(home.length);
  return cwd;
}

function isClaudeLike(command: string): boolean {
  const base = command.split("/").pop() ?? command;
  return base === "claude" || base.startsWith("claude-");
}

export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();

  create(opts: {
    command: string;
    args?: string[];
    cwd?: string;
    cols?: number;
    rows?: number;
    permissionMode?: PermissionMode;
  }): Session {
    const session = new Session(opts);
    this.sessions.set(session.id, session);
    session.onExit(() => {
      setTimeout(() => this.sessions.delete(session.id), 30_000);
    });
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  close(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.kill();
    this.sessions.delete(id);
    return true;
  }

  closeAll(): void {
    for (const s of this.sessions.values()) s.kill();
    this.sessions.clear();
  }
}
