import { createSignal, createMemo, createUniqueId, For, Show, type JSX } from "solid-js";

/**
 * DiffBlock — unified-diff renderer with a header strip (path + counts + copy)
 * and a claude.ai-style body: colored gutter + text, no banner backgrounds.
 * Best-effort parser: not a full patch-utils replacement.
 *
 * Long diffs (>40 lines) collapse by default to 32 lines with a fade overlay
 * and a "展开全部" toggle. Boundary: exactly 40 lines stays expanded.
 */

const DIFF_COLLAPSE_TRIGGER = 40;
const DIFF_COLLAPSE_SHOW = 32;

export interface DiffBlockProps {
  content: string;
  path?: string;
  /** When true, show copy button in header. Default true. */
  copyable?: boolean;
  /** Force initial collapsed state. Default true if content exceeds threshold. */
  forceCollapsed?: boolean;
}

type LineKind = "add" | "del" | "ctx" | "hunk" | "meta";
interface DLine { kind: LineKind; text: string }

interface Parsed {
  lines: DLine[];
  added: number;
  removed: number;
  parsedPath: string | null;
}

function parseDiff(src: string): Parsed {
  const lines: DLine[] = [];
  let added = 0;
  let removed = 0;
  let parsedPath: string | null = null;
  const raw = src.split("\n");
  for (const line of raw) {
    if (line.startsWith("@@")) {
      lines.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+++")) {
      const m = line.match(/^\+\+\+\s+b\/(.+?)\s*$/);
      if (m && !parsedPath) parsedPath = m[1];
      lines.push({ kind: "meta", text: line });
    } else if (line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) {
      lines.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      added++;
      lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      removed++;
      lines.push({ kind: "del", text: line.slice(1) });
    } else {
      lines.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  return { lines, added, removed, parsedPath };
}

const LINE_CLASS: Record<LineKind, string> = {
  add: "text-success border-l-2 border-success/50 pl-2",
  del: "text-danger border-l-2 border-danger/50 pl-2",
  hunk: "text-text-muted font-semibold bg-bg-surface px-2 py-0.5",
  ctx: "text-text-secondary pl-2.5",
  meta: "text-text-muted italic text-[11px] pl-2.5",
};

export function DiffBlock(props: DiffBlockProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);

  async function copy() {
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = props.content;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* give up silently */ }
    };
    try {
      await navigator.clipboard.writeText(props.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { fallback(); }
  }

  const parsed = createMemo<Parsed | null>(() => {
    if (!props.content) return null;
    return parseDiff(props.content);
  });

  const totalLines = createMemo(() => {
    const p = parsed();
    return p ? p.lines.length : 0;
  });
  const shouldCollapse = () => totalLines() > DIFF_COLLAPSE_TRIGGER;
  const initialCollapsed = () =>
    props.forceCollapsed !== undefined ? props.forceCollapsed : shouldCollapse();
  const [collapsed, setCollapsed] = createSignal(initialCollapsed());
  const bodyId = createUniqueId();

  const visibleLines = (p: Parsed): DLine[] => {
    if (!collapsed()) return p.lines;
    return p.lines.slice(0, DIFF_COLLAPSE_SHOW);
  };

  const displayPath = () => {
    const p = parsed();
    if (!p) return null;
    return p.parsedPath ?? props.path ?? null;
  };

  const showCopy = () => props.copyable !== false;

  return (
    <Show when={parsed()}>
      {(p) => (
        <div class="my-3 rounded-md border border-border-subtle bg-codeBg overflow-hidden">
          <div class="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-bg-surface text-[11px] font-mono text-text-muted">
            <div class="flex items-center gap-2 min-w-0">
              <span>diff</span>
              <Show when={displayPath()}>
                <span class="px-1.5 py-0.5 rounded bg-bg-page text-text-secondary font-mono text-[10px] truncate max-w-[240px]">
                  {displayPath()}
                </span>
              </Show>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-success text-[11px] font-mono">+{p().added}</span>
              <span class="text-danger text-[11px] font-mono">-{p().removed}</span>
              <Show when={showCopy()}>
                <button
                  type="button"
                  onClick={copy}
                  class="font-sans text-[11px] px-2 py-0.5 rounded hover:bg-bg-surfaceStrong transition duration-fast ease-rcc"
                >
                  {copied() ? "✓ 已复制" : "复制"}
                </button>
              </Show>
            </div>
          </div>
          <div class="relative" id={bodyId}>
            <div class="overflow-x-auto text-[13px] leading-[1.6] font-mono py-1">
              <For each={visibleLines(p())}>
                {(ln) => (
                  <div class={LINE_CLASS[ln.kind]}>
                    <span class="whitespace-pre">{ln.text || " "}</span>
                  </div>
                )}
              </For>
            </div>
            <Show when={collapsed() && shouldCollapse()}>
              <div
                class="absolute inset-x-0 bottom-0 h-6 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to top, rgb(var(--code-bg)) 0%, rgb(var(--code-bg) / 0) 100%)",
                }}
              />
            </Show>
          </div>
          <Show when={shouldCollapse()}>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed()}
              aria-controls={bodyId}
              class="w-full text-center py-2 sm:py-1.5 border-t border-border-subtle bg-bg-page hover:bg-bg-surface text-[12px] font-sans text-accent hover:text-accent-hover transition"
            >
              {collapsed() ? `展开全部 (共 ${totalLines()} 行)` : "折叠"}
            </button>
          </Show>
        </div>
      )}
    </Show>
  );
}

export default DiffBlock;
