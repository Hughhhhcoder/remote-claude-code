import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { PermissionMode, SessionMeta, SessionSummary } from "@rcc/protocol";
import { RingBuffer } from "./ring-buffer.ts";
import { ChatParser } from "./chat-parser.ts";
import { SdkSession } from "./sdk-session.ts";
import { Recorder } from "./recording.ts";

const RING_TAIL_BYTES = 32 * 1024;

// [B13-B] How many recent chat.append/update/delta frames to retain per
// session for reconnect replay. 500 is ~a few minutes of heavy streaming;
// anything older forces the client to do a full chat.list re-hydration.
const CHAT_FRAME_RING_CAPACITY = 500;

export interface BufferedChunk {
  seq: number;
  data: string;
}

/**
 * [B13-B] A chat.* frame the host already emitted to subscribers, tagged
 * with its per-session monotonic seq so reconnecting clients can diff from
 * the seq they last saw.
 */
export interface BufferedChatFrame {
  seq: number;
  frame: import("@rcc/protocol").ChatAppend
    | import("@rcc/protocol").ChatUpdate
    | import("@rcc/protocol").ChatDelta;
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
  readonly createdAt: number;
  lastActiveAt: number;
  readonly permissionMode: PermissionMode;
  readonly driver = "cli" as const;
  /**
   * Added in M4 batch 3: which project this session belongs to. Callers set
   * it via opts.projectId; legacy callers pass nothing and the session is
   * treated as "default project" by clients.
   */
  projectId: string | null;
  cols: number;
  rows: number;
  status: "running" | "exited" = "running";
  exitCode: number | null = null;
  /**
   * Added in M6 batch 9: most recently generated AI summary, mirrored into
   * meta() so clients see it inline. Mutable; host writes via setSummary().
   */
  summary: SessionSummary | null = null;

  private readonly pty: IPty;
  private readonly buffer = new RingBuffer<BufferedChunk>(1024);
  private tailAccumulator = "";
  private readonly listeners = new Set<SessionListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private nextSeq = 0;
  // [recording] Optional asciinema cast v2 writer. When non-null, every pty
  // chunk is appended as a `[t, "o", data]` JSONL line. Opened by
  // startRecording(); sealed on stopRecording(), session.exit, or hitting the
  // 50MB cap (auto-stop).
  private recorder: Recorder | null = null;
  // [messages] — heuristic semantic-chat parser. Feeds off pty output;
  // assistant messages surface via chat.append broadcasts in host/index.ts.
  readonly chat: ChatParser;

  // [B13-B] Per-session monotonic chat-frame seq + ring buffer. Stamped on
  // every outgoing chat.append/update/delta by attachChatBroadcast so a
  // reconnecting client can ask for everything after its last-seen seq.
  private chatFrameSeqCounter = 0;
  private readonly recentChatFrames = new RingBuffer<BufferedChatFrame>(
    CHAT_FRAME_RING_CAPACITY,
  );

