import { randomUUID } from "node:crypto";
import type { ApprovalRisk, Frame, PermissionMode } from "@rcc/protocol";
import type { Session } from "./session.ts";

/**
 * Claude Code CLI does not expose a structured permission-approval API — it
 * simply prompts on stdin with text like `Do you want to proceed? (y/n)`.
 * This watcher inspects each session's raw pty.out, detects such prompts via
 * conservative regexes, classifies the (guessed) tool into low/medium/high
 * risk, and surfaces a structured `approval.request` frame so clients can
 * show a dedicated UI. The user's response is echoed back as `y\r` / `n\r`.
 *
 * Important: this is heuristic — it may miss prompts with unexpected wording,
 * or (less commonly) fire on false positives. The terminal remains the source
 * of truth; users can always answer in xterm directly.
 */

const BUFFER_MAX = 512 * 1024;
const TAIL_WINDOW = 4096; // bytes inspected on each feed() for the trigger
const RAW_MAX = 4096; // raw prompt truncation before broadcast
const TIMEOUT_MS = 30_000;
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const CR_RE = /\r(?!\n)/g;

const TRIGGER_RE =
  /\b(?:do you want to (?:proceed|continue|allow)|allow this (?:tool|action)|approve this (?:tool|action))\b|(?:\[\s*y\s*\/\s*n\s*\]|\(\s*y(?:es)?\s*\/\s*n(?:o)?\s*\)|\(\s*Y\s*\/\s*n\s*\))/i;
const TOOL_RE =
  /\b(Bash|Read|LS|Glob|Grep|Edit|MultiEdit|Write|NotebookEdit|WebFetch|WebSearch|Task|Agent)\b/;

const LOW_TOOLS = new Set(["Read", "LS", "Glob", "Grep"]);
const MEDIUM_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const HIGH_TOOLS = new Set(["Bash", "WebFetch", "WebSearch"]);

function classifyRisk(tool: string): ApprovalRisk {
  if (LOW_TOOLS.has(tool)) return "low";
  if (HIGH_TOOLS.has(tool)) return "high";
  if (MEDIUM_TOOLS.has(tool)) return "medium";
  return "medium";
}

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "").replace(CR_RE, "\n");
}

function skipForMode(mode: PermissionMode): boolean {
  return mode === "bypassPermissions" || mode === "acceptEdits" || mode === "dontAsk";
}

interface Pending {
  id: string;
  tool: string;
  timeout: ReturnType<typeof setTimeout>;
}

export type Broadcaster = (frame: Frame) => void;

export class ApprovalWatcher {
  private buffer = "";
  private pending: Pending | null = null;
  private lastTriggerIdx = -1;
  private disposed = false;

  constructor(
    private readonly session: Session,
    private readonly broadcast: Broadcaster,
  ) {}

  feed(data: string): void {
    if (this.disposed) return;
    if (skipForMode(this.session.permissionMode)) return;
    // Don't re-trigger while one is outstanding — user hasn't answered yet,
    // further output is unlikely to represent a new prompt.
    if (this.pending) {
      this.appendBuffer(data);
      return;
    }
    this.appendBuffer(data);

    // Only scan the tail of the buffer for the trigger so we don't re-match
    // historic output after clearing a prompt.
    const scanFrom = Math.max(this.lastTriggerIdx + 1, this.buffer.length - TAIL_WINDOW);
    const clean = stripAnsi(this.buffer.slice(scanFrom));
    const m = clean.match(TRIGGER_RE);
    if (!m || m.index === undefined) return;

    // Map clean-index back to approximate raw position so we don't match the
    // same prompt twice. We just move the cursor to the end of the current
    // buffer; if the next prompt appears, it'll be past this point.
    this.lastTriggerIdx = this.buffer.length - 1;

    // Tool inference: look ~400 chars back from the trigger in the cleaned tail.
    const back = clean.slice(Math.max(0, m.index - 400), m.index + 120);
    const toolMatch = back.match(TOOL_RE);
    const tool = toolMatch?.[1] ?? "Unknown";
    const risk = classifyRisk(tool);

    // Summary: first non-empty line near the trigger, trimmed.
    const window = clean.slice(Math.max(0, m.index - 200), m.index + 200);
    const summary =
      window
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(-3)
        .join(" · ")
        .slice(0, 240) || "待审批操作";

    const rawWindow = this.buffer.slice(Math.max(0, this.buffer.length - TAIL_WINDOW));
    const raw = rawWindow.length > RAW_MAX ? rawWindow.slice(-RAW_MAX) : rawWindow;

    const id = randomUUID();
    const timeout = setTimeout(() => this.timeout(id), TIMEOUT_MS);
    this.pending = { id, tool, timeout };

    this.broadcast({
      v: 1,
      t: "approval.request",
      id,
      sid: this.session.id,
      tool,
      risk,
      summary,
      raw,
      timestamp: Date.now(),
    });
  }

  /** Client answered; write y/n to the pty and clear state. */
  resolve(id: string, approve: boolean): boolean {
    if (!this.pending || this.pending.id !== id) return false;
    clearTimeout(this.pending.timeout);
    const answer = approve ? "y\r" : "n\r";
    try {
      this.session.write(answer);
    } catch {
      // pty might have exited; fall through to cleared broadcast anyway
    }
    const clearedId = this.pending.id;
    this.pending = null;
    this.broadcast({ v: 1, t: "approval.cleared", id: clearedId, sid: this.session.id });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending = null;
    }
    this.buffer = "";
  }

  private timeout(id: string): void {
    if (!this.pending || this.pending.id !== id) return;
    const clearedId = this.pending.id;
    this.pending = null;
    this.broadcast({ v: 1, t: "approval.cleared", id: clearedId, sid: this.session.id });
  }

  private appendBuffer(data: string): void {
    this.buffer += data;
    if (this.buffer.length > BUFFER_MAX) {
      const drop = this.buffer.length - BUFFER_MAX;
      this.buffer = this.buffer.slice(drop);
      if (this.lastTriggerIdx >= 0) this.lastTriggerIdx = Math.max(-1, this.lastTriggerIdx - drop);
    }
  }
}
