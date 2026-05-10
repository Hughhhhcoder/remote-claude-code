// [B28-A] Chat export — pure serializers for ChatMessage[] → Markdown / JSON.
//
// No host/protocol changes: everything runs on client-side data already in
// memory. Consumed by the "导出对话" dropdown in ChatHeader.
//
// Markdown format:
//   # 对话 — {session.title ?? cwd ?? sid} · {sid}
//   ---
//   **User** · {ISO time}
//   {text...}
//
//   **Assistant** · {ISO time}
//   {text...}
//   ---
//
// - Text segments render as-is.
// - Code segments render as fenced blocks (```lang\n...\n```).
// - Diff segments render as ```diff blocks.
// - Thinking segments render as <details><summary>思考</summary>…</details>.
// - Tool use / tool result segments render as collapsed <details>.
//
// JSON format: raw ChatMessage[] + session meta, pretty-printed (2-space).
import type { ChatMessage, SessionMeta } from "@rcc/protocol";

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

/** `rcc-{sid-slice}-{YYYYMMDD}.{ext}`. `sid` may be empty → falls back to
 *  `session`. Date is local-time, to match what the user sees on disk. */
export function exportFilename(
  sid: string,
  ext: "md" | "json",
  now: Date = new Date(),
): string {
  const sidPart = (sid || "session").slice(0, 8) || "session";
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `rcc-${sidPart}-${y}${m}${d}.${ext}`;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function roleLabel(role: ChatMessage["role"]): string {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  return "System";
}

function tsToIso(ts: number): string {
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

/** Serialize a single message's segments into Markdown body. Pure. */
export function segmentsToMarkdown(msg: ChatMessage): string {
  const parts: string[] = [];
  for (const seg of msg.segments) {
    switch (seg.kind) {
      case "text":
        if (seg.content) parts.push(seg.content);
        break;
      case "code": {
        const lang = seg.lang ?? "";
        parts.push("```" + lang + "\n" + seg.content + "\n```");
        break;
      }
      case "diff":
        parts.push(
          "```diff" +
            (seg.path ? ` ${seg.path}` : "") +
            "\n" +
            seg.content +
            "\n```",
        );
        break;
      case "thinking":
        parts.push(
          "<details><summary>思考</summary>\n\n" + seg.content + "\n\n</details>",
        );
        break;
      case "tool_use": {
        const head = `工具调用: ${seg.tool}`;
        const body =
          "**Input**\n\n```\n" +
          seg.input +
          "\n```" +
          (seg.output ? "\n\n**Output**\n\n```\n" + seg.output + "\n```" : "");
        parts.push(`<details><summary>${head}</summary>\n\n${body}\n\n</details>`);
        break;
      }
      case "tool_result": {
        const head = seg.isError ? "工具结果 (错误)" : "工具结果";
        parts.push(
          `<details><summary>${head}</summary>\n\n\`\`\`\n${seg.content}\n\`\`\`\n\n</details>`,
        );
        break;
      }
    }
  }
  return parts.join("\n\n");
}

/** Build the full Markdown export. Pure. */
export function messagesToMarkdown(
  messages: readonly ChatMessage[],
  session: SessionMeta | undefined,
  sid: string,
): string {
  const title =
    session?.title || session?.cwd || sid || "会话";
  const header =
    `# 对话 — ${title} · ${sid || "(unknown)"}\n` +
    `\n` +
    `_导出于 ${new Date().toISOString()} · ${messages.length} 条消息_\n` +
    `\n` +
    `---\n`;

  const blocks: string[] = [header];
  for (const m of messages) {
    const label = roleLabel(m.role);
    const when = tsToIso(m.timestamp);
    const body = segmentsToMarkdown(m);
    blocks.push(`**${label}** · ${when}\n\n${body}\n\n---`);
  }
  return blocks.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export interface ChatExportJson {
  version: 1;
  exportedAt: string;
  sid: string;
  session:
    | {
        id: string;
        title?: string;
        cwd?: string;
        driver?: SessionMeta["driver"];
      }
    | null;
  messages: readonly ChatMessage[];
}

export function messagesToJson(
  messages: readonly ChatMessage[],
  session: SessionMeta | undefined,
  sid: string,
): string {
  const payload: ChatExportJson = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sid,
    session: session
      ? {
          id: session.id,
          title: session.title,
          cwd: session.cwd,
          driver: session.driver,
        }
      : null,
    messages,
  };
  return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// Download (browser-only; no-op in SSR/test envs without DOM)
// ---------------------------------------------------------------------------

/** Trigger a browser download via Blob + <a download>. Safe no-op if
 *  `document` is missing (SSR / unit tests without JSDOM). */
export function downloadBlob(
  content: string,
  filename: string,
  mime: string,
): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Some browsers require the <a> to be in the DOM for click() to fire.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser can actually start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportMarkdown(
  messages: readonly ChatMessage[],
  session: SessionMeta | undefined,
  sid: string,
): void {
  const md = messagesToMarkdown(messages, session, sid);
  downloadBlob(md, exportFilename(sid, "md"), "text/markdown;charset=utf-8");
}

export function exportJson(
  messages: readonly ChatMessage[],
  session: SessionMeta | undefined,
  sid: string,
): void {
  const json = messagesToJson(messages, session, sid);
  downloadBlob(
    json,
    exportFilename(sid, "json"),
    "application/json;charset=utf-8",
  );
}

/** Trigger browser print dialog. The `@media print` rules in index.css hide
 *  the sidebar, header chrome, and composer so only the ChatPane scroll
 *  region (already 760px / serif) prints. */
export function exportPrint(): void {
  if (typeof window === "undefined") return;
  // Toggle a marker class so print CSS can key off it if needed; most of the
  // print rules use `@media print` directly, but the class lets us scope
  // overrides to "user-initiated export" vs. an accidental Ctrl+P (same
  // result either way, since the media query still matches).
  document.documentElement.classList.add("rcc-print-mode");
  try {
    window.print();
  } finally {
    // Clean up on the next tick — Safari fires beforeprint sync, afterprint
    // async, so removing immediately is fine for Chrome/Firefox.
    setTimeout(() => {
      document.documentElement.classList.remove("rcc-print-mode");
    }, 0);
  }
}
