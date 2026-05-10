import { createMemo, createSignal, Show, type JSX } from "solid-js";
import type { ChatSegment } from "@rcc/protocol";

/**
 * ToolCallBlock — renders a `tool_use` segment, optionally paired with its
 * matching `tool_result`. MessageRow pairs segments by `toolUseId` upstream
 * and hands the pair to this component; unpaired tool_result segments are
 * rendered by `ToolResultBlock` below.
 */

type ToolUseSeg = Extract<ChatSegment, { kind: "tool_use" }>;
type ToolResultSeg = Extract<ChatSegment, { kind: "tool_result" }>;

export interface ToolCallBlockProps {
  /** The tool_use segment, required. */
  use: ToolUseSeg;
  /** Optional paired tool_result (from a later segment, matched by toolUseId upstream). */
  result?: ToolResultSeg;
}

export interface ToolResultBlockProps {
  /** Unpaired tool_result — shown alone when we couldn't match it to a tool_use. */
  result: ToolResultSeg;
}

async function copyText(text: string, onDone: (ok: boolean) => void): Promise<void> {
  const fallback = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onDone(true);
    } catch {
      onDone(false);
    }
  };
  try {
    await navigator.clipboard.writeText(text);
    onDone(true);
  } catch {
    fallback();
  }
}

function CopyChip(props: { text: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const onClick = () => {
    copyText(props.text, (ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition duration-fast ease-rcc font-sans text-[10px] px-1.5 py-0.5 rounded bg-bg-surface border border-border-subtle text-text-muted hover:bg-bg-surfaceStrong"
    >
      {copied() ? "✓" : "复制"}
    </button>
  );
}

export function ToolCallBlock(props: ToolCallBlockProps): JSX.Element {
  const initialCollapsed = () => {
    if (props.result?.isError) return false;
    return props.use.collapsed ?? true;
  };
  const [open, setOpen] = createSignal(!initialCollapsed());

  const pill = createMemo(() => {
    if (props.result) {
      if (props.result.isError) {
        return { cls: "bg-danger/15 text-danger", label: "✗ 错误" };
      }
      return { cls: "bg-success/15 text-success", label: "✓ 完成" };
    }
    return {
      cls: "bg-warn/15 text-warn animate-pulse",
      label: "运行中",
    };
  });

  const preview = createMemo(() => {
    const s = props.use.input ?? "";
    return s.length > 100 ? s.slice(0, 100) : s;
  });

  const outLabel = () =>
    props.result?.isError ? "错误" : "输出";
  const outLabelCls = () =>
    props.result?.isError
      ? "text-[10px] font-mono text-danger uppercase tracking-wide mb-1"
      : "text-[10px] font-mono text-text-muted uppercase tracking-wide mb-1";
  const outPreCls = () =>
    props.result?.isError
      ? "text-[12px] font-mono text-danger whitespace-pre-wrap break-all max-h-[240px] overflow-auto"
      : "text-[12px] font-mono text-text-primary whitespace-pre-wrap break-all max-h-[240px] overflow-auto";

  return (
    <div class="my-2 rounded-md border border-border-subtle bg-bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-surfaceStrong transition duration-fast ease-rcc"
      >
        <span class="text-text-muted w-3 text-[11px] flex-shrink-0">
          {open() ? "▼" : "▶"}
        </span>
        <span class="font-mono text-[12px] text-accent flex items-center gap-1 flex-shrink-0">
          <span>🔧</span>
          <span>{props.use.tool}</span>
        </span>
        <span class="text-text-secondary text-[11px] truncate flex-1 min-w-0">
          {preview()}
        </span>
        <span
          class={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${pill().cls}`}
        >
          {pill().label}
        </span>
      </button>
      <Show when={open()}>
        <div class="border-t border-border-subtle px-3 py-2 bg-bg-page">
          <div class="text-[10px] font-mono text-text-muted uppercase tracking-wide mb-1">
            输入
          </div>
          <div class="relative group">
            <pre class="text-[12px] font-mono text-text-primary whitespace-pre-wrap break-all max-h-[240px] overflow-auto">
              {props.use.input}
            </pre>
            <CopyChip text={props.use.input} />
          </div>
        </div>
        <Show when={props.result}>
          {(r) => (
            <div class="border-t border-border-subtle px-3 py-2">
              <div class={outLabelCls()}>{outLabel()}</div>
              <div class="relative group">
                <pre class={outPreCls()}>{r().content}</pre>
                <CopyChip text={r().content} />
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}

export function ToolResultBlock(props: ToolResultBlockProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const isError = () => props.result.isError === true;
  const wrapCls = () =>
    isError()
      ? "my-2 rounded-md border text-xs border-danger/40 bg-danger/5"
      : "my-2 rounded-md border text-xs border-success/40 bg-success/5";
  const title = () => (isError() ? "✗ 工具错误" : "🔧 工具结果");
  const preview = () => {
    const s = props.result.content ?? "";
    return s.length > 100 ? s.slice(0, 100) : s;
  };

  return (
    <div class={wrapCls()}>
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-surfaceStrong/40 transition duration-fast ease-rcc"
      >
        <span class="text-text-muted w-3 text-[11px] flex-shrink-0">
          {open() ? "▼" : "▶"}
        </span>
        <span
          class={`font-mono text-[12px] flex-shrink-0 ${isError() ? "text-danger" : "text-text-secondary"}`}
        >
          {title()}
        </span>
        <span class="text-text-secondary text-[11px] truncate flex-1 min-w-0">
          {preview()}
        </span>
      </button>
      <Show when={open()}>
        <div class="border-t border-border-subtle px-3 py-2 relative group">
          <pre
            class={`text-[12px] font-mono whitespace-pre-wrap break-all max-h-[240px] overflow-auto ${isError() ? "text-danger" : "text-text-primary"}`}
          >
            {props.result.content}
          </pre>
          <CopyChip text={props.result.content} />
        </div>
      </Show>
    </div>
  );
}

export default ToolCallBlock;
