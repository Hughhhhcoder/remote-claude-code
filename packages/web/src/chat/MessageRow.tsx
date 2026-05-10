import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import type { ChatMessage, ChatSegment } from "@rcc/protocol";
import { IconButton } from "../primitives/IconButton";
import { TextBlock } from "./blocks/TextBlock";
import { CodeBlock } from "./blocks/CodeBlock";
import { MessageActionSheet, type MessageAction } from "./MessageActionSheet";

/**
 * MessageRow — per-message renderer for the Claude-style chat (P4-C).
 *
 * Layout rules (FEATURES.md):
 *  - user    : right-aligned rounded bubble, bg-userBubble, max-w 80% / 88% mobile.
 *  - assistant: full-width, no bubble, serif prose, 24px left gutter with
 *               a terra-cotta diamond avatar on the first row of a "turn".
 *  - system  : muted, italic, centered, small.
 *
 * Segments: text/code delegate to TextBlock/CodeBlock (P4-D). Other kinds
 * (diff, tool_use, tool_result, thinking) render a tagged placeholder that
 * batch 5 (P4-E/F/G) will replace.
 *
 * [B26-A] Hover/action menu (sm+): Copy · Copy as markdown · Quote · Pin ·
 * Share link · Fork · Regenerate(disabled). Mobile (<640px) surfaces the
 * same actions via long-press → MessageActionSheet bottom sheet.
 */

export interface MessageRowProps {
  msg: ChatMessage;
  /** Pin message to notebook (existing). */
  onPin?: (messageId: string) => void;
  /** [B23-A] Fork a new session from this message (copies messages up to and
   *  including this one into the new session's chat buffer). */
  onFork?: (messageId: string) => void;
  /** Suppress avatar/timestamp when this message continues a prior turn. */
  isFollowup?: boolean;
  /** Last message — reserved for streaming cursor placement hints. */
  isLast?: boolean;
}

