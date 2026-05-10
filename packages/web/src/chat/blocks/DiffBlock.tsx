import {
  createSignal,
  createMemo,
  createUniqueId,
  For,
  Show,
  type JSX,
} from "solid-js";
import { parseDiff, type DLine, type Hunk, type LineKind, type Parsed } from "./parseDiff";
import { useIsMobile } from "../../useIsMobile";

/**
 * DiffBlock — unified diff renderer with:
 *   - unified (default) / side-by-side view toggle
 *   - per-hunk context collapsing (>30 ctx lines → "N lines unchanged" expander)
 *   - sticky file-path header inside the block
 *   - responsive fallback: side-by-side auto-reverts to unified below 640px
 *
 * Props are backward-compatible with B5 / B17 callers.
 */

const CTX_COLLAPSE_TRIGGER = 30; // chunks with >30 consecutive ctx lines collapse
const CTX_COLLAPSE_KEEP = 3; // keep N ctx lines at each edge when collapsed
const DIFF_COLLAPSE_TRIGGER = 40;
const DIFF_COLLAPSE_SHOW = 32;

export type DiffView = "unified" | "side-by-side";

export interface DiffBlockProps {
  content: string;
  path?: string;
  /** When true, show copy button in header. Default true. */
  copyable?: boolean;
  /** Force initial collapsed state. Default true if content exceeds threshold. */
  forceCollapsed?: boolean;
  /** Initial view mode. Default "unified". */
  defaultView?: DiffView;
}

const LINE_CLASS: Record<LineKind, string> = {
  add: "bg-success/10 text-success border-l-2 border-success/50 pl-2",
  del: "bg-danger/10 text-danger border-l-2 border-danger/50 pl-2",
  hunk: "text-text-muted font-semibold bg-bg-surface px-2 py-0.5",
  ctx: "text-text-secondary pl-2.5",
  meta: "text-text-muted italic text-[11px] pl-2.5",
};

/** Column-local class map: sides should not show a color for empty padding rows. */
const SIDE_CLASS: Record<LineKind, string> = {
  add: "bg-success/10 text-success pl-2",
  del: "bg-danger/10 text-danger pl-2",
  hunk: "text-text-muted font-semibold bg-bg-surface px-2 py-0.5",
  ctx: "text-text-secondary pl-2.5",
  meta: "text-text-muted italic text-[11px] pl-2.5",
};

/**
 * Split a hunk's lines into segments: long consecutive ctx runs become
 * collapsed "unchanged" pills (click-to-expand), everything else is
 * rendered inline. Non-ctx runs are passed through untouched.
 */
interface InlineSeg { kind: "inline"; lines: DLine[] }
interface FoldSeg { kind: "fold"; full: DLine[]; head: DLine[]; tail: DLine[] }
type Seg = InlineSeg | FoldSeg;

function segmentHunk(lines: DLine[]): Seg[] {
  const segs: Seg[] = [];
  let buf: DLine[] = [];
  const flushCtx = () => {
    if (!buf.length) return;
    if (buf.length > CTX_COLLAPSE_TRIGGER) {
      const head = buf.slice(0, CTX_COLLAPSE_KEEP);
      const tail = buf.slice(buf.length - CTX_COLLAPSE_KEEP);
      segs.push({ kind: "fold", full: buf, head, tail });
    } else {
      segs.push({ kind: "inline", lines: buf });
    }
    buf = [];
  };
  // Inline append helper that merges adjacent inline segments so the
  // segmentation stays minimal.
  const pushInline = (ln: DLine) => {
    const last = segs[segs.length - 1];
    if (last && last.kind === "inline") last.lines.push(ln);
    else segs.push({ kind: "inline", lines: [ln] });
  };
  for (const ln of lines) {
    if (ln.kind === "ctx") {
      buf.push(ln);
    } else {
      flushCtx();
      pushInline(ln);
    }
  }
  flushCtx();
  return segs;
}

