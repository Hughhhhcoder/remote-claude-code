import { Show, type JSX } from "solid-js";
import { Chip } from "../primitives/Chip.tsx";
import { IconButton } from "../primitives/IconButton.tsx";

/**
 * InboxItem — single row in the inbox pane. Presentational only; the
 * enclosing InboxPane is responsible for adapting wire-level
 * `ActivityItem`s from @rcc/protocol into this plain shape.
 */

export interface InboxItemRecord {
  id: string;
  kind: "approval" | "notification" | "message" | "workflow" | "system";
  title: string;
  subtitle?: string;
  sid?: string;
  timestamp: number;
  status?: "unread" | "read" | "pending" | "resolved";
  /** Emoji / glyph override, else derived from kind. */
  icon?: string;
  /** Caller-defined metadata (approval id, commit hash, etc). */
  meta?: Record<string, unknown>;
}

export interface InboxItemProps {
  item: InboxItemRecord;
  onClick?: (item: InboxItemRecord) => void;
  onDismiss?: (id: string) => void;
  /** Render a compact 44px row (single-line). */
  compact?: boolean;
  /** Highlight as keyboard-focused. */
  selected?: boolean;
}

const KIND_ICON: Record<InboxItemRecord["kind"], string> = {
  approval: "⚠",
  notification: "🔔",
  message: "💬",
  workflow: "⏵",
  system: "⚙",
};

function iconFor(item: InboxItemRecord): string {
  if (item.icon) return item.icon;
  return KIND_ICON[item.kind] ?? "•";
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function InboxItem(props: InboxItemProps): JSX.Element {
  const isUnread = () => props.item.status === "unread";
  const isPending = () => props.item.status === "pending";
  const compact = () => props.compact === true;

  const containerClass = () =>
    [
      "group relative flex items-start gap-3 px-4 border-b border-border-subtle last:border-b-0",
      "cursor-pointer transition duration-fast ease-rcc hover:bg-bg-surfaceStrong",
      "focus-visible:outline-none focus-visible:bg-bg-surfaceStrong",
      compact() ? "py-2 min-h-[44px]" : "py-3 min-h-[64px] sm:min-h-[56px]",
      props.selected ? "bg-accent-bg" : "",
    ].filter(Boolean).join(" ");

  const pick = () => props.onClick?.(props.item);

  return (
    <div
      role="button"
      tabIndex={0}
      class={containerClass()}
      onClick={(e) => { e.preventDefault(); pick(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      }}
      data-kind={props.item.kind}
      data-status={props.item.status ?? "read"}
    >
      <Show when={isUnread()}>
        <span class="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" aria-hidden="true" />
      </Show>

      <div
        class="shrink-0 w-6 h-6 flex items-center justify-center text-[14px] leading-none text-text-secondary mt-[1px]"
        aria-hidden="true"
      >
        {iconFor(props.item)}
      </div>

      <div class="min-w-0 flex-1">
        <Show
          when={!compact()}
          fallback={
            <div class="font-sans text-[13px] text-text-primary truncate">
              <span class="font-medium">{props.item.title}</span>
              <Show when={props.item.subtitle}>
                <span class="text-text-secondary"> · {props.item.subtitle}</span>
              </Show>
            </div>
          }
        >
          <div class="font-sans text-[14px] text-text-primary font-medium truncate leading-snug">
            {props.item.title}
          </div>
          <Show when={props.item.subtitle}>
            <div class="font-sans text-[12px] text-text-secondary truncate mt-0.5 leading-snug">
              {props.item.subtitle}
            </div>
          </Show>
        </Show>
      </div>

      <div class="shrink-0 flex flex-col items-end gap-1">
        <div class="flex items-center gap-2">
          <Show when={isPending()}>
            <Chip size="xs" tone="warn" dot>待处理</Chip>
          </Show>
          <Show when={isUnread() && !isPending()}>
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-accent" aria-label="未读" />
          </Show>
          <span class="font-sans text-[11px] text-text-muted whitespace-nowrap">
            {relativeTime(props.item.timestamp)}
          </span>
        </div>
        <Show when={props.onDismiss}>
          <IconButton
            size="sm"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              props.onDismiss?.(props.item.id);
            }}
            class="opacity-0 group-hover:opacity-100 sm:transition-opacity"
          >
            ✕
          </IconButton>
        </Show>
      </div>
    </div>
  );
}

export default InboxItem;
