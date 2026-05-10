import { Show, createSignal, type JSX } from "solid-js";
import type { ChatMessage, GitStatusData, SessionMeta } from "@rcc/protocol";
import type { RccClient } from "../client";
import { IconButton } from "../primitives/IconButton";
import { Popover } from "../primitives/Popover";
import { Dialog } from "../primitives/Dialog";
import {
  PermissionChip,
  DriverChip,
  UsageChip,
  BranchChip,
} from "../MainPane.tsx";
import {
  exportJson,
  exportMarkdown,
  exportPrint,
} from "./exportChat";
import { SessionTimeline } from "./SessionTimeline";

/**
 * ChatHeader — top chrome for the chat surface.
 *
 * Extracted in Phase 4-A from the inline `SessionHeader` inside `MainPane.tsx`.
 * Owns: title, sid slice, permission/driver/usage/branch chips, view-mode
 * toggle, notebook toggle, share action, and size readout.
 *
 * Responsive rules (hard gate @ 375px):
 *   - mobile (< sm / 640px): show title + permission chip + share + notebook.
 *     Hide sid slice, UsageChip, BranchChip, cols×rows, view-mode toggle.
 *   - sm+ (>= 640px): show everything.
 *   - Height: 56px on mobile, 48px on desktop (`h-14 sm:h-12`).
 *
 * [B28-A] Export dropdown: Markdown / JSON / Print-to-PDF. Messages and
 * session meta flow in via props (wired from ChatSurface); the dropdown
 * lives in a Popover anchored to the "↓" IconButton.
 */

export interface ChatHeaderProps {
  session: SessionMeta | undefined;
  /** Optional git status for the BranchChip. */
  gitStatus?: GitStatusData | null;
  viewMode?: "chat" | "terminal";
  onToggleViewMode?: () => void;
  onShare?: () => void;
  onToggleNotebook?: () => void;
  notebookActive?: boolean;
  /** [B28-A] Messages for export. When undefined/empty the export button
   *  still appears (users may want an empty skeleton) but Markdown/JSON
   *  writes a header-only file. */
  messages?: readonly ChatMessage[];
  sid?: string;
  /** [B32-B] Required for the timeline button; when absent the button hides. */
  client?: RccClient;
}

