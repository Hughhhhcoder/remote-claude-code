import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatSegment } from "@rcc/protocol";

// -----------------------------------------------------------------------------
// ANSI / VT stripping
// -----------------------------------------------------------------------------
// We widened this in B11-A: on top of CSI/OSC/simple, we now strip the
// cursor-save/restore pair (ESC 7 / ESC 8) and intentionally do NOT drop lone
// CRs — the Claude CLI uses \r to redraw single lines in place, and a lone \r
// is converted to \n so the line-oriented state machine still sees a boundary.
const ANSI_CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// ESC 7 / ESC 8 = save/restore cursor; ESC (B / ESC )0 = charset select; also
// handle ESC = / ESC > / ESC N / ESC O / ESC M / ESC c plus the legacy \x1b78.
const ANSI_SIMPLE = /\x1b[()][A-Za-z0-9]|\x1b[=>NOM78c]/g;

function stripAnsi(s: string): string {
  return s
    .replace(ANSI_CSI, "")
    .replace(ANSI_OSC, "")
    .replace(ANSI_SIMPLE, "")
    // Convert bare CR (not part of CRLF) to LF so redraw lines still end up
    // line-boundaried for the per-line state machine. CRLF → LF collapses too.
    .replace(/\r\n?/g, "\n");
}

// -----------------------------------------------------------------------------
// Caps & timings
// -----------------------------------------------------------------------------
const MAX_MESSAGES = 100;
const MAX_SEGMENT_LEN = 256 * 1024;
const PENDING_HARD_CAP = 512 * 1024;
const IDLE_TIMEOUT_MS = 1500;
const EMIT_DEBOUNCE_MS = 50;

// -----------------------------------------------------------------------------
// Parser state machine
// -----------------------------------------------------------------------------
type State = "IDLE" | "TEXT" | "CODE_FENCE" | "DIFF_BLOCK" | "TOOL_USE" | "BOX_PANEL";

