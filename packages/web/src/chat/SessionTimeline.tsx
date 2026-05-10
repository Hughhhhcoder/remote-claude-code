import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type { AuditEntry, ChatMessage } from "@rcc/protocol";
import type { RccClient } from "../client";

/**
 * SessionTimeline — read-only vertical timeline of events for one session.
 *
 * [B32-B] Opened from a clock icon in ChatHeader inside a Dialog bottom-sheet
 * on mobile. Merges two sources:
 *   1. Chat messages (already in memory via ChatSurface → ChatHeader props).
 *      Each message becomes one timeline node with role label + short preview.
 *      Assistant messages containing tool_use / tool_result segments expand
 *      into sub-nodes so tool calls are visible events in the timeline.
 *   2. Audit entries filtered by sid (details.sid === props.sid) — covers
 *      session.new / session.close / session.resume / session.fork / share.*
 *      / approval.* / config.session.* etc. Fetched via the existing
 *      `audit.query.request` → `audit.entries` round-trip (same pattern as
 *      BugReportModal). One-shot, 3s timeout, limit 500.
 *
 * All nodes sorted ascending by timestamp. Mobile-friendly: fills dialog,
 * vertical rail + dots, no horizontal scroll at 375px. Tokens semantic only.
 */

export interface SessionTimelineProps {
  client: RccClient;
  sid: string;
  /** Live chat messages for the active session (already in-memory). */
  messages: readonly ChatMessage[];
}

type NodeTone = "user" | "assistant" | "system" | "tool" | "audit";

interface TimelineNode {
  key: string;
  ts: number;
  tone: NodeTone;
  label: string;
  detail?: string;
  /** Raw kind for audit events — shown as monospace badge. */
  kind?: string;
}

const TONE_DOT: Record<NodeTone, string> = {
  user: "bg-accent",
  assistant: "bg-text-primary",
  system: "bg-text-muted",
  tool: "bg-warning",
  audit: "bg-success",
};