// --- helpers ---------------------------------------------------------------

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mo}月${dd}日 ${hh}:${mm}`;
}

/**
 * Concatenate segments to plain text. Code fences use backticks so the result
 * round-trips through Markdown renderers.
 */
function concatText(segments: ChatSegment[]): string {
  return segments
    .map((s) => {
      if (s.kind === "text") return s.content;
      if (s.kind === "code") {
        const fence = "```";
        return `${fence}${s.lang ?? ""}\n${s.content}\n${fence}`;
      }
      if (s.kind === "diff") {
        const fence = "```";
        return `${fence}diff\n${s.content}\n${fence}`;
      }
      if (s.kind === "thinking") {
        // Preserve thinking as a blockquote comment for markdown fidelity.
        return s.content
          .split("\n")
          .map((ln) => `> ${ln}`)
          .join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Build the markdown-formatted copy string. Identical to `concatText` today
 * since segment boundaries already produce valid markdown, but kept as a
 * distinct function so future segment kinds (tool_use/tool_result) can be
 * rendered differently for plain-copy vs. markdown-copy.
 */
function concatMarkdown(segments: ChatSegment[]): string {
  return concatText(segments);
}

/**
 * Prefix every line with "> " for a quoted reply. Empty trailing lines are
 * preserved so the resulting block can be cleanly prepended to a draft.
 */
function toQuoted(text: string): string {
  return text
    .split("\n")
    .map((ln) => `> ${ln}`)
    .join("\n");
}

function SegmentView(props: { seg: ChatSegment }): JSX.Element {
  const seg = () => props.seg;
  return (
    <Show
      when={seg().kind === "text"}
      fallback={
        <Show
          when={seg().kind === "code"}
          fallback={
            <div class="my-2 rounded-md border border-border-subtle bg-bg-surface p-3 text-xs font-mono text-text-secondary">
              [{seg().kind}]{" "}
              {((seg() as { content?: string }).content ?? "").slice(0, 120)}
            </div>
          }
        >
          <CodeBlock
            lang={(seg() as { lang?: string }).lang}
            content={(seg() as { content: string }).content}
          />
        </Show>
      }
    >
      <TextBlock content={(seg() as { content: string }).content} />
    </Show>
  );
}

interface ActionsBarProps {
  actions: readonly MessageAction[];
}

function ActionsBar(props: ActionsBarProps): JSX.Element {
  return (
    <div
      class={
        "hidden sm:flex absolute -top-2 right-2 items-center gap-1 " +
        "rounded-md border border-border-subtle bg-bg-page shadow-sm " +
        "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 " +
        "transition-opacity duration-fast ease-rcc"
      }
      role="menu"
      aria-label="消息操作"
    >
      <For each={props.actions}>
        {(a) => (
          <IconButton
            size="sm"
            role="menuitem"
            aria-label={a.label}
            title={a.label}
            onClick={a.disabled ? undefined : a.onSelect}
            disabled={a.disabled}
            aria-disabled={a.disabled ? "true" : "false"}
            class={a.disabled ? "opacity-50" : ""}
          >
            <span aria-hidden="true">{a.icon}</span>
          </IconButton>
        )}
      </For>
    </div>
  );
}

// --- main ------------------------------------------------------------------

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 6;
/** `rcc:quote-into-composer` — window CustomEvent picked up by Composer to
 *  prepend `detail.text` to the current draft. */
const QUOTE_EVENT = "rcc:quote-into-composer";

export function MessageRow(props: MessageRowProps): JSX.Element {
  const [copied, setCopied] = createSignal<string | null>(null);
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const segments = createMemo(() => props.msg.segments);

  // --- toast helpers -------------------------------------------------------
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const flashToast = (label: string): void => {
    setCopied(label);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      setCopied(null);
      toastTimer = null;
    }, 1500);
  };
  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });

  // --- action handlers -----------------------------------------------------
  async function writeClipboard(text: string, toast: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      flashToast(toast);
    } catch {
      /* clipboard unavailable (insecure context / permissions) */
    }
  }

  const handleCopy = (): void => {
    void writeClipboard(concatText(segments()), "已复制");
  };
  const handleCopyMarkdown = (): void => {
    void writeClipboard(concatMarkdown(segments()), "已复制 Markdown");
  };
  const handleQuote = (): void => {
    const quoted = toQuoted(concatText(segments()));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(QUOTE_EVENT, { detail: { text: quoted } }),
      );
    }
    flashToast("已引用到输入框");
  };
  const handlePin = (): void => {
    props.onPin?.(props.msg.id);
    flashToast("已固定");
  };
  const handleShareLink = (): void => {
    if (typeof window === "undefined") return;
    // Best-effort sid discovery — the session id lives on the URL's `?sid=`
    // query for shared-link routes, and on `location.hash` like `#/s/<sid>`
    // on the primary app. Fall back to empty so the copied URL is still
    // debuggable even if we can't pin the session.
    const params = new URLSearchParams(window.location.search);
    let sid = params.get("sid") ?? "";
    if (!sid) {
      const m = /\/s\/([^/?#]+)/.exec(window.location.hash);
      if (m) sid = m[1];
    }
    const url = new URL(window.location.origin);
    if (sid) url.searchParams.set("sid", sid);
    url.searchParams.set("msg", props.msg.id);
    void writeClipboard(url.toString(), "已复制分享链接");
  };
  const handleFork = (): void => {
    if (!props.onFork) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("创建新会话,复制到此消息为止的所有对话?")
    )
      return;
    props.onFork(props.msg.id);
  };

  // --- action list (single source of truth for desktop bar + mobile sheet) -
  const actions = (): MessageAction[] => {
    const list: MessageAction[] = [
      { id: "copy", label: "复制", icon: "⧉", onSelect: handleCopy },
      {
        id: "copy-md",
        label: "复制为 Markdown",
        icon: "⌘",
        onSelect: handleCopyMarkdown,
      },
      { id: "quote", label: "引用回复", icon: "❝", onSelect: handleQuote },
      { id: "pin", label: "固定到笔记", icon: "📌", onSelect: handlePin },
      {
        id: "share",
        label: "复制分享链接",
        icon: "🔗",
        onSelect: handleShareLink,
      },
    ];
    if (props.onFork) {
      list.push({ id: "fork", label: "从此分叉", icon: "🍴", onSelect: handleFork });
    }
    list.push({
      id: "regenerate",
      label: "重新生成 (批次 7 提供)",
      icon: "↻",
      onSelect: () => {},
      disabled: true,
    });
    return list;
  };

  // --- long-press → mobile sheet ------------------------------------------
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressStart: { x: number; y: number } | null = null;
  const cancelPress = (): void => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    pressStart = null;
  };
  onCleanup(cancelPress);

  const onPointerDown = (e: PointerEvent): void => {
    // Only arm on touch / pen. Mouse users have the hover toolbar on sm+.
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    cancelPress();
    pressStart = { x: e.clientX, y: e.clientY };
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      pressStart = null;
      setSheetOpen(true);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!pressStart) return;
    const dx = e.clientX - pressStart.x;
    const dy = e.clientY - pressStart.y;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
      cancelPress();
    }
  };
  const onPointerUp = (): void => cancelPress();
  const onPointerCancel = (): void => cancelPress();

  // Keyboard: Enter on the row opens the action sheet (mobile parity for
  // assistive-tech users on touch devices, and a secondary entry point on
  // desktop when the hover bar is hidden).
  const onRowKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as HTMLElement | null;
    // Don't steal Enter from focused controls inside the message
    // (e.g. CodeBlock copy button, links).
    if (target && target !== e.currentTarget) {
      const tag = target.tagName;
      if (
        tag === "BUTTON" ||
        tag === "A" ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
    }
    e.preventDefault();
    setSheetOpen(true);
  };

  const role = () => props.msg.role;
  const roleLabel = (): string =>
    role() === "user" ? "用户" : role() === "assistant" ? "助手" : "系统";

  const SrRoleHeader = (): JSX.Element => (
    <span class="sr-only">
      {roleLabel()} · {formatTimestamp(props.msg.timestamp)}
      {props.msg.streaming ? " · 正在输入" : ""}
    </span>
  );

  return (
    <>
      <Show
        when={role() === "system"}
        fallback={
          <Show
            when={role() === "user"}
            fallback={
              <div
                class="group flex gap-2 sm:gap-3 my-4 relative"
                role="article"
                aria-roledescription="消息"
                aria-busy={props.msg.streaming ? "true" : "false"}
                tabIndex={0}
                onKeyDown={onRowKeyDown}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                <SrRoleHeader />
                <div class="w-5 sm:w-6 shrink-0 flex justify-center pt-[6px]">
                  <Show when={!props.isFollowup}>
                    <span
                      class="block w-2.5 h-2.5 bg-accent rotate-45"
                      aria-hidden="true"
                    />
                  </Show>
                </div>
                <div class="relative flex-1 min-w-0">
                  <ActionsBar actions={actions()} />
                  <div class="font-serif text-[15px] leading-[1.65] text-text-primary">
                    <For each={segments()}>{(seg) => <SegmentView seg={seg} />}</For>
                    <Show when={props.msg.streaming}>
                      <span class="pulse-soft ml-0.5" aria-hidden="true">▍</span>
                    </Show>
                  </div>
                  <Show when={!props.isFollowup}>
                    <div
                      class="text-text-muted text-[11px] font-sans mt-1"
                      aria-hidden="true"
                    >
                      {formatTimestamp(props.msg.timestamp)}
                    </div>
                  </Show>
                  <Show when={copied()}>
                    <div
                      class="absolute -bottom-6 left-0 text-[11px] text-text-muted bg-bg-surface px-2 py-0.5 rounded-sm border border-border-subtle"
                      role="status"
                      aria-live="polite"
                    >
                      {copied()}
                    </div>
                  </Show>
                </div>
              </div>
            }
          >
            <div
              class="group flex justify-end my-3 relative"
              role="article"
              aria-roledescription="消息"
              aria-busy={props.msg.streaming ? "true" : "false"}
              tabIndex={0}
              onKeyDown={onRowKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
            >
              <SrRoleHeader />
              <div class="relative max-w-[88%] sm:max-w-[80%] ml-auto">
                <ActionsBar actions={actions()} />
                <div class="rounded-lg bg-userBubble text-text-primary px-4 py-3 font-serif text-[15px] leading-[1.6]">
                  <For each={segments()}>{(seg) => <SegmentView seg={seg} />}</For>
                  <Show when={props.msg.streaming}>
                    <span class="pulse-soft ml-0.5" aria-hidden="true">▍</span>
                  </Show>
                </div>
                <Show when={copied()}>
                  <div
                    class="absolute -bottom-6 right-0 text-[11px] text-text-muted bg-bg-surface px-2 py-0.5 rounded-sm border border-border-subtle"
                    role="status"
                    aria-live="polite"
                  >
                    {copied()}
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        }
      >
        <div class="my-2 text-center" role="article" aria-roledescription="系统消息">
          <SrRoleHeader />
          <span class="font-sans text-xs italic text-text-muted">
            {concatText(segments())}
          </span>
        </div>
      </Show>

      <MessageActionSheet
        open={sheetOpen()}
        onClose={() => setSheetOpen(false)}
        actions={actions()}
      />
    </>
  );
}

export default MessageRow;
