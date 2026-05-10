import { Show, createMemo, createSignal, For, type JSX } from "solid-js";
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
  /** [B23-B] Optional — when omitted the pin/archive/tag menu is hidden. */
  onSetMeta?: (patch: { pinned?: boolean; archived?: boolean; tags?: string[] }) => void;
  /**
   * [B23-C] Optional — when omitted the inline-rename UI is hidden. Called
   * with the trimmed title, or `null` to clear any custom title and fall
   * back to the cwd-display / auto-title.
   */
  onRename?: (title: string | null) => void;
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
  const isExited = createMemo(() => props.session.status === "exited");
  const isRemote = createMemo(() => !!props.session.peerId);
  const isPinned = createMemo(() => !!props.session.pinned);
  const tags = createMemo(() => props.session.tags ?? []);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const displayTitle = createMemo(
    () =>
      props.session.summary?.title ??
      props.session.title ??
      props.session.id,
  );
  // Tooltip text — bullets.map().join() is O(n) string work; only re-run
  // when summary/bullets change, not on every parent tick.
  const titleTooltip = createMemo(() =>
    props.session.summary
      ? props.session.summary.bullets.map((b) => `• ${b}`).join("\n")
      : displayTitle(),
  );
  // [B23-C] Inline rename state. `editing` flips the title row into an
  // <input>; `draft` tracks the in-progress text. Commit on Enter / blur,
  // cancel on Esc. Host broadcast of `session.list` will overwrite the
  // optimistic title if it was rejected.
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  function startRename(): void {
    if (!props.onRename) return;
    setMenuOpen(false);
    setDraft(displayTitle());
    setEditing(true);
  }

  function commitRename(): void {
    if (!editing()) return;
    setEditing(false);
    if (!props.onRename) return;
    const raw = draft().trim();
    // Empty string clears the custom title so sidebar falls back to cwd /
    // auto-title. A string matching the current display is a no-op.
    const next = raw.length === 0 ? null : raw.slice(0, 200);
    if (next !== null && next === displayTitle()) return;
    props.onRename(next);
  }

  function cancelRename(): void {
    setEditing(false);
  }

  function onPromptTags(e: Event) {
    e.stopPropagation();
    setMenuOpen(false);
    if (!props.onSetMeta) return;
    const current = tags().join(", ");
    const next = window.prompt("标签（英文逗号分隔）", current);
    if (next === null) return;
    const list = next
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 16);
    props.onSetMeta({ tags: list });
  }

  function togglePinned(e: Event) {
    e.stopPropagation();
    setMenuOpen(false);
    props.onSetMeta?.({ pinned: !isPinned() });
  }

  function toggleArchived(e: Event) {
    e.stopPropagation();
    setMenuOpen(false);
    props.onSetMeta?.({ archived: !props.session.archived });
  }

  return (
    <div
      class={[
        "group relative flex items-stretch rounded-md mb-1 cursor-pointer",
        "transition-colors duration-fast ease-rcc",
        "min-h-[44px]",
        props.active
          ? "bg-accent-bg"
          : "hover:bg-bg-surfaceStrong",
        isPinned() ? "ring-1 ring-accent/30" : "",
      ].join(" ")}
      onClick={props.onActivate}
      onContextMenu={(e) => {
        if (!props.onSetMeta) return;
        e.preventDefault();
        setMenuOpen((v) => !v);
      }}
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
          <Show
            when={editing()}
            fallback={
              <div
                class={[
                  "font-serif text-[14px] leading-tight truncate",
                  isExited()
                    ? "text-text-muted"
                    : props.active
                      ? "text-text-primary"
                      : "text-text-primary/90",
                ].join(" ")}
                title={titleTooltip()}
                onDblClick={(e) => {
                  if (!props.onRename) return;
                  e.stopPropagation();
                  startRename();
                }}
              >
                <Show when={isPinned()}>
                  <span class="text-accent mr-1" aria-label="置顶" title="已置顶">
                    ★
                  </span>
                </Show>
                {displayTitle()}
              </div>
            }
          >
            {/* [B23-C] Inline rename input. Autofocus + select so touch users
                can immediately start typing. Blur commits, Enter commits,
                Escape cancels (rolls back to the displayed title). */}
            <input
              type="text"
              class={[
                "w-full font-serif text-[14px] leading-tight",
                "bg-bg-surface rounded-sm px-1 py-0.5",
                "border border-accent/40 outline-none",
                "focus:ring-2 focus:ring-accent/40",
              ].join(" ")}
              value={draft()}
              maxlength={200}
              autofocus
              onClick={(e) => e.stopPropagation()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              aria-label="重命名会话"
            />
          </Show>
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
            <Show when={props.session.archived}>
              <Chip tone="neutral" size="xs">
                归档
              </Chip>
            </Show>
            <For each={tags()}>
              {(tag) => (
                <Chip tone="accent" size="xs">
                  {tag}
                </Chip>
              )}
            </For>
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
          <Show when={props.onSetMeta}>
            <button
              type="button"
              class={[
                "inline-flex items-center justify-center w-8 h-8 rounded-sm",
                "font-sans text-[14px] leading-none text-text-muted",
                "hover:text-accent hover:bg-accent-bg",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              ].join(" ")}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="更多"
              aria-label="更多操作"
              aria-expanded={menuOpen()}
            >
              <span aria-hidden="true">⋯</span>
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
      {/* [B23-B] Contextual menu — pin / archive / tag. Rename placeholder is
          owned by B23-C. Shown as a small floating panel that overlays the
          right edge of the row. */}
      <Show when={menuOpen() && props.onSetMeta}>
        <div
          class={[
            "absolute right-2 top-full z-10 mt-0.5 min-w-[140px]",
            "rounded-md border border-border-subtle bg-bg-surface shadow-md",
            "py-1 font-sans text-[12px] text-text-primary",
          ].join(" ")}
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            class="w-full text-left px-3 py-1.5 hover:bg-bg-surfaceStrong"
            onClick={togglePinned}
            role="menuitem"
          >
            {isPinned() ? "取消置顶" : "置顶"}
          </button>
          <button
            type="button"
            class="w-full text-left px-3 py-1.5 hover:bg-bg-surfaceStrong"
            onClick={toggleArchived}
            role="menuitem"
          >
            {props.session.archived ? "取消归档" : "归档"}
          </button>
          <button
            type="button"
            class="w-full text-left px-3 py-1.5 hover:bg-bg-surfaceStrong"
            onClick={onPromptTags}
            role="menuitem"
          >
            添加标签
          </button>
          <Show when={props.onRename}>
            <button
              type="button"
              class="w-full text-left px-3 py-1.5 hover:bg-bg-surfaceStrong"
              onClick={(e) => {
                e.stopPropagation();
                startRename();
              }}
              role="menuitem"
            >
              重命名
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default SessionRow;