export function DiffBlock(props: DiffBlockProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const isMobile = useIsMobile();
  const [view, setView] = createSignal<DiffView>(props.defaultView ?? "unified");

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

  const displayPath = () => {
    const p = parsed();
    if (!p) return null;
    return p.parsedPath ?? props.path ?? null;
  };

  const showCopy = () => props.copyable !== false;

  // Effective view: side-by-side gracefully falls back to unified on small screens.
  const effectiveView = (): DiffView => {
    if (isMobile()) return "unified";
    return view();
  };

  const visibleUnifiedLines = (p: Parsed): DLine[] => {
    if (!collapsed()) return p.lines;
    return p.lines.slice(0, DIFF_COLLAPSE_SHOW);
  };

  // Visible hunks for side-by-side: when top-level collapsed, trim to the
  // first hunk that keeps us under DIFF_COLLAPSE_SHOW rendered rows.
  const visibleHunks = (p: Parsed): Hunk[] => {
    if (!collapsed()) return p.hunks;
    const out: Hunk[] = [];
    let budget = DIFF_COLLAPSE_SHOW;
    for (const h of p.hunks) {
      if (budget <= 0) break;
      const rowCount = (h.header ? 1 : 0) + h.rows.length;
      if (rowCount <= budget) {
        out.push(h);
        budget -= rowCount;
      } else {
        out.push({ ...h, rows: h.rows.slice(0, Math.max(0, budget - (h.header ? 1 : 0))) });
        budget = 0;
      }
    }
    return out;
  };

  return (
    <Show when={parsed()}>
      {(p) => (
        <div class="my-3 rounded-md border border-border-subtle bg-codeBg overflow-hidden">
          {/* Sticky header: file path + counts + view toggle + copy */}
          <div class="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border-subtle bg-bg-surface text-[11px] font-mono text-text-muted">
            <div class="flex items-center gap-2 min-w-0">
              <span>diff</span>
              <Show when={displayPath()}>
                <span
                  class="px-1.5 py-0.5 rounded bg-bg-page text-text-primary font-mono text-[10px] truncate max-w-[240px]"
                  title={displayPath() ?? undefined}
                >
                  {displayPath()}
                </span>
              </Show>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-success text-[11px] font-mono">+{p().added}</span>
              <span class="text-danger text-[11px] font-mono">-{p().removed}</span>

              {/* View toggle — hidden on mobile where side-by-side falls back to unified */}
              <Show when={!isMobile()}>
                <div
                  class="hidden sm:inline-flex items-center rounded border border-border-subtle bg-bg-page overflow-hidden"
                  role="group"
                  aria-label="diff view"
                >
                  <button
                    type="button"
                    onClick={() => setView("unified")}
                    aria-pressed={effectiveView() === "unified"}
                    class={`font-sans text-[11px] px-2 py-0.5 transition duration-fast ease-rcc ${
                      effectiveView() === "unified"
                        ? "bg-accent-bg text-accent"
                        : "text-text-secondary hover:bg-bg-surfaceStrong"
                    }`}
                    title="统一视图"
                  >
                    统一
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("side-by-side")}
                    aria-pressed={effectiveView() === "side-by-side"}
                    class={`font-sans text-[11px] px-2 py-0.5 border-l border-border-subtle transition duration-fast ease-rcc ${
                      effectiveView() === "side-by-side"
                        ? "bg-accent-bg text-accent"
                        : "text-text-secondary hover:bg-bg-surfaceStrong"
                    }`}
                    title="并排视图"
                  >
                    并排
                  </button>
                </div>
              </Show>

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
            <Show
              when={effectiveView() === "side-by-side"}
              fallback={
                <UnifiedView
                  lines={visibleUnifiedLines(p())}
                />
              }
            >
              <SideBySideView hunks={visibleHunks(p())} />
            </Show>

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

/* ---------- Unified view ---------- */

function UnifiedView(props: { lines: DLine[] }): JSX.Element {
  // Per-hunk chunk expansion still needs segmentation. Since the unified
  // view receives a pre-sliced flat list (top-level collapse honors its
  // own budget), we segment the whole slice once here.
  const segs = createMemo(() => segmentHunk(props.lines));
  return (
    <div class="overflow-x-auto text-[13px] leading-[1.6] font-mono py-1">
      <For each={segs()}>
        {(seg) => (
          <Show
            when={seg.kind === "fold"}
            fallback={
              <For each={(seg as InlineSeg).lines}>
                {(ln) => (
                  <div class={LINE_CLASS[ln.kind]}>
                    <span class="whitespace-pre">{ln.text || " "}</span>
                  </div>
                )}
              </For>
            }
          >
            <FoldedCtx seg={seg as FoldSeg} renderLine={(ln) => (
              <div class={LINE_CLASS[ln.kind]}>
                <span class="whitespace-pre">{ln.text || " "}</span>
              </div>
            )} />
          </Show>
        )}
      </For>
    </div>
  );
}

/* ---------- Side-by-side view ---------- */

function SideBySideView(props: { hunks: Hunk[] }): JSX.Element {
  return (
    <div class="text-[13px] leading-[1.6] font-mono py-1">
      <For each={props.hunks}>
        {(h) => (
          <div>
            <Show when={h.header}>
              <div class={LINE_CLASS.hunk}>
                <span class="whitespace-pre">{h.header}</span>
              </div>
            </Show>
            <HunkSbs hunk={h} />
          </div>
        )}
      </For>
    </div>
  );
}

function HunkSbs(props: { hunk: Hunk }): JSX.Element {
  // Segment rows by ctx-run length for per-chunk fold.
  interface InlineRows { kind: "inline"; rows: import("./parseDiff").SbsRow[] }
  interface FoldRows {
    kind: "fold";
    full: import("./parseDiff").SbsRow[];
    head: import("./parseDiff").SbsRow[];
    tail: import("./parseDiff").SbsRow[];
  }
  type RSeg = InlineRows | FoldRows;

  const segs = createMemo<RSeg[]>(() => {
    const out: RSeg[] = [];
    let buf: import("./parseDiff").SbsRow[] = [];
    const isCtxRow = (r: import("./parseDiff").SbsRow) =>
      !!r.left && !!r.right && r.left.kind === "ctx" && r.right.kind === "ctx";
    const pushInline = (r: import("./parseDiff").SbsRow) => {
      const last = out[out.length - 1];
      if (last && last.kind === "inline") last.rows.push(r);
      else out.push({ kind: "inline", rows: [r] });
    };
    const flushCtx = () => {
      if (!buf.length) return;
      if (buf.length > CTX_COLLAPSE_TRIGGER) {
        out.push({
          kind: "fold",
          full: buf,
          head: buf.slice(0, CTX_COLLAPSE_KEEP),
          tail: buf.slice(buf.length - CTX_COLLAPSE_KEEP),
        });
      } else {
        for (const r of buf) pushInline(r);
      }
      buf = [];
    };
    for (const r of props.hunk.rows) {
      if (isCtxRow(r)) buf.push(r);
      else {
        flushCtx();
        pushInline(r);
      }
    }
    flushCtx();
    return out;
  });

  const renderRow = (r: import("./parseDiff").SbsRow) => (
    <div class="grid grid-cols-2 gap-px bg-border-subtle/40">
      <div class="overflow-x-auto bg-codeBg">
        <Show
          when={r.left}
          fallback={<div class="pl-2.5 text-text-muted/40 select-none">&nbsp;</div>}
        >
          {(ln) => (
            <div class={SIDE_CLASS[ln().kind]}>
              <span class="whitespace-pre">{ln().text || " "}</span>
            </div>
          )}
        </Show>
      </div>
      <div class="overflow-x-auto bg-codeBg">
        <Show
          when={r.right}
          fallback={<div class="pl-2.5 text-text-muted/40 select-none">&nbsp;</div>}
        >
          {(ln) => (
            <div class={SIDE_CLASS[ln().kind]}>
              <span class="whitespace-pre">{ln().text || " "}</span>
            </div>
          )}
        </Show>
      </div>
    </div>
  );

  return (
    <For each={segs()}>
      {(seg) => (
        <Show
          when={seg.kind === "fold"}
          fallback={
            <For each={(seg as InlineRows).rows}>{(r) => renderRow(r)}</For>
          }
        >
          <FoldedSbs seg={seg as FoldRows} renderRow={renderRow} />
        </Show>
      )}
    </For>
  );
}

/* ---------- Fold controls ---------- */

function FoldedCtx(props: {
  seg: FoldSeg;
  renderLine: (ln: DLine) => JSX.Element;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const hiddenCount = () => props.seg.full.length - props.seg.head.length - props.seg.tail.length;
  return (
    <Show
      when={open()}
      fallback={
        <>
          <For each={props.seg.head}>{(ln) => props.renderLine(ln)}</For>
          <button
            type="button"
            onClick={() => setOpen(true)}
            class="w-full text-left px-2 py-1 my-0.5 text-[11px] font-sans text-text-muted bg-bg-surface hover:bg-bg-surfaceStrong border-y border-border-subtle transition"
            aria-label={`展开 ${hiddenCount()} 行未改动内容`}
          >
            ⋯ {hiddenCount()} 行未改动 · 点击展开
          </button>
          <For each={props.seg.tail}>{(ln) => props.renderLine(ln)}</For>
        </>
      }
    >
      <For each={props.seg.full}>{(ln) => props.renderLine(ln)}</For>
      <button
        type="button"
        onClick={() => setOpen(false)}
        class="w-full text-left px-2 py-1 my-0.5 text-[11px] font-sans text-text-muted bg-bg-surface hover:bg-bg-surfaceStrong border-y border-border-subtle transition"
      >
        ▲ 折叠未改动内容
      </button>
    </Show>
  );
}

function FoldedSbs(props: {
  seg: {
    full: import("./parseDiff").SbsRow[];
    head: import("./parseDiff").SbsRow[];
    tail: import("./parseDiff").SbsRow[];
  };
  renderRow: (r: import("./parseDiff").SbsRow) => JSX.Element;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const hiddenCount = () => props.seg.full.length - props.seg.head.length - props.seg.tail.length;
  return (
    <Show
      when={open()}
      fallback={
        <>
          <For each={props.seg.head}>{(r) => props.renderRow(r)}</For>
          <button
            type="button"
            onClick={() => setOpen(true)}
            class="w-full text-left px-2 py-1 my-0.5 text-[11px] font-sans text-text-muted bg-bg-surface hover:bg-bg-surfaceStrong border-y border-border-subtle transition"
            aria-label={`展开 ${hiddenCount()} 行未改动内容`}
          >
            ⋯ {hiddenCount()} 行未改动 · 点击展开
          </button>
          <For each={props.seg.tail}>{(r) => props.renderRow(r)}</For>
        </>
      }
    >
      <For each={props.seg.full}>{(r) => props.renderRow(r)}</For>
      <button
        type="button"
        onClick={() => setOpen(false)}
        class="w-full text-left px-2 py-1 my-0.5 text-[11px] font-sans text-text-muted bg-bg-surface hover:bg-bg-surfaceStrong border-y border-border-subtle transition"
      >
        ▲ 折叠未改动内容
      </button>
    </Show>
  );
}

export default DiffBlock;
