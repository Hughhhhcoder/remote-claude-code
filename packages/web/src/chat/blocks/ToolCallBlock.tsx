import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { ChatSegment } from "@rcc/protocol";
import {
  formatBytes,
  summarize,
  type GrepGroup,
  type JsonTopKey,
  type OutputSummary,
} from "./summarizeOutput";

/**
 * ToolCallBlock — renders a `tool_use` segment, optionally paired with its
 * matching `tool_result`. MessageRow pairs segments by `toolUseId` upstream
 * and hands the pair to this component; unpaired tool_result segments are
 * rendered by `ToolResultBlock` below.
 *
 * For large outputs (>8 KiB or >100 lines) the output is run through
 * `summarizeOutput.ts` which classifies it and provides head/tail slices,
 * JSON top-key toggles, dir counts, grep file groups, and an error-only
 * collapsed view. See that module for thresholds and formatters.
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

// ---------------------------------------------------------------------------
// OutputView — renders a summary chosen by `summarize()`. All modes share
// a uniform pre-block style and semantic tokens.
// ---------------------------------------------------------------------------

const preBaseCls =
  "text-[12px] font-mono whitespace-pre-wrap break-all max-h-[360px] overflow-auto";

function preCls(isError: boolean): string {
  return `${preBaseCls} ${isError ? "text-danger" : "text-text-primary"}`;
}

function JsonKeyTable(props: { keys: JsonTopKey[] }): JSX.Element {
  return (
    <div class="text-[12px] font-mono text-text-primary overflow-auto max-h-[360px]">
      <For each={props.keys}>
        {(k) => (
          <div class="flex gap-2 py-0.5 border-b border-border-subtle/40 last:border-b-0">
            <span class="text-accent flex-shrink-0">{k.key}</span>
            <span class="text-text-muted flex-shrink-0">{k.type}</span>
            <span class="text-text-secondary truncate">{k.hint}</span>
          </div>
        )}
      </For>
    </div>
  );
}

function GrepGroups(props: { groups: GrepGroup[] }): JSX.Element {
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const toggle = (p: string) =>
    setExpanded((prev) => ({ ...prev, [p]: !prev[p] }));
  return (
    <div class="text-[12px] font-mono text-text-primary">
      <For each={props.groups}>
        {(g) => (
          <div class="border-b border-border-subtle/40 last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(g.path)}
              class="w-full text-left flex items-center gap-2 py-1 hover:bg-bg-surfaceStrong/40 transition duration-fast ease-rcc"
            >
              <span class="text-text-muted w-3 text-[11px] flex-shrink-0">
                {expanded()[g.path] ? "▼" : "▶"}
              </span>
              <span class="text-accent truncate flex-1 min-w-0">{g.path}</span>
              <span class="text-text-muted flex-shrink-0">×{g.count}</span>
            </button>
            <Show when={expanded()[g.path]}>
              <pre class={`${preBaseCls} pl-5 pb-1 text-text-secondary`}>
                {g.matches.join("\n")}
              </pre>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

interface OutputViewProps {
  content: string;
  isError: boolean;
}

function OutputView(props: OutputViewProps): JSX.Element {
  const summary = createMemo<OutputSummary>(() =>
    summarize(props.content, props.isError),
  );

  // Error mode: whole body collapsed behind a "查看 {N} 行 stderr" button.
  const [errorOpen, setErrorOpen] = createSignal(false);
  // Text/dirlist/grep mode: "N lines hidden" expander.
  const [expanded, setExpanded] = createSignal(false);
  // JSON mode: top-keys-only toggle.
  const [topKeysOnly, setTopKeysOnly] = createSignal(false);

  return (
    <div class="relative group">
      <Show when={summary().kind === "error"}>
        <Show
          when={errorOpen()}
          fallback={
            <button
              type="button"
              onClick={() => setErrorOpen(true)}
              class="font-sans text-[11px] px-2 py-1 rounded bg-danger/15 text-danger hover:bg-danger/25 transition duration-fast ease-rcc"
            >
              查看 {summary().totalLines} 行 stderr ({formatBytes(summary().totalBytes)})
            </button>
          }
        >
          <pre class={preCls(true)}>{props.content}</pre>
          <CopyChip text={props.content} />
        </Show>
      </Show>

      <Show when={summary().kind === "json"}>
        {(() => {
          const s = summary();
          return (
            <>
              <div class="flex items-center gap-2 mb-1">
                <button
                  type="button"
                  onClick={() => setTopKeysOnly(!topKeysOnly())}
                  class="font-sans text-[10px] px-1.5 py-0.5 rounded bg-bg-surface border border-border-subtle text-text-muted hover:bg-bg-surfaceStrong transition duration-fast ease-rcc"
                >
                  {topKeysOnly() ? "完整 JSON" : "仅看顶层键"}
                </button>
                <span class="text-[10px] font-mono text-text-muted">
                  {s.totalLines} 行 · {formatBytes(s.totalBytes)}
                </span>
              </div>
              <Show
                when={topKeysOnly()}
                fallback={
                  <>
                    <Show
                      when={s.isLarge && !expanded()}
                      fallback={
                        <pre class={preCls(false)}>{s.json?.pretty ?? props.content}</pre>
                      }
                    >
                      <pre class={preCls(false)}>{s.head.join("\n")}</pre>
                      <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        class="w-full my-1 font-sans text-[10px] px-2 py-1 rounded bg-bg-surface border border-border-subtle text-text-muted hover:bg-bg-surfaceStrong transition duration-fast ease-rcc"
                      >
                        展开 {s.hiddenLines} 行
                      </button>
                      <pre class={preCls(false)}>{s.tail.join("\n")}</pre>
                    </Show>
                    <CopyChip text={s.json?.pretty ?? props.content} />
                  </>
                }
              >
                <JsonKeyTable keys={s.json?.topKeys ?? []} />
              </Show>
            </>
          );
        })()}
      </Show>

      <Show when={summary().kind === "dirlist"}>
        {(() => {
          const s = summary();
          const d = s.dir ?? { files: 0, dirs: 0, links: 0, other: 0 };
          return (
            <>
              <div class="flex items-center gap-2 mb-1 text-[10px] font-mono text-text-muted">
                <span class="px-1.5 py-0.5 rounded bg-bg-surface border border-border-subtle">
                  {d.files} files · {d.dirs} dirs
                  <Show when={d.links > 0}> · {d.links} links</Show>
                  <Show when={d.other > 0}> · {d.other} other</Show>
                </span>
                <span>{formatBytes(s.totalBytes)}</span>
              </div>
              <Show
                when={s.isLarge && !expanded()}
                fallback={<pre class={preCls(false)}>{props.content}</pre>}
              >
                <pre class={preCls(false)}>{s.head.join("\n")}</pre>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  class="w-full my-1 font-sans text-[10px] px-2 py-1 rounded bg-bg-surface border border-border-subtle text-text-muted hover:bg-bg-surfaceStrong transition duration-fast ease-rcc"
                >
                  展开 {s.hiddenLines} 行
                </button>
                <pre class={preCls(false)}>{s.tail.join("\n")}</pre>
              </Show>
              <CopyChip text={props.content} />
            </>
          );
        })()}
      </Show>

      <Show when={summary().kind === "grep"}>
        {(() => {
          const s = summary();
          return (
            <>
              <div class="flex items-center gap-2 mb-1 text-[10px] font-mono text-text-muted">
                <span>
                  top {(s.grep ?? []).length} files · {s.totalLines} matches
                </span>
                <span>{formatBytes(s.totalBytes)}</span>
              </div>
              <GrepGroups groups={s.grep ?? []} />
              <CopyChip text={props.content} />
            </>
          );
        })()}
      </Show>

      <Show when={summary().kind === "text"}>
        {(() => {
          const s = summary();
          return (
            <>
              <Show
                when={s.isLarge && !expanded()}
                fallback={<pre class={preCls(false)}>{props.content}</pre>}
              >
                <pre class={preCls(false)}>{s.head.join("\n")}</pre>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  class="w-full my-1 font-sans text-[10px] px-2 py-1 rounded bg-bg-surface border border-border-subtle text-text-muted hover:bg-bg-surfaceStrong transition duration-fast ease-rcc"
                >
                  展开 {s.hiddenLines} 行 ({formatBytes(s.totalBytes)})
                </button>
                <pre class={preCls(false)}>{s.tail.join("\n")}</pre>
              </Show>
              <CopyChip text={props.content} />
            </>
          );
        })()}
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallBlock — paired tool_use + tool_result.
// ---------------------------------------------------------------------------

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

  const outLabel = () => (props.result?.isError ? "错误" : "输出");
  const outLabelCls = () =>
    props.result?.isError
      ? "text-[10px] font-mono text-danger uppercase tracking-wide mb-1"
      : "text-[10px] font-mono text-text-muted uppercase tracking-wide mb-1";

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
              <OutputView
                content={r().content}
                isError={r().isError === true}
              />
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolResultBlock — orphan tool_result (no matching tool_use).
// ---------------------------------------------------------------------------

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
        <div class="border-t border-border-subtle px-3 py-2">
          <OutputView content={props.result.content} isError={isError()} />
        </div>
      </Show>
    </div>
  );
}

export default ToolCallBlock;
