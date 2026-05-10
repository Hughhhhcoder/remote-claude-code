import { Show, type JSX } from "solid-js";
import type { GitStatusData, SessionMeta } from "@rcc/protocol";
import { IconButton } from "../primitives/IconButton";
import {
  PermissionChip,
  DriverChip,
  UsageChip,
  BranchChip,
} from "../MainPane.tsx";

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
}

export function ChatHeader(props: ChatHeaderProps): JSX.Element {
  const sid = () => props.session?.id ?? "";
  const title = () => props.session?.title ?? sid();
  const sidSlice = () => {
    const s = sid();
    return s.length > 8 ? s.slice(0, 8) : s;
  };
  const canToggleView = () =>
    !!props.onToggleViewMode && props.session?.driver !== "sdk";

  return (
    <header
      class={
        "h-14 sm:h-12 shrink-0 border-b border-border-subtle bg-bg-page " +
        "px-3 sm:px-5 flex items-center gap-2 sm:gap-3"
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
    </header>
  );
}

export default ChatHeader;
