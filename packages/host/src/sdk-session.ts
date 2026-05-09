import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ChatMessage,
  ChatSegment,
  PermissionMode,
  SessionMeta,
} from "@rcc/protocol";
import {
  query,
  type Options as SdkOptions,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type Query as SdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import { ChatParser } from "./chat-parser.ts";
import { RingBuffer } from "./ring-buffer.ts";
import type { BufferedChunk, ExitListener, SessionListener } from "./session.ts";

/**
 * SDK-driver session: parallel to the pty-backed {@link Session} but wired
 * directly to `@anthropic-ai/claude-agent-sdk.query()`. Structured events
 * (text_delta, tool_use, tool_result, thinking) arrive as typed SDK messages
 * and are translated into ChatMessage.segments — no heuristic parser, no pty.
 *
 * Lifecycle model: `query()` in streamInput mode accepts an AsyncIterable of
 * user messages for the entire session, and returns an AsyncIterable of
 * assistant/system/result messages. This class keeps one query alive for the
 * whole session and pipes each `write()` in as a new SDKUserMessage.
 *
 * Public shape mirrors Session so most host code treats them uniformly; the
 * pty-specific ops (resize, raw key writes) are no-ops on SDK sessions.
 */
export class SdkSession {
  readonly id: string;
  readonly cwd: string;
  readonly createdAt = Date.now();
  readonly permissionMode: PermissionMode;
  readonly driver = "sdk" as const;
  projectId: string | null;
  cols: number;
  rows: number;
  status: "running" | "exited" = "running";
  exitCode: number | null = null;

  readonly chat: ChatParser;

  // BufferedChunk subscribers are kept for API parity with Session — SDK
  // sessions don't stream raw bytes, but new clients still call subscribe()
  // via attach(). We buffer a short, human-readable transcript for replay so
  // that a reconnecting client without xterm can at least see a summary.
  private readonly buffer = new RingBuffer<BufferedChunk>(64);
  private readonly listeners = new Set<SessionListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private nextSeq = 0;

  private readonly inbox: {
    resolve: (msg: SDKUserMessage) => void;
    reject: (err: Error) => void;
  }[] = [];
  private readonly pendingInputs: SDKUserMessage[] = [];
  private readonly abort = new AbortController();
  private queryHandle: SdkQuery | null = null;
  private startError: Error | null = null;
  private inputBuffer = "";
  // Map toolUseId → { messageId, segmentIndex } so tool_result events land on
  // the right tool_use segment even when multiple parallel tool calls are live.
  private readonly toolIndex = new Map<
    string,
    { messageId: string; segmentIndex: number }
  >();
  // For each streaming assistant message, track which text segment the SDK's
  // partial text_delta events should accumulate into, keyed by the stream
  // event's index (content block index).
  private readonly activeDeltas = new Map<
    string,
    Map<number, { segmentIndex: number; kind: "text" | "thinking"; buf: string }>
  >();

  constructor(opts: {
    cwd?: string;
    cols?: number;
    rows?: number;
    permissionMode?: PermissionMode;
    projectId?: string | null;
  }) {
    this.id = randomUUID().slice(0, 8);
    this.cwd = opts.cwd ?? process.cwd();
    this.cols = opts.cols ?? 120;
    this.rows = opts.rows ?? 32;
    this.permissionMode = opts.permissionMode ?? "default";
    this.projectId = opts.projectId ?? null;
    this.chat = new ChatParser(this.id);
  }

  /**
   * Kick off the query. Resolves once the SDK has produced its first message
   * (or synchronously rejects if we can't find an API key). Rejection goes to
   * the caller and is also re-emitted through the normal chat.append channel
   * as a system message so clients see why the session failed.
   */
  async start(initialPrompt?: string): Promise<void> {
    const apiKey = await resolveApiKey();
    if (!apiKey) {
      const err = new Error(
        "SDK session requires ANTHROPIC_API_KEY env or ~/.rcc/config.json anthropic.apiKey",
      );
      this.fail(err);
      throw err;
    }

    const prompts = this.promptIterator();
    const options: SdkOptions = {
      cwd: this.cwd,
      permissionMode: this.permissionMode,
      abortController: this.abort,
      includePartialMessages: true,
      env: {
        ...(process.env as Record<string, string>),
        ANTHROPIC_API_KEY: apiKey,
      },
    };

    try {
      this.queryHandle = query({ prompt: prompts, options });
    } catch (err: any) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }

    if (initialPrompt && initialPrompt.trim()) {
      this.enqueueUserMessage(initialPrompt.trim());
    }

    // Drain the SDK stream in the background so the caller isn't blocked.
    void this.consume();
  }

  /**
   * Accumulate raw pty-style input until a \r, then submit as a prompt. This
   * lets the web client reuse the existing textarea → `pty.in` wiring for
   * both drivers; the SDK session just interprets the stream as newline-
   * separated user turns.
   */
  write(data: string): void {
    if (this.status !== "running") return;
    this.inputBuffer += data;
    // Split on either \r or \n; flush completed lines.
    let idx: number;
    while ((idx = this.inputBuffer.search(/[\r\n]/)) >= 0) {
      const line = this.inputBuffer.slice(0, idx);
      this.inputBuffer = this.inputBuffer.slice(idx + 1);
      if (line.trim()) this.enqueueUserMessage(line);
    }
  }

  resize(cols: number, rows: number): void {
    // No pty to resize, but keep the latest dims for meta() display.
    this.cols = cols;
    this.rows = rows;
  }

  subscribe(l: SessionListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onExit(l: ExitListener): () => void {
    this.exitListeners.add(l);
    return () => this.exitListeners.delete(l);
  }

  /** API parity with Session.replay — SDK sessions only keep a short transcript
   * log of human-readable summaries, rendered via chat messages. Most clients
   * attaching to an SDK session rely on `chat.list.request` instead. */
  replay(since: number | null): BufferedChunk[] {
    if (since === null || since < 0) return this.buffer.since(-1) ?? [];
    const tail = this.buffer.since(since);
    return tail ?? this.buffer.since(-1) ?? [];
  }

  kill(): void {
    if (this.status === "exited") return;
    try {
      this.abort.abort();
    } catch {
      // ignore
    }
    // Release any pending inbox awaiters so the iterator finishes.
    for (const pending of this.inbox.splice(0)) {
      pending.reject(new Error("session closed"));
    }
    this.markExited(null);
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
      driver: "sdk",
      projectId: this.projectId ?? undefined,
    };
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private enqueueUserMessage(text: string): void {
    const msg: SDKUserMessage = {
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: text },
    };
    // Record on the chat timeline immediately so the client sees their own
    // turn without waiting for a round-trip.
    this.chat.appendMessage({
      id: randomUUID(),
      sid: this.id,
      role: "user",
      segments: [{ kind: "text", content: text }],
      timestamp: Date.now(),
    });
    const waiter = this.inbox.shift();
    if (waiter) {
      waiter.resolve(msg);
    } else {
      this.pendingInputs.push(msg);
    }
  }

  private promptIterator(): AsyncIterable<SDKUserMessage> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        return {
          next(): Promise<IteratorResult<SDKUserMessage>> {
            if (self.status === "exited") {
              return Promise.resolve({ value: undefined as never, done: true });
            }
            const queued = self.pendingInputs.shift();
            if (queued) return Promise.resolve({ value: queued, done: false });
            return new Promise((resolve, reject) => {
              self.inbox.push({
                resolve: (msg) => resolve({ value: msg, done: false }),
                reject,
              });
            });
          },
          return(): Promise<IteratorResult<SDKUserMessage>> {
            return Promise.resolve({ value: undefined as never, done: true });
          },
        };
      },
    };
  }

  private async consume(): Promise<void> {
    const q = this.queryHandle;
    if (!q) return;
    try {
      for await (const msg of q) {
        this.handleSdkMessage(msg);
        if (this.status === "exited") break;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // Expected on kill()
      } else {
        this.fail(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.markExited(this.exitCode);
    }
  }

  private handleSdkMessage(msg: SDKMessage): void {
    switch (msg.type) {
      case "assistant":
        this.onAssistantMessage(msg);
        return;
      case "stream_event":
        this.onPartialMessage(msg);
        return;
      case "user":
        this.onUserMessage(msg);
        return;
      case "result":
        this.onResultMessage(msg);
        return;
      default:
        // system / hook / auth / status / etc. — ignored for now.
        return;
    }
  }

  /**
   * Finalized assistant turn: contains all content blocks for the turn. We
   * either seal a streaming skeleton we already started via partial events,
   * or (if partial streaming didn't produce anything — e.g. the SDK batched)
   * we append a fresh, non-streaming message.
   */
  private onAssistantMessage(msg: SDKAssistantMessage): void {
    const uuid = String(msg.uuid);
    const existing = this.activeDeltas.has(uuid);
    if (existing) {
      // Rewrite with fully-formed blocks so tool_use inputs / final text are
      // authoritative; then flip streaming off.
      const segments = blocksToSegments(msg.message.content, (id, segmentIndex) =>
        this.toolIndex.set(id, { messageId: uuid, segmentIndex }),
      );
      for (let i = 0; i < segments.length; i++) {
        this.chat.updateSegment(uuid, i, segments[i]!);
      }
      const finalized = this.chat.finalizeMessage(uuid, {
        streaming: false,
        segments,
      });
      if (finalized) {
        this.emitAppend(finalized);
      }
      this.activeDeltas.delete(uuid);
      return;
    }
    const segments = blocksToSegments(msg.message.content, (id, segmentIndex) =>
      this.toolIndex.set(id, { messageId: uuid, segmentIndex }),
    );
    const message: ChatMessage = {
      id: uuid,
      sid: this.id,
      role: "assistant",
      segments,
      timestamp: Date.now(),
    };
    this.chat.appendMessage(message);
    this.emitAppend(message);
  }

  /**
   * Streaming delta. We lazily create a skeleton assistant message on the
   * first event for a given uuid, then accumulate text/thinking deltas into
   * their respective segments and fire chat.update frames.
   */
  private onPartialMessage(msg: SDKPartialAssistantMessage): void {
    const uuid = String(msg.uuid);
    let deltas = this.activeDeltas.get(uuid);
    if (!deltas) {
      deltas = new Map();
      this.activeDeltas.set(uuid, deltas);
      this.chat.appendMessage({
        id: uuid,
        sid: this.id,
        role: "assistant",
        segments: [],
        timestamp: Date.now(),
        streaming: true,
      });
      this.emitAppend({
        id: uuid,
        sid: this.id,
        role: "assistant",
        segments: [],
        timestamp: Date.now(),
        streaming: true,
      });
    }
    const event = msg.event;
    if (event.type === "content_block_start") {
      const block = event.content_block;
      let seg: ChatSegment;
      if (block.type === "text") {
        seg = { kind: "text", content: block.text ?? "" };
      } else if (block.type === "thinking") {
        seg = { kind: "thinking", content: block.thinking ?? "" };
      } else if (block.type === "tool_use") {
        seg = {
          kind: "tool_use",
          tool: block.name,
          input: safeStringify(block.input ?? {}),
          collapsed: true,
          toolUseId: block.id,
        };
        this.toolIndex.set(block.id, {
          messageId: uuid,
          segmentIndex: event.index,
        });
      } else {
        seg = { kind: "text", content: "" };
      }
      deltas.set(event.index, {
        segmentIndex: event.index,
        kind: block.type === "thinking" ? "thinking" : "text",
        buf: block.type === "text" ? (block.text ?? "") : block.type === "thinking" ? (block.thinking ?? "") : "",
      });
      this.chat.updateSegment(uuid, event.index, seg);
      this.emitUpdate(uuid, event.index, seg);
    } else if (event.type === "content_block_delta") {
      const slot = deltas.get(event.index);
      if (!slot) return;
      const d = event.delta;
      if (d.type === "text_delta") {
        slot.buf += d.text;
        const seg: ChatSegment = { kind: "text", content: slot.buf };
        this.chat.updateSegment(uuid, slot.segmentIndex, seg);
        this.emitUpdate(uuid, slot.segmentIndex, seg);
      } else if (d.type === "thinking_delta") {
        slot.buf += d.thinking;
        const seg: ChatSegment = { kind: "thinking", content: slot.buf };
        this.chat.updateSegment(uuid, slot.segmentIndex, seg);
        this.emitUpdate(uuid, slot.segmentIndex, seg);
      }
      // input_json_delta for tool_use blocks: we re-materialize from the
      // final assistant message, so streaming partial JSON isn't useful here.
    }
  }

  /**
   * User messages the SDK surfaces back to us include synthetic tool_result
   * turns from the model's own tool invocations. Map those onto the paired
   * tool_use segment.
   */
  private onUserMessage(msg: SDKUserMessage): void {
    if (msg.isSynthetic !== true) return;
    const content = msg.message.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "tool_result"
      ) {
        const b = block as {
          type: "tool_result";
          tool_use_id: string;
          content?: unknown;
          is_error?: boolean;
        };
        const target = this.toolIndex.get(b.tool_use_id);
        if (!target) continue;
        const seg: ChatSegment = {
          kind: "tool_result",
          toolUseId: b.tool_use_id,
          content: toolResultText(b.content),
          isError: b.is_error,
        };
        // Append as a new segment on the same message.
        const messageIdx = this.chat
          .list()
          .findIndex((m) => m.id === target.messageId);
        if (messageIdx < 0) continue;
        const message = this.chat.list()[messageIdx]!;
        const newIndex = message.segments.length;
        this.chat.updateSegment(target.messageId, newIndex, seg);
        this.emitUpdate(target.messageId, newIndex, seg);
      }
    }
  }

  private onResultMessage(msg: SDKResultMessage): void {
    if (msg.subtype === "success") return;
    // Surface errors as a system message so the client sees them.
    const err = msg.subtype === "error_during_execution" ? "execution error" : msg.subtype;
    this.appendSystem(`SDK: ${err}`);
  }

  private appendSystem(text: string): void {
    const m: ChatMessage = {
      id: randomUUID(),
      sid: this.id,
      role: "system",
      segments: [{ kind: "text", content: text }],
      timestamp: Date.now(),
    };
    this.chat.appendMessage(m);
    this.emitAppend(m);
  }

  private emitAppend(_m: ChatMessage): void {
    // chat.onMessage listener in host/index.ts will pick this up via appendMessage.
    // Emitting again here would double-broadcast, so we just push a summary to
    // the buffer so replay() returns something for a reconnecting attach.
    const chunk: BufferedChunk = {
      seq: this.nextSeq++,
      data: "",
    };
    this.buffer.push(chunk);
    for (const l of this.listeners) l(chunk);
  }

  private emitUpdate(
    _messageId: string,
    _segmentIndex: number,
    _segment: ChatSegment,
  ): void {
    // chat.onUpdate listener handles the broadcast.
  }

  private fail(err: Error): void {
    this.startError = err;
    this.appendSystem(err.message);
  }

  private markExited(code: number | null): void {
    if (this.status === "exited") return;
    this.status = "exited";
    this.exitCode = code;
    for (const l of this.exitListeners) l(code);
  }

  get lastStartError(): Error | null {
    return this.startError;
  }
}