const TONE_LABEL: Record<NodeTone, string> = {
  user: "text-accent",
  assistant: "text-text-primary",
  system: "text-text-muted",
  tool: "text-warning",
  audit: "text-success",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function previewOf(m: ChatMessage): string {
  for (const seg of m.segments) {
    if (seg.kind === "text") return seg.content.trim().slice(0, 140);
    if (seg.kind === "thinking") return seg.content.trim().slice(0, 140);
    if (seg.kind === "code") return `[code] ${seg.content.trim().slice(0, 120)}`;
    if (seg.kind === "diff") return `[diff] ${(seg.path ?? "").slice(0, 80)}`;
  }
  return "";
}

function roleLabel(role: ChatMessage["role"]): string {
  if (role === "user") return "你";
  if (role === "assistant") return "助手";
  return "系统";
}

function auditLabel(kind: string): string {
  // Map common kinds to a short, human label. Unknown kinds fall back to the
  // raw kind string which is already reasonably readable.
  const table: Record<string, string> = {
    "session.new": "会话创建",
    "session.close": "会话关闭",
    "session.exited": "进程退出",
    "session.resume": "会话恢复",
    "session.fork": "会话分叉",
    "share.create": "创建分享",
    "share.revoke": "撤销分享",
    "approval.granted": "批准工具调用",
    "approval.denied": "拒绝工具调用",
    "config.session.update": "会话配置更新",
  };
  return table[kind] ?? kind;
}

function entryIsForSid(e: AuditEntry, sid: string): boolean {
  const d = e.details as Record<string, unknown> | undefined;
  if (!d) return false;
  return (
    d.sid === sid ||
    d.sourceSid === sid ||
    (typeof d.id === "string" && d.id === sid)
  );
}

export function SessionTimeline(props: SessionTimelineProps): JSX.Element {
  const [audit, setAudit] = createSignal<AuditEntry[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // One-shot audit fetch, same pattern as BugReportModal.
  onMount(() => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      unsub();
      setError("审计日志加载超时");
      setLoaded(true);
    }, 3000);
    const unsub = props.client.on((frame) => {
      if (frame.t !== "audit.entries") return;
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      unsub();
      setAudit(frame.entries);
      setLoaded(true);
    });
    props.client.send({
      v: 1,
      t: "audit.query.request",
      limit: 500,
    });
    onCleanup(() => {
      if (!done) {
        done = true;
        window.clearTimeout(timer);
        unsub();
      }
    });
  });

  const nodes = createMemo<TimelineNode[]>(() => {
    const out: TimelineNode[] = [];

    // Chat messages → one node per message, plus sub-nodes for tool_use.
    for (const m of props.messages) {
      const tone: NodeTone =
        m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "system";
      out.push({
        key: `m:${m.id}`,
        ts: m.timestamp,
        tone,
        label: roleLabel(m.role),
        detail: previewOf(m),
      });
      // Tool calls — expose as distinct events so the timeline reflects
      // "model called X" moments. Pair tool_result by toolUseId when present.
      for (const seg of m.segments) {
        if (seg.kind === "tool_use") {
          out.push({
            key: `t:${m.id}:${seg.tool}:${seg.toolUseId ?? "cli"}`,
            ts: m.timestamp + 1, // keep after parent message in stable sort
            tone: "tool",
            label: `工具调用 · ${seg.tool}`,
            detail: seg.input.slice(0, 140),
          });
        }
      }
    }

    // Audit entries filtered by sid.
    for (const e of audit()) {
      if (!entryIsForSid(e, props.sid)) continue;
      out.push({
        key: `a:${e.ts}:${e.kind}`,
        ts: e.ts,
        tone: "audit",
        label: auditLabel(e.kind),
        detail: e.deviceId ? `device: ${e.deviceId}` : undefined,
        kind: e.kind,
      });
    }

    out.sort((a, b) => a.ts - b.ts);
    return out;
  });

  return (
    <div class="flex flex-col gap-3 text-text-primary">
      <div class="text-[12px] text-text-muted">
        <Show when={loaded()} fallback={<span>加载审计日志…</span>}>
          <span>
            共 {nodes().length} 个事件
            <Show when={error()}>
              <span class="ml-2 text-danger">· {error()}</span>
            </Show>
          </span>
        </Show>
      </div>

      <Show
        when={nodes().length > 0}
        fallback={
          <div class="text-center text-text-muted text-sm py-10">
            <Show when={loaded()} fallback={<span>…</span>}>
              <span>暂无事件</span>
            </Show>
          </div>
        }
      >
        <ol
          class="relative pl-5 m-0 list-none"
          aria-label="会话时间线"
        >
          {/* Vertical rail — pulled inside safe-area so it lines up with dots. */}
          <div
            class="absolute left-[7px] top-1 bottom-1 w-px bg-border-subtle"
            aria-hidden="true"
          />
          <For each={nodes()}>
            {(n) => (
              <li class="relative pb-4 last:pb-0">
                <span
                  class={
                    "absolute left-[-18px] top-[6px] w-[11px] h-[11px] " +
                    "rounded-full ring-2 ring-bg-surface " +
                    TONE_DOT[n.tone]
                  }
                  aria-hidden="true"
                />
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span
                    class={
                      "text-[11px] font-mono text-text-muted shrink-0 " +
                      "tabular-nums"
                    }
                  >
                    {fmtTime(n.ts)}
                  </span>
                  <span
                    class={
                      "text-[13px] font-medium " + TONE_LABEL[n.tone]
                    }
                  >
                    {n.label}
                  </span>
                  <Show when={n.kind}>
                    <span class="text-[10px] font-mono text-text-muted border border-border-subtle rounded px-1 py-[1px]">
                      {n.kind}
                    </span>
                  </Show>
                </div>
                <Show when={n.detail}>
                  <div class="mt-0.5 text-[12px] text-text-secondary break-words whitespace-pre-wrap">
                    {n.detail}
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  );
}

export default SessionTimeline;
