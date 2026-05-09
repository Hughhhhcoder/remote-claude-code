import { Show, type JSX } from "solid-js";
import type { SessionMeta, GitStatusData } from "@rcc/protocol";
import { Chip } from "../primitives/Chip.tsx";

/**
 * SessionRow — single session card in the sidebar.
 *
 * Visual spec (locked 2026-05-09):
 *   - min-h 44px (touch target). Active: 2px left accent bar + bg-accent-bg
 *     tint + text-text-primary. Inactive: hover bg-bg-surfaceStrong.
 *   - Title: font-serif 14px (content-adjacent, not pure chrome).
 *   - Meta line: font-sans 11px text-text-muted with cwd truncated and
 *     optional branch chip. Git branch: font-mono 11px, leading "●" dot
 *     when dirty.
 *   - Status chip: running (success dot) / exited (neutral).
 *   - Remote (peerId set): subtle tinted left edge via peerColor hint.
 *   - Exited sessions: dimmed title + always-visible "恢复" button.
 *   - Hover actions: share / close (desktop). On mobile always visible.
 *
 * Callbacks are passed via props; no protocol frames are sent from here.
 */

export interface SessionRowProps {
  session: SessionMeta;
  active: boolean;
  git: GitStatusData | null | undefined;
  onActivate: () => void;
  onClose: () => void;
  onResume: () => void;
  onShare: () => void;
}

const REMOTE_TINT: Record<string, string> = {
  violet: "bg-violet-400/40",
  teal: "bg-teal-400/40",
  orange: "bg-orange-400/40",
  pink: "bg-pink-400/40",
  cyan: "bg-cyan-400/40",
};

function remoteTint(color: string | undefined): string {
  return REMOTE_TINT[color ?? "violet"] ?? REMOTE_TINT.violet;
}

export function SessionRow(props: SessionRowProps): JSX.Element {
  const isExited = () => props.session.status === "exited";
  const isRemote = () => !!props.session.peerId;
  const displayTitle = () =>
    props.session.summary?.title ??
    props.session.title ??
    props.session.id;

  return (
    <div
      class={[
        "group relative flex items-stretch rounded-md mb-1 cursor-pointer",
        "transition-colors duration-fast ease-rcc",
        "min-h-[44px]",
        props.active
          ? "bg-accent-bg"
          : "hover:bg-bg-surfaceStrong",
      ].join(" ")}
      onClick={props.onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onActivate();
        }
      }}
      aria-current={props.active ? "true" : undefined}
    >
      {/* Left accent bar — active OR remote-tint when inactive. */}
      <span
        aria-hidden="true"
        class={[
          "shrink-0 w-[2px] rounded-l-md",
          props.active
            ? "bg-accent"
            : isRemote()
              ? remoteTint(props.session.peerColor)
              : "bg-transparent",
        ].join(" ")}
      />

      <div class="flex-1 min-w-0 flex items-start gap-2 py-2 pl-2 pr-1.5">
        {/* status dot */}
        <span
          class={[
            "w-1.5 h-1.5 rounded-full mt-[7px] shrink-0",
            props.session.status === "running"
              ? "bg-success"
              : "bg-text-muted/60",
          ].join(" ")}
          aria-hidden="true"
        />

        <div class="min-w-0 flex-1">
          <div
            class={[
              "font-serif text-[14px] leading-tight truncate",
              isExited()
                ? "text-text-muted"
                : props.active
                  ? "text-text-primary"
                  : "text-text-primary/90",
            ].join(" ")}
            title={
              props.session.summary
                ? props.session.summary.bullets.map((b) => `• ${b}`).join("\n")
                : displayTitle()
            }
          >
            {displayTitle()}
          </div>
          <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span class="font-sans text-[11px] text-text-muted truncate max-w-[180px]">
              {props.session.cwd}
            </span>
            <Show when={props.git}>
              <span
                class="font-mono text-[11px] text-text-secondary inline-flex items-center gap-0.5"
                title={
                  props.git!.dirty
                    ? "有未提交更改"
                    : props.git!.branch ?? ""
                }
              >
                <Show when={props.git!.dirty}>
                  <span class="text-warn" aria-hidden="true">
                    ●
                  </span>
                </Show>
                {props.git!.branch ?? ""}
              </span>
            </Show>
            <Show when={isExited()}>
              <Chip tone="neutral" size="xs">
                已退出
              </Chip>
            </Show>
          </div>
        </div>

        {/* trailing actions */}
        <div
          class={[
            "shrink-0 flex items-center gap-0.5",
            // always visible on touch (<md); reveal on hover for desktop.
            "md:opacity-0 md:group-hover:opacity-100",
            "transition-opacity duration-fast ease-rcc",
          ].join(" ")}
        >
          <Show when={isExited()}>
            <button
              type="button"
              class={[
                "inline-flex items-center justify-center h-8 px-2 rounded-sm",
                "font-sans text-[11px] font-medium",
                "text-success border border-success/40 hover:bg-success/10",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              ].join(" ")}
              onClick={(e) => {
                e.stopPropagation();
                props.onResume();
              }}
              title="恢复会话"
            >
              恢复
            </button>
          </Show>
          <button
            type="button"
            class={[
              "inline-flex items-center justify-center w-8 h-8 rounded-sm",
              "font-sans text-[12px] text-text-muted",
              "hover:text-accent hover:bg-accent-bg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            ].join(" ")}
            onClick={(e) => {
              e.stopPropagation();
              props.onShare();
            }}
            title="分享"
            aria-label="分享会话"
          >
            {/* share glyph — textual fallback per "no emoji-only" rule */}
            <span aria-hidden="true">↗</span>
          </button>
          <button
            type="button"
            class={[
              "inline-flex items-center justify-center w-8 h-8 rounded-sm",
              "font-sans text-[14px] leading-none text-text-muted",
              "hover:text-danger hover:bg-danger/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            ].join(" ")}
            onClick={(e) => {
              e.stopPropagation();
              props.onClose();
            }}
            title="关闭会话"
            aria-label="关闭会话"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default SessionRow;