export function ChatHeader(props: ChatHeaderProps): JSX.Element {
  const sid = () => props.sid ?? props.session?.id ?? "";
  const title = () => props.session?.title ?? sid();
  const sidSlice = () => {
    const s = sid();
    return s.length > 8 ? s.slice(0, 8) : s;
  };
  const canToggleView = () =>
    !!props.onToggleViewMode && props.session?.driver !== "sdk";

  // [B28-A] Export menu state + anchor ref.
  const [exportOpen, setExportOpen] = createSignal(false);
  let exportBtnRef: HTMLButtonElement | undefined;

  // [B32-B] Session timeline dialog state.
  const [timelineOpen, setTimelineOpen] = createSignal(false);

  function runExport(kind: "md" | "json" | "print"): void {
    const msgs = props.messages ?? [];
    const s = sid();
    setExportOpen(false);
    if (kind === "md") exportMarkdown(msgs, props.session, s);
    else if (kind === "json") exportJson(msgs, props.session, s);
    else exportPrint();
  }

  return (
    <header
      class={
        "h-14 sm:h-12 shrink-0 border-b border-border-subtle bg-bg-page " +
        "px-3 sm:px-5 flex items-center gap-2 sm:gap-3 rcc-chat-header"
      }
    >
      {/* Left cluster: title + chips. `min-w-0` enables truncation. */}
      <div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <h2
          class="font-serif text-[15px] text-text-primary truncate m-0 font-medium"
          aria-label={`Session: ${title()}`}
          title={title()}
        >
          {title()}
        </h2>

        {/* sid slice — hidden on mobile to keep chrome minimal. */}
        <Show when={sid()}>
          <span
            class="hidden sm:inline-flex font-mono text-[11px] text-text-muted shrink-0"
            aria-hidden="true"
          >
            {sidSlice()}
          </span>
        </Show>

        <Show when={props.session}>
          <PermissionChip mode={props.session!.permissionMode} />
          {/* Driver/Usage/Branch chips: desktop only. */}
          <span class="hidden sm:inline-flex">
            <DriverChip driver={props.session!.driver ?? "cli"} />
          </span>
          <Show when={props.session!.usage}>
            <span class="hidden sm:inline-flex">
              <UsageChip usage={props.session!.usage!} />
            </span>
          </Show>
          <Show when={props.gitStatus}>
            <span class="hidden sm:inline-flex">
              <BranchChip status={props.gitStatus!} />
            </span>
          </Show>
        </Show>
      </div>

      {/* Right cluster: actions + size readout. */}
      <div class="flex items-center gap-1.5 shrink-0">
        <Show when={canToggleView()}>
          <button
            onClick={() => props.onToggleViewMode?.()}
            class={
              "hidden sm:inline-flex items-center text-[11px] px-2 py-1 rounded-md " +
              "border border-border-subtle text-text-secondary " +
              "hover:text-text-primary hover:border-border-strong " +
              "transition duration-fast"
            }
            title="Toggle chat / terminal view"
            aria-label="Toggle chat or terminal view"
          >
            {props.viewMode === "chat" ? "Terminal" : "Chat"}
          </button>
        </Show>

        <Show when={props.onToggleNotebook}>
          <IconButton
            size="sm"
            tone={props.notebookActive ? "accent" : "default"}
            aria-label="Toggle notebook"
            aria-pressed={props.notebookActive ? "true" : "false"}
            title="Toggle collaborative notebook"
            onClick={() => props.onToggleNotebook?.()}
          >
            <span aria-hidden="true">📓</span>
          </IconButton>
        </Show>

        {/* [B32-B] Session timeline — opens a Dialog bottom-sheet on mobile
            showing messages + sid-scoped audit events in time order. Hidden
            when no client wire is available (e.g. isolated tests). */}
        <Show when={props.client}>
          <IconButton
            size="sm"
            aria-label="会话时间线"
            title="会话时间线"
            onClick={() => setTimelineOpen(true)}
          >
            <span aria-hidden="true">🕐</span>
          </IconButton>
        </Show>

        {/* [B28-A] Export dropdown — always available so users can export
            empty sessions too (useful for templating). */}
        <IconButton
          size="sm"
          ref={(el) => (exportBtnRef = el)}
          aria-label="导出对话"
          title="导出对话"
          aria-haspopup="menu"
          aria-expanded={exportOpen() ? "true" : "false"}
          onClick={() => setExportOpen((v) => !v)}
        >
          <span aria-hidden="true">↓</span>
        </IconButton>

        <Show when={props.onShare}>
          <IconButton
            size="sm"
            aria-label="Share session"
            title="Share session"
            onClick={() => props.onShare?.()}
          >
            <span aria-hidden="true">↗</span>
          </IconButton>
        </Show>

        {/* cols × rows — desktop only (no room at 375). */}
        <Show when={props.session?.cols && props.session?.rows}>
          <span
            class="hidden sm:inline-flex font-mono text-[11px] text-text-muted ml-1"
            aria-hidden="true"
          >
            {props.session!.cols}×{props.session!.rows}
          </span>
        </Show>
      </div>

      {/* Export popover lives outside the right cluster so its Portal render
          isn't a layout descendant, but logically it's anchored to the btn. */}
      <Popover
        open={exportOpen()}
        onClose={() => setExportOpen(false)}
        anchor={() => exportBtnRef}
        placement="bottom-end"
        class="min-w-[180px] py-1"
      >
        <div role="menu" aria-label="导出对话">
          <ExportMenuItem
            label="Markdown (.md)"
            hint="可读格式，保留代码块"
            onSelect={() => runExport("md")}
          />
          <ExportMenuItem
            label="JSON (.json)"
            hint="原始结构化数据"
            onSelect={() => runExport("json")}
          />
          <ExportMenuItem
            label="打印 / PDF"
            hint="使用系统打印对话框"
            onSelect={() => runExport("print")}
          />
        </div>
      </Popover>

      {/* [B32-B] Timeline dialog — mounted unconditionally in the tree; Dialog
          short-circuits when `open` is false so there's no cost when closed. */}
      <Show when={props.client}>
        <Dialog
          open={timelineOpen()}
          onClose={() => setTimelineOpen(false)}
          title="会话时间线"
          size="md"
        >
          <SessionTimeline
            client={props.client!}
            sid={sid()}
            messages={props.messages ?? []}
          />
        </Dialog>
      </Show>
    </header>
  );
}

function ExportMenuItem(props: {
  label: string;
  hint: string;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      class={
        "w-full text-left px-3 py-2 text-[13px] " +
        "text-text-primary hover:bg-bg-subtle " +
        "focus:bg-bg-subtle focus:outline-none " +
        "transition-colors duration-fast"
      }
      onClick={() => props.onSelect()}
    >
      <div class="font-medium">{props.label}</div>
      <div class="text-[11px] text-text-muted mt-0.5">{props.hint}</div>
    </button>
  );
}

export default ChatHeader;
