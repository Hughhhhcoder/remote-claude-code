import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import type { ChatMessage, ChatSegment } from "@rcc/protocol";
import { IconButton } from "../primitives/IconButton";
import { TextBlock } from "./blocks/TextBlock";
import { CodeBlock } from "./blocks/CodeBlock";

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
 * Hover actions (sm+ only): Copy · Quote/Reply · Regenerate(disabled).
 */

export interface MessageRowProps {
  msg: ChatMessage;
  onPin?: (messageId: string) => void;
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

function concatText(segments: ChatSegment[]): string {
  return segments
    .map((s) => {
      if (s.kind === "text") return s.content;
      if (s.kind === "code") {
        const fence = "```";
        return `${fence}${s.lang ?? ""}\n${s.content}\n${fence}`;
      }
      if (s.kind === "diff" || s.kind === "thinking") return s.content;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
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

function ActionsBar(props: {
  onCopy: () => void;
  onQuote: () => void;
}): JSX.Element {
  return (
    <div
      class={
        "hidden sm:flex absolute -top-2 right-2 items-center gap-1 " +
        "rounded-md border border-border-subtle bg-bg-page shadow-sm " +
        "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 " +
        "transition-opacity duration-fast ease-rcc"
      }
      role="toolbar"
    >
      <IconButton size="sm" aria-label="复制消息" title="复制" onClick={props.onCopy}>
        ⧉
      </IconButton>
      <IconButton size="sm" aria-label="引用回复" title="引用" onClick={props.onQuote}>
        ❝
      </IconButton>
      <IconButton
        size="sm"
        aria-label="重新生成 (批次 7 提供)"
        title="批次 7 提供"
        disabled
        class="opacity-50"
      >
        ↻
      </IconButton>
    </div>
  );
}

// --- main ------------------------------------------------------------------

export function MessageRow(props: MessageRowProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const segments = createMemo(() => props.msg.segments);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(concatText(segments()));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  const handleQuote = () => props.onPin?.(props.msg.id);

  const role = () => props.msg.role;

  return (
    <Show
      when={role() === "system"}
      fallback={
        <Show when={role() === "user"} fallback={
          <div class="group flex gap-2 sm:gap-3 my-4 relative">
            <div class="w-5 sm:w-6 shrink-0 flex justify-center pt-[6px]">
              <Show when={!props.isFollowup}>
                <span
                  class="block w-2.5 h-2.5 bg-accent rotate-45"
                  aria-hidden="true"
                />
              </Show>
            </div>
            <div class="relative flex-1 min-w-0">
              <ActionsBar onCopy={handleCopy} onQuote={handleQuote} />
              <div class="font-serif text-[15px] leading-[1.65] text-text-primary">
                <For each={segments()}>{(seg) => <SegmentView seg={seg} />}</For>
                <Show when={props.msg.streaming}>
                  <span class="pulse-soft ml-0.5">▍</span>
                </Show>
              </div>
              <Show when={!props.isFollowup}>
                <div class="text-text-muted text-[11px] font-sans mt-1">
                  {formatTimestamp(props.msg.timestamp)}
                </div>
              </Show>
              <Show when={copied()}>
                <div class="absolute -bottom-6 left-0 text-[11px] text-text-muted bg-bg-surface px-2 py-0.5 rounded-sm border border-border-subtle">
                  已复制
                </div>
              </Show>
            </div>
          </div>
        }>
          <div class="group flex justify-end my-3 relative">
            <div class="relative max-w-[88%] sm:max-w-[80%] ml-auto">
              <ActionsBar onCopy={handleCopy} onQuote={handleQuote} />
              <div class="rounded-lg bg-userBubble text-text-primary px-4 py-3 font-serif text-[15px] leading-[1.6]">
                <For each={segments()}>{(seg) => <SegmentView seg={seg} />}</For>
                <Show when={props.msg.streaming}>
                  <span class="pulse-soft ml-0.5">▍</span>
                </Show>
              </div>
              <Show when={copied()}>
                <div class="absolute -bottom-6 right-0 text-[11px] text-text-muted bg-bg-surface px-2 py-0.5 rounded-sm border border-border-subtle">
                  已复制
                </div>
              </Show>
            </div>
          </div>
        </Show>
      }
    >
      <div class="my-2 text-center">
        <span class="font-sans text-xs italic text-text-muted">
          {concatText(segments())}
        </span>
      </div>
    </Show>
  );
}

export default MessageRow;