// Line-prefix classifiers — each returns true if the line opens the state.
const RX_FENCE = /^```(\S*)\s*$/;
const RX_TOOL = /^[●⏺]\s+([A-Za-z_][\w-]*)\((.*)\)\s*$/;
const RX_BOX_TOP = /^╭/;
const RX_BOX_BOTTOM = /^╰/;
const RX_DIFF_HEADER = /^(diff --git |--- a\/|\+\+\+ b\/)/;
const RX_DIFF_LINE = /^[+-]/;

interface OpenSegmentBuf {
  kind: ChatSegment["kind"];
  // Common accumulator for content/output.
  content: string;
  // For code-fence.
  lang?: string;
  // For tool_use.
  tool?: string;
  input?: string;
}

/**
 * B11-A rewrite: a real state-machine parser.
 *
 * The Claude CLI doesn't expose structured events, so we treat `pty.out` as a
 * stream of ANSI-stripped lines and run a line-oriented machine that groups
 * contiguous lines into segments of different kinds. Tool-use segments land
 * *inline* inside the surrounding assistant message — matching the way
 * Claude.ai renders — rather than being flushed as standalone messages.
 *
 * Public API is preserved: existing callers in session.ts / sdk-session.ts /
 * index.ts keep working. New callables: beginNewMessage(), dispose().
 *
 * NOTE: dispose() clears pending timers. Ideal call sites are Session.kill()
 * and SdkSession teardown — but this batch does not modify session.ts.
 */
export class ChatParser {
  private messages: ChatMessage[] = [];
  /** Bytes since the last flush boundary — replenished incrementally. */
  private pending = "";
  /** State machine state. */
  private state: State = "IDLE";
  /** Current in-progress segment accumulator. */
  private buf: OpenSegmentBuf | null = null;
  /** ID of the assistant message currently being built (null = none). */
  private activeMessageId: string | null = null;
  /** Index of the currently-appended segment on the active message. */
  private activeSegmentIndex = -1;
  /** Wall-clock of last feedOutput() call — powers idle message cut. */
  private lastOutputAt = 0;
  /** Pending flush + idle timers. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once dispose() has run — blocks re-arming timers. */
  private disposed = false;

  private readonly listeners = new Set<(m: ChatMessage) => void>();
  private readonly updateListeners = new Set<
    (messageId: string, segmentIndex: number, segment: ChatSegment) => void
  >();
  // [B11-C] Append-only text delta listeners. Fires IN ADDITION to onUpdate
  // whenever a text segment's new content strictly extends (startsWith) its
  // previous content. Non-extending replacements (content shrink, kind change,
  // rewrite) still fire onUpdate only — the web client's chat.update path is
  // the safety net, so any client that doesn't yet consume chat.delta stays in
  // sync. See protocol ChatDelta.
  private readonly deltaListeners = new Set<
    (messageId: string, segmentIndex: number, textDelta: string) => void
  >();

  private readonly now: () => number;

  constructor(
    private readonly sid: string,
    opts?: { now?: () => number },
  ) {
    this.now = opts?.now ?? (() => Date.now());
  }

  // ---------------------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------------------

  feedOutput(bytes: string): void {
    if (!bytes) return;
    const stripped = stripAnsi(bytes);
    // If the previous output chunk was a while ago, treat it as the start of a
    // fresh assistant turn. Idle-timer also catches this async, but we want to
    // react synchronously when input arrives after a long quiet period.
    const t = this.now();
    if (
      this.activeMessageId &&
      this.lastOutputAt > 0 &&
      t - this.lastOutputAt > IDLE_TIMEOUT_MS
    ) {
      this.closeActiveMessage();
    }
    this.lastOutputAt = t;

    this.pending += stripped;
    if (this.pending.length > PENDING_HARD_CAP) {
      this.pending = this.pending.slice(-PENDING_HARD_CAP / 2);
    }

    // Only consume up to the last newline; keep the tail pending so
    // mid-line deltas don't get classified prematurely.
    const cut = this.pending.lastIndexOf("\n");
    if (cut < 0) {
      // No full line yet — still schedule idle/flush so partial text renders
      // incrementally once we've entered TEXT state from a prior line.
      this.scheduleFlush();
      this.armIdleTimer();
      return;
    }
    const lines = this.pending.slice(0, cut).split("\n");
    this.pending = this.pending.slice(cut + 1);
    for (const line of lines) this.consumeLine(line);
    this.scheduleFlush();
    this.armIdleTimer();
  }

  feedInput(text: string): void {
    const clean = text.replace(/\r$/, "").trim();
    if (!clean) return;
    // A user prompt echoes — cut any in-flight assistant message so the user
    // line doesn't get absorbed, then push the user turn.
    this.closeActiveMessage();
    this.push({
      id: randomUUID(),
      sid: this.sid,
      role: "user",
      segments: [{ kind: "text", content: clean.slice(0, MAX_SEGMENT_LEN) }],
      timestamp: this.now(),
    });
  }

  /** Force the end of the current assistant message — callers (e.g. session.ts
   * at a prompt boundary) can invoke this. Best-effort idle heuristic does the
   * same asynchronously. */
  beginNewMessage(): void {
    this.closeActiveMessage();
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------

  private consumeLine(line: string): void {
    // Dispatch by state — code-fence and box-panel "eat" their internal lines.
    switch (this.state) {
      case "CODE_FENCE":
        if (RX_FENCE.test(line)) {
          this.closeBuf();
          this.state = "IDLE";
          return;
        }
        this.appendToBuf(line + "\n");
        return;
      case "BOX_PANEL":
        this.appendToBuf(line + "\n");
        if (RX_BOX_BOTTOM.test(line)) {
          this.closeBuf();
          this.state = "IDLE";
        }
        return;
      case "DIFF_BLOCK":
        if (line === "" || (!RX_DIFF_LINE.test(line) && !RX_DIFF_HEADER.test(line))) {
          // Diff block ends on first non-diff line.
          this.closeBuf();
          this.state = "IDLE";
          // Fall through: classify this line from scratch.
          break;
        }
        this.appendToBuf(line + "\n");
        return;
      case "TOOL_USE": {
        // Tool block ends on a blank line or when another recognized prefix
        // starts. We look for two consecutive blanks OR a line that opens a
        // new state.
        if (line === "" && this.buf?.content.endsWith("\n\n")) {
          this.closeBuf();
          this.state = "IDLE";
          return;
        }
        if (
          RX_TOOL.test(line) ||
          RX_FENCE.test(line) ||
          RX_BOX_TOP.test(line) ||
          RX_DIFF_HEADER.test(line)
        ) {
          this.closeBuf();
          this.state = "IDLE";
          break; // re-classify the current line
        }
        this.appendToBuf(line + "\n");
        return;
      }
      case "TEXT":
      case "IDLE":
        break;
    }

    // IDLE / post-fallthrough: classify a fresh line.
    const fence = line.match(RX_FENCE);
    if (fence) {
      this.closeBuf();
      this.state = "CODE_FENCE";
      this.buf = { kind: "code", content: "", lang: fence[1] || undefined };
      return;
    }
    const tool = line.match(RX_TOOL);
    if (tool) {
      this.closeBuf();
      this.state = "TOOL_USE";
      this.buf = {
        kind: "tool_use",
        content: "",
        tool: tool[1] ?? "Unknown",
        input: tool[2] ?? "",
      };
      return;
    }
    if (RX_BOX_TOP.test(line)) {
      this.closeBuf();
      this.state = "BOX_PANEL";
      this.buf = { kind: "tool_use", content: line + "\n", tool: "Panel", input: "" };
      return;
    }
    if (RX_DIFF_HEADER.test(line)) {
      this.closeBuf();
      this.state = "DIFF_BLOCK";
      this.buf = { kind: "diff", content: line + "\n" };
      return;
    }
    // Blank line in TEXT = paragraph break; keep it inside the text segment
    // but drop runs of 3+ blanks.
    if (line === "" && this.state !== "TEXT") {
      return;
    }
    // Default: TEXT — grow or start a text buffer.
    if (this.state !== "TEXT") {
      this.state = "TEXT";
      this.buf = { kind: "text", content: "" };
    }
    this.appendToBuf(line + "\n");
  }

  private appendToBuf(chunk: string): void {
    if (!this.buf) return;
    if (this.buf.content.length + chunk.length > MAX_SEGMENT_LEN) {
      this.buf.content = (this.buf.content + chunk).slice(-MAX_SEGMENT_LEN);
    } else {
      this.buf.content += chunk;
    }
  }

  private closeBuf(): void {
    if (!this.buf) {
      return;
    }
    const seg = bufToSegment(this.buf);
    this.buf = null;
    // Only append/update if the segment carries content.
    if (segmentIsEmpty(seg)) return;
    this.ensureActiveMessage();
    const msgId = this.activeMessageId!;
    const msg = this.findMessage(msgId);
    if (!msg) return;
    // If the last segment on the active message is still "open" (matching
    // the one we just finalized), replace it; otherwise append a new one.
    if (
      this.activeSegmentIndex >= 0 &&
      this.activeSegmentIndex === msg.segments.length - 1 &&
      msg.segments[this.activeSegmentIndex]?.kind === seg.kind &&
      seg.kind !== "tool_use" // tool_use is always its own closed segment
    ) {
      const prev = msg.segments[this.activeSegmentIndex]!;
      msg.segments[this.activeSegmentIndex] = seg;
      this.emitSegment(msgId, this.activeSegmentIndex, prev, seg);
    } else {
      msg.segments.push(seg);
      this.activeSegmentIndex = msg.segments.length - 1;
      this.emitSegment(msgId, this.activeSegmentIndex, undefined, seg);
    }
    // After closing a non-text segment, reset the "live" index so the next
    // TEXT run will open a fresh segment rather than extending this one.
    if (seg.kind !== "text") {
      this.activeSegmentIndex = -1;
    }
  }

  // ---------------------------------------------------------------------------
  // Active-message book-keeping
  // ---------------------------------------------------------------------------

  private ensureActiveMessage(): void {
    if (this.activeMessageId) return;
    const msg: ChatMessage = {
      id: randomUUID(),
      sid: this.sid,
      role: "assistant",
      segments: [],
      timestamp: this.now(),
      streaming: true,
    };
    this.activeMessageId = msg.id;
    this.activeSegmentIndex = -1;
    this.push(msg);
  }

  private closeActiveMessage(): void {
    // Flush any open buffer into the active message first.
    this.closeBuf();
    if (!this.activeMessageId) {
      this.state = "IDLE";
      return;
    }
    const msg = this.findMessage(this.activeMessageId);
    if (msg) {
      delete msg.streaming;
    }
    this.activeMessageId = null;
    this.activeSegmentIndex = -1;
    this.state = "IDLE";
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private findMessage(id: string): ChatMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i]!.id === id) return this.messages[i];
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Timers — debounced emit + idle close
  // ---------------------------------------------------------------------------

  private scheduleFlush(): void {
    if (this.disposed) return;
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushLiveText();
    }, EMIT_DEBOUNCE_MS);
  }

  /** Emit an update for the currently-open TEXT buffer without closing it, so
   * the web client sees incremental growth as bytes arrive. */
  private flushLiveText(): void {
    if (!this.buf || this.buf.kind !== "text") return;
    if (!this.buf.content) return;
    this.ensureActiveMessage();
    const msgId = this.activeMessageId!;
    const msg = this.findMessage(msgId);
    if (!msg) return;
    const seg: ChatSegment = { kind: "text", content: this.buf.content };
    let prev: ChatSegment | undefined;
    if (
      this.activeSegmentIndex >= 0 &&
      this.activeSegmentIndex === msg.segments.length - 1 &&
      msg.segments[this.activeSegmentIndex]?.kind === "text"
    ) {
      prev = msg.segments[this.activeSegmentIndex];
      msg.segments[this.activeSegmentIndex] = seg;
    } else {
      msg.segments.push(seg);
      this.activeSegmentIndex = msg.segments.length - 1;
      prev = undefined;
    }
    this.emitSegment(msgId, this.activeSegmentIndex, prev, seg);
  }

  private armIdleTimer(): void {
    if (this.disposed) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.closeActiveMessage();
    }, IDLE_TIMEOUT_MS);
  }

  // ---------------------------------------------------------------------------
  // SDK-driver entry points (preserved from v1)
  // ---------------------------------------------------------------------------

  appendMessage(m: ChatMessage): void {
    this.push(m);
  }

  updateSegment(messageId: string, segmentIndex: number, segment: ChatSegment): number {
    const idx = this.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return -1;
    const msg = this.messages[idx]!;
    while (msg.segments.length <= segmentIndex) {
      msg.segments.push({ kind: "text", content: "" });
    }
    const prev = msg.segments[segmentIndex];
    msg.segments[segmentIndex] = segment;
    this.emitSegment(messageId, segmentIndex, prev, segment);
    return idx;
  }

  finalizeMessage(messageId: string, patch: Partial<ChatMessage>): ChatMessage | null {
    const idx = this.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return null;
    const merged: ChatMessage = { ...this.messages[idx]!, ...patch };
    this.messages[idx] = merged;
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Listeners & accessors
  // ---------------------------------------------------------------------------

  private push(m: ChatMessage): void {
    this.messages.push(m);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    for (const l of this.listeners) l(m);
  }

  private emitUpdate(messageId: string, segmentIndex: number, segment: ChatSegment): void {
    for (const l of this.updateListeners) l(messageId, segmentIndex, segment);
  }

  /**
   * [B11-C] Emit both chat.update (always) and chat.delta (when the new text
   * segment strictly extends the old content). `prev` is the segment that was
   * at `segmentIndex` BEFORE the mutation; undefined means the segment was
   * freshly appended. A brand-new text segment with non-empty content is also
   * treated as a delta from the empty string so the first token after a
   * segment boundary gets delivered via chat.delta too.
   */
  private emitSegment(
    messageId: string,
    segmentIndex: number,
    prev: ChatSegment | undefined,
    next: ChatSegment,
  ): void {
    this.emitUpdate(messageId, segmentIndex, next);
    if (next.kind !== "text") return;
    const prevText = prev && prev.kind === "text" ? prev.content : "";
    if (next.content.length > prevText.length && next.content.startsWith(prevText)) {
      const delta = next.content.slice(prevText.length);
      for (const l of this.deltaListeners) l(messageId, segmentIndex, delta);
    }
    // else: kind change or non-extending rewrite — onUpdate alone is the
    // safety net. chat.delta stays silent so the client applies the full
    // segment replacement via chat.update.
  }

  onDelta(
    l: (messageId: string, segmentIndex: number, textDelta: string) => void,
  ): () => void {
    this.deltaListeners.add(l);
    return () => {
      this.deltaListeners.delete(l);
    };
  }

  list(): ChatMessage[] {
    return [...this.messages];
  }

  onMessage(l: (m: ChatMessage) => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  onUpdate(
    l: (messageId: string, segmentIndex: number, segment: ChatSegment) => void,
  ): () => void {
    this.updateListeners.add(l);
    return () => {
      this.updateListeners.delete(l);
    };
  }

  reset(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.messages = [];
    this.pending = "";
    this.state = "IDLE";
    this.buf = null;
    this.activeMessageId = null;
    this.activeSegmentIndex = -1;
    this.lastOutputAt = 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.listeners.clear();
    this.updateListeners.clear();
    this.deltaListeners.clear();
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function bufToSegment(buf: OpenSegmentBuf): ChatSegment {
  const content = buf.content.slice(0, MAX_SEGMENT_LEN);
  switch (buf.kind) {
    case "code":
      return { kind: "code", lang: buf.lang, content: content.replace(/\n$/, "") };
    case "diff":
      return { kind: "diff", content };
    case "tool_use":
      return {
        kind: "tool_use",
        tool: buf.tool ?? "Unknown",
        input: buf.input ?? "",
        output: content || undefined,
        collapsed: true,
      };
    case "text":
    default:
      return { kind: "text", content: content.replace(/\n+$/, "") };
  }
}

function segmentIsEmpty(seg: ChatSegment): boolean {
  switch (seg.kind) {
    case "text":
    case "code":
    case "diff":
    case "thinking":
      return !seg.content.trim();
    case "tool_result":
      return !seg.content.trim();
    case "tool_use":
      return !seg.tool && !seg.input && !seg.output;
  }
}
