import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatSegment } from "@rcc/protocol";

// Strip common ANSI/VT control sequences: CSI, OSC, plus bare ESC letters.
const ANSI_CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_SIMPLE = /\x1b[()][A-Za-z0-9]|\x1b[=>NOM78c]/g;

const MAX_MESSAGES = 100;
const MAX_SEGMENT_LEN = 256 * 1024;
const PENDING_HARD_CAP = 512 * 1024;

function stripAnsi(s: string): string {
  return s.replace(ANSI_CSI, "").replace(ANSI_OSC, "").replace(ANSI_SIMPLE, "");
}

/**
 * Heuristic parser that watches a session's raw pty.out stream and coughs up
 * coarse-grained assistant messages. It is intentionally dumb: the Claude CLI
 * does not expose a structured event stream, so the best we can do without
 * re-authoring the CLI is to strip ANSI, split on paragraph boundaries, and
 * classify each paragraph. Known limitations:
 *   - Rapid sequential prints from different logical messages can merge.
 *   - Cursor-relative redraws produce garbled fragments.
 *   - Tool output inference relies on CLI prefix glyphs (●/⏺) which may drift.
 *   - Diff detection is ratio-based (>40% of lines starting with +/-).
 * A structured stream via the Agent SDK is planned for M5; until then a raw
 * terminal view must remain available as a fallback.
 */
export class ChatParser {
  private messages: ChatMessage[] = [];
  private pending = "";
  private readonly listeners = new Set<(m: ChatMessage) => void>();

  constructor(private readonly sid: string) {}

  feedOutput(bytes: string): void {
    this.pending += stripAnsi(bytes);
    if (this.pending.length > PENDING_HARD_CAP) {
      this.pending = this.pending.slice(-PENDING_HARD_CAP / 2);
    }
    // Flush on the most recent double-newline — everything before is
    // considered a completed paragraph; the tail after stays pending.
    const idx = this.pending.lastIndexOf("\n\n");
    if (idx < 0) return;
    const chunk = this.pending.slice(0, idx).trim();
    this.pending = this.pending.slice(idx + 2);
    if (!chunk) return;
    this.push({
      id: randomUUID(),
      sid: this.sid,
      role: "assistant",
      segments: [classify(chunk)],
      timestamp: Date.now(),
    });
  }

  feedInput(text: string): void {
    const clean = text.replace(/\r$/, "").trim();
    if (!clean) return;
    this.push({
      id: randomUUID(),
      sid: this.sid,
      role: "user",
      segments: [{ kind: "text", content: clean.slice(0, MAX_SEGMENT_LEN) }],
      timestamp: Date.now(),
    });
  }

  private push(m: ChatMessage): void {
    this.messages.push(m);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    for (const l of this.listeners) l(m);
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

  reset(): void {
    this.messages = [];
    this.pending = "";
  }
}

function classify(chunk: string): ChatSegment {
  const truncated = chunk.slice(0, MAX_SEGMENT_LEN);
  // Claude CLI tool-use prefix glyphs (●/⏺) followed by `ToolName(args)`.
  const toolMatch = truncated.match(/^[●⏺]\s+(\w+)\((.*)\)/m);
  if (toolMatch) {
    return {
      kind: "tool_use",
      tool: toolMatch[1] ?? "Unknown",
      input: toolMatch[2] ?? "",
      output: truncated,
      collapsed: true,
    };
  }
  // Box-drawing framing (panels/prompts).
  if (/^[╭│╰]/m.test(truncated)) {
    return {
      kind: "tool_use",
      tool: "Panel",
      input: "",
      output: truncated,
      collapsed: true,
    };
  }
  // Unified-diff-ish ratio.
  const lines = truncated.split("\n");
  const diffLines = lines.filter((l) => /^[+-]/.test(l)).length;
  if (lines.length > 4 && diffLines / lines.length > 0.4) {
    return { kind: "diff", content: truncated };
  }
  // Fenced code block (best-effort first fence only).
  const codeMatch = truncated.match(/^```(\w+)?\n([\s\S]*?)\n```/);
  if (codeMatch) {
    return { kind: "code", lang: codeMatch[1], content: codeMatch[2] ?? "" };
  }
  return { kind: "text", content: truncated };
}