  constructor(opts: {
    command: string;
    args?: string[];
    cwd?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    permissionMode?: PermissionMode;
    projectId?: string | null;
    id?: string;
    createdAt?: number;
    initialRingTail?: string;
    initialChat?: readonly import("@rcc/protocol").ChatMessage[];
  }) {
    this.id = opts.id ?? randomUUID().slice(0, 8);
    this.createdAt = opts.createdAt ?? Date.now();
    this.lastActiveAt = this.createdAt;
    this.cwd = opts.cwd ?? process.cwd();
    this.cols = opts.cols ?? 120;
    this.rows = opts.rows ?? 32;
    this.permissionMode = opts.permissionMode ?? "default";
    this.projectId = opts.projectId ?? null;
    this.chat = new ChatParser(this.id);
    if (opts.initialChat && opts.initialChat.length > 0) {
      for (const m of opts.initialChat) this.chat.appendMessage({ ...m, sid: this.id });
    }
    if (opts.initialRingTail) {
      this.tailAccumulator = opts.initialRingTail.slice(-RING_TAIL_BYTES);
      // Seed replay with one synthetic chunk so attach() can show the archive.
      const chunk: BufferedChunk = { seq: this.nextSeq++, data: this.tailAccumulator };
      this.buffer.push(chunk);
    }

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
      // Keep a short ANSI tail in memory for persistence — snapshots ship the
      // last ~32KB so a reattached client sees recent terminal state even
      // after host restart.
      this.tailAccumulator += data;
      if (this.tailAccumulator.length > RING_TAIL_BYTES * 2) {
        this.tailAccumulator = this.tailAccumulator.slice(-RING_TAIL_BYTES);
      }
      this.lastActiveAt = Date.now();
      for (const l of this.listeners) l(chunk);
      // [messages] keep the chat parser fed alongside the raw stream.
      this.chat.feedOutput(data);
      // [recording] fan pty.out into the asciinema writer if active. We pass
      // raw data (ANSI and all) — the whole point of a cast is byte fidelity.
      if (this.recorder) this.recorder.write(data);
    });

    this.pty.onExit(({ exitCode }) => {
      this.status = "exited";
      this.exitCode = exitCode;
      // Seal any open recording on process exit so the file is playable.
      if (this.recorder) {
        const r = this.recorder;
        this.recorder = null;
        void r.stop("exit");
      }
      for (const l of this.exitListeners) l(exitCode);
    });
  }

  write(data: string): void {
    if (this.status !== "running") return;
    this.lastActiveAt = Date.now();
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

  /** [B13-B] Reserve the next per-session chat-frame seq. */
  nextChatFrameSeq(): number {
    return ++this.chatFrameSeqCounter;
  }

  /** [B13-B] Retain an already-broadcast chat.* frame for reconnect replay. */
  recordChatFrame(entry: BufferedChatFrame): void {
    this.recentChatFrames.push(entry);
  }

  /** [B13-B] Current value of the chat-frame seq counter. */
  get currentChatFrameSeq(): number {
    return this.chatFrameSeqCounter;
  }

  /**
   * [B13-B] Replay chat frames strictly after `since`. Returns:
   *  - `{ frames, lostCount: 0 }` when the ring still covers `since`
   *    (includes the no-op case `since === currentChatFrameSeq` → `[]`).
   *  - `{ frames: [], lostCount: currentSeq - since }` when the client is too
   *    far behind and should re-hydrate via `chat.list.request`.
   *
   * `since <= 0` on a session with zero emitted frames returns an empty
   * replay without flagging loss (fresh attach has nothing to miss).
   */
  replayChatFrames(since: number): { frames: BufferedChatFrame[]; lostCount: number } {
    const current = this.chatFrameSeqCounter;
    if (since >= current) return { frames: [], lostCount: 0 };
    const tail = this.recentChatFrames.since(since);
    if (tail === null) {
      return { frames: [], lostCount: current - since };
    }
    return { frames: tail, lostCount: 0 };
  }

  kill(): void {
    try {
      this.pty.kill();
    } catch {
      // already dead
    }
  }

  /** Last ~32KB of ANSI output — fed into the snapshot so a reattached client
   * can restore recent terminal state after a host restart. */
  ringTail(): string {
    return this.tailAccumulator.slice(-RING_TAIL_BYTES);
  }

  // [recording] start/stop asciinema cast writer for this session. start()
  // rejects if already running; stop() is idempotent. The recorder instance
  // is owned by the session and sealed automatically on pty exit.

  async startRecording(title?: string): Promise<void> {
    if (this.recorder) return;
    const r = new Recorder(this.id, () => {
      // Auto-stop on 50MB cap — drop reference so isRecording() returns false.
      if (this.recorder === r) this.recorder = null;
    });
    await r.start({ cols: this.cols, rows: this.rows, title: title ?? displayCwd(this.cwd) });
    this.recorder = r;
  }

  async stopRecording(): Promise<void> {
    const r = this.recorder;
    if (!r) return;
    this.recorder = null;
    await r.stop("user");
  }

  recordingStatus(): { recording: boolean; size: number; startedAt: number | null; capped: boolean } {
    const r = this.recorder;
    if (!r) return { recording: false, size: 0, startedAt: null, capped: false };
    return {
      recording: r.isRecording(),
      size: r.getSize(),
      startedAt: r.getStartedAt(),
      capped: r.isCapped(),
    };
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
      driver: "cli",
      projectId: this.projectId ?? undefined,
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

/**
 * A Session-like value the rest of the host can treat uniformly — CLI driver
 * (node-pty) or SDK driver (@anthropic-ai/claude-agent-sdk). pty-specific ops
 * (resize, raw key writes) are no-ops on SDK sessions; clients are expected
 * to render SDK sessions via ChatView only.
 */
export type AnySession = Session | SdkSession | DeadSession;

/**
 * Registry-resident archive of a previously-live session whose pty / SDK query
 * is gone (host restart, caller explicitly killed but kept the archive). Has
 * no backing process, so write/resize/kill are no-ops; replay() returns the
 * persisted ring tail as one synthetic chunk; chat is restored from disk.
 * UI sees `status: "exited"` like any other dead session and can offer a
 * "resume" button that sends a `session.resume` frame — the host then swaps
 * this archive out for a fresh live {@link Session} / {@link SdkSession} that
 * reuses the same id, cwd, and chat history.
 */
export class DeadSession {
  readonly id: string;
  readonly cwd: string;
  readonly createdAt: number;
  lastActiveAt: number;
  readonly permissionMode: PermissionMode;
  readonly driver: "cli" | "sdk";
  projectId: string | null;
  cols: number;
  rows: number;
  readonly status = "exited" as const;
  readonly exitCode: number | null = null;
  readonly chat: ChatParser;
  private readonly _ringTail: string;

  constructor(h: SessionHydration) {
    this.id = h.id;
    this.cwd = h.meta.cwd;
    this.createdAt = h.createdAt;
    this.lastActiveAt = h.createdAt;
    this.permissionMode = h.meta.permissionMode;
    this.driver = h.meta.driver;
    this.projectId = h.meta.projectId ?? null;
    this.cols = h.meta.cols;
    this.rows = h.meta.rows;
    this.chat = new ChatParser(this.id);
    for (const m of h.chat) this.chat.appendMessage({ ...m, sid: this.id });
    this._ringTail = h.ringTail ?? "";
  }

  write(_data: string): void {
    // no-op — caller should resume first
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  subscribe(_l: SessionListener): () => void {
    return () => {};
  }

  onExit(_l: ExitListener): () => void {
    return () => {};
  }

  replay(_since: number | null): BufferedChunk[] {
    if (!this._ringTail) return [];
    return [{ seq: 0, data: this._ringTail }];
  }

  // [B13-B] Dead sessions never emit chat frames (no pty, no SDK query, no
  // attachChatBroadcast) so the seq counter stays at 0 and the replay is
  // always empty with no perceived loss.
  nextChatFrameSeq(): number {
    return 0;
  }

  recordChatFrame(_entry: BufferedChatFrame): void {
    // no-op
  }

  get currentChatFrameSeq(): number {
    return 0;
  }

  replayChatFrames(_since: number): { frames: BufferedChatFrame[]; lostCount: number } {
    return { frames: [], lostCount: 0 };
  }

  kill(): void {
    // already dead
  }

  ringTail(): string {
    return this._ringTail;
  }

  meta(): SessionMeta {
    return {
      id: this.id,
      cwd: this.cwd,
      title: displayCwd(this.cwd),
      cols: this.cols,
      rows: this.rows,
      createdAt: this.createdAt,
      status: "exited",
      permissionMode: this.permissionMode,
      driver: this.driver,
      projectId: this.projectId ?? undefined,
    };
  }
}

/**
 * Snapshot shape consumed by `hydrateSession` to rebuild a dead session (as a
 * registry entry only, with no live pty / SDK query) after a host restart.
 * Mirrors {@link SessionSnapshot} in persistence.ts but sealed off from the
 * fs-layer type so callers don't need a round-trip through zod.
 */
export interface SessionHydration {
  id: string;
  createdAt: number;
  meta: SessionMeta;
  chat: readonly import("@rcc/protocol").ChatMessage[];
  ringTail: string;
}

export interface CreateSessionOpts {
  driver?: "cli" | "sdk";
  // CLI-specific (ignored by SDK):
  command?: string;
  args?: string[];
  // Both:
  cwd?: string;
  cols?: number;
  rows?: number;
  permissionMode?: PermissionMode;
  projectId?: string | null;
  /** Reuse this id (resume path). When omitted a fresh 8-char uuid is minted. */
  id?: string;
  createdAt?: number;
  initialChat?: readonly import("@rcc/protocol").ChatMessage[];
  initialRingTail?: string;
}

/**
 * Factory: instantiate the right session class for the requested driver.
 * Callers that know they want a CLI session can still `new Session(...)`
 * directly; new call-sites should prefer {@link SessionRegistry.create}
 * which threads the driver choice from `session.new` frames.
 */
export function createSession(opts: CreateSessionOpts): AnySession {
  if (opts.driver === "sdk") {
    return new SdkSession({
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      permissionMode: opts.permissionMode,
      projectId: opts.projectId ?? null,
      id: opts.id,
      createdAt: opts.createdAt,
      initialChat: opts.initialChat,
    });
  }
  if (!opts.command) {
    throw new Error("CLI session requires a command");
  }
  return new Session({
    command: opts.command,
    args: opts.args,
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    permissionMode: opts.permissionMode,
    projectId: opts.projectId ?? null,
    id: opts.id,
    createdAt: opts.createdAt,
    initialChat: opts.initialChat,
    initialRingTail: opts.initialRingTail,
  });
}

export class SessionRegistry {
  private readonly sessions = new Map<string, AnySession>();

  create(opts: CreateSessionOpts): AnySession {
    const session = createSession(opts);
    this.sessions.set(session.id, session);
    return session;
  }

  /** Add a pre-built session (e.g. a DeadSession rebuilt from a snapshot,
   * or a live session resumed from an archive). */
  add(session: AnySession): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): AnySession | undefined {
    return this.sessions.get(id);
  }

  list(): AnySession[] {
    return [...this.sessions.values()];
  }

  /** Drop the registry entry without touching disk. Used when a snapshot is
   * deleted (close) or when replacing a dead session with a live one. */
  remove(id: string): boolean {
    return this.sessions.delete(id);
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