function displayCwd(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(home + "/")) return "~" + cwd.slice(home.length);
  return cwd;
}

function safeStringify(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (typeof c === "string") parts.push(c);
      else if (c && typeof c === "object") {
        const maybeText = (c as { text?: string }).text;
        if (typeof maybeText === "string") parts.push(maybeText);
        else parts.push(safeStringify(c));
      }
    }
    return parts.join("\n");
  }
  return safeStringify(content);
}

/**
 * Translate a finalized assistant message's content blocks into ChatSegments.
 * The callback records each tool_use block's segment index so subsequent
 * tool_result user-messages can update the correct segment.
 */
function blocksToSegments(
  content: unknown,
  onToolUse: (toolUseId: string, segmentIndex: number) => void,
): ChatSegment[] {
  if (typeof content === "string") {
    return [{ kind: "text", content }];
  }
  if (!Array.isArray(content)) return [];
  const segments: ChatSegment[] = [];
  for (let i = 0; i < content.length; i++) {
    const b = content[i] as { type?: string } & Record<string, unknown>;
    if (!b || typeof b !== "object") continue;
    switch (b.type) {
      case "text":
        segments.push({ kind: "text", content: String(b.text ?? "") });
        break;
      case "thinking":
        segments.push({ kind: "thinking", content: String(b.thinking ?? "") });
        break;
      case "tool_use": {
        const id = String(b.id ?? "");
        segments.push({
          kind: "tool_use",
          tool: String(b.name ?? "Unknown"),
          input: safeStringify(b.input ?? {}),
          collapsed: true,
          toolUseId: id,
        });
        if (id) onToolUse(id, segments.length - 1);
        break;
      }
      default:
        // Skip server-tool / redacted-thinking / etc. blocks — they don't map
        // onto our chat-segment vocabulary yet.
        break;
    }
  }
  return segments;
}

async function resolveApiKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const raw = await readFile(join(homedir(), ".rcc", "config.json"), "utf8");
    const cfg = JSON.parse(raw) as { anthropic?: { apiKey?: string } };
    const key = cfg.anthropic?.apiKey;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {
    // ignore — no config or unreadable
  }
  return null;
}
