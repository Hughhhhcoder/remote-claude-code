import { createMemo, createSignal, createUniqueId, For, Show, type JSX } from "solid-js";
import { detectLanguage } from "./detectLanguage";
import { useTouchGestures, hasTouchCapability } from "../../hooks/useTouchGestures.ts";

/**
 * CodeBlock — fenced code segment with a header strip (language + actions) and
 * a tokenizer-lite syntax highlighter. No external deps; handles strings,
 * numbers, keywords, and comments for a small set of languages.
 *
 * Long content (>30 lines) is collapsed by default to 24 lines with a fade
 * overlay and a "展开全部" toggle. Boundary: exactly 30 lines stays expanded.
 *
 * Header actions (left → right):
 *   [lang label]    [↗ open file?]  [# line numbers]  [copy]
 *
 * When `lang` is missing we call `detectLanguage` — conservative heuristics,
 * fallback "text". When `filePath` is present a ↗ icon fires a `rcc:open-file`
 * CustomEvent that a file browser can listen for.
 */

const CODE_COLLAPSE_TRIGGER = 30;
const CODE_COLLAPSE_SHOW = 24;

export interface CodeBlockProps {
  content: string;
  lang?: string;
  /** When true, show a copy button in the block header. Default true. */
  copyable?: boolean;
  /** Force initial collapsed state. Default true if content exceeds threshold. */
  forceCollapsed?: boolean;
  /**
   * Optional file path associated with this block. When set, a small ↗ icon
   * is rendered in the header; clicking fires `rcc:open-file` with the path
   * so a file browser can open it. Kept optional to preserve existing callers.
   */
  filePath?: string;
  /** When true, show line numbers by default. User can toggle via `#`. */
  showLineNumbers?: boolean;
}

type TokKind = "text" | "str" | "num" | "kw" | "com" | "fn";
interface Tok { kind: TokKind; text: string }

const KEYWORDS: Record<string, Set<string>> = {
  ts: new Set(["const","let","var","function","class","interface","type","import","export","from","as","if","else","for","while","return","async","await","new","extends","implements","public","private","protected","readonly","static","void","any","unknown","never","true","false","null","undefined"]),
  py: new Set(["def","class","if","elif","else","for","while","return","import","from","as","pass","None","True","False","and","or","not","in","is","lambda","try","except","finally","raise","with","yield","async","await","self"]),
  go: new Set(["package","import","func","type","struct","interface","const","var","if","else","for","range","return","go","defer","chan","map","select","switch","case","break","continue","nil","true","false"]),
  rs: new Set(["fn","let","mut","const","struct","enum","impl","trait","pub","use","mod","if","else","match","for","while","loop","return","async","await","self","Self","true","false","None","Some","Ok","Err"]),
  sh: new Set(["if","then","else","fi","for","do","done","while","in","case","esac","function","return","local","export","source","echo"]),
  json: new Set(["true","false","null"]),
};

function normaliseLang(lang: string | undefined): string {
  const l = (lang ?? "").toLowerCase();
  if (l === "tsx" || l === "jsx" || l === "js") return "ts";
  if (l === "bash") return "sh";
  return l;
}

const isIdentStart = (ch: string) => /[A-Za-z_$]/.test(ch);
const isIdent = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

/**
 * Walk char-by-char and emit tokens. Best-effort: escape-aware for quoted
 * strings; backtick template strings are treated as plain string literals
 * without interpolating ${} expressions.
 */
function tokenize(src: string, lang: string): Tok[] {
  const norm = normaliseLang(lang);
  const kw = KEYWORDS[norm];
  if (!kw) return [{ kind: "text", text: src }];
  const linePrefix = norm === "py" || norm === "sh" ? "#" : norm === "json" ? null : "//";
  const hasBlock = norm === "ts" || norm === "go" || norm === "rs";

  const out: Tok[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ kind: "text", text: buf }); buf = ""; } };
  const push = (t: Tok) => { flush(); out.push(t); };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = i + 1 < n ? src[i + 1] : "";

    if (linePrefix && src.startsWith(linePrefix, i)) {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      push({ kind: "com", text: src.slice(i, j) });
      i = j; continue;
    }
    if (hasBlock && ch === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      push({ kind: "com", text: src.slice(i, j) });
      i = j; continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\" && j + 1 < n) { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      push({ kind: "str", text: src.slice(i, j) });
      i = j; continue;
    }
    if (isDigit(ch) || (ch === "." && isDigit(next))) {
      let j = i;
      while (j < n && /[0-9._eE+\-]/.test(src[j])) {
        if ((src[j] === "+" || src[j] === "-") && j > i) {
          const prev = src[j - 1];
          if (prev !== "e" && prev !== "E") break;
        }
        j++;
      }
      push({ kind: "num", text: src.slice(i, j) });
      i = j; continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdent(src[j])) j++;
      const word = src.slice(i, j);
      if (kw.has(word)) push({ kind: "kw", text: word });
      else buf += word;
      i = j; continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const COLOR: Record<TokKind, string> = {
  str: "text-success",
  num: "text-warn",
  kw: "text-accent",
  com: "text-text-muted italic",
  fn: "text-text-primary",
  text: "",
};

/**
 * Split the token stream along `\n` boundaries so we can render one visual
 * line per source line. Tokens that themselves contain newlines (block
 * comments, template strings) are split into per-line fragments preserving
 * their token kind — the gutter still lines up.
 */
function splitTokensByLine(tokens: Tok[]): Tok[][] {
  const lines: Tok[][] = [[]];
  for (const tok of tokens) {
    if (!tok.text.includes("\n")) {
      lines[lines.length - 1].push(tok);
      continue;
    }
    const parts = tok.text.split("\n");
    for (let k = 0; k < parts.length; k++) {
      if (parts[k]) lines[lines.length - 1].push({ kind: tok.kind, text: parts[k] });
      if (k < parts.length - 1) lines.push([]);
    }
  }
  return lines;
}

function emitOpenFile(path: string): void {
  try {
    window.dispatchEvent(new CustomEvent("rcc:open-file", { detail: { path } }));
  } catch {
    /* non-browser env — safe to ignore */
  }
}

export function CodeBlock(props: CodeBlockProps): JSX.Element {
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

  const totalLines = createMemo(() => props.content.split("\n").length);
  const shouldCollapse = () => totalLines() > CODE_COLLAPSE_TRIGGER;
  const initialCollapsed = () =>
    props.forceCollapsed !== undefined ? props.forceCollapsed : shouldCollapse();
  const [collapsed, setCollapsed] = createSignal(initialCollapsed());
  const bodyId = createUniqueId();

  // Resolved language: explicit prop wins, then heuristic detection, then "text".
  const resolvedLang = createMemo<string>(() => {
    if (props.lang && props.lang.trim().length > 0) return props.lang;
    return detectLanguage(props.content);
  });

  const [lineNumbers, setLineNumbers] = createSignal(props.showLineNumbers === true);

  const visibleContent = () => {
    if (!collapsed()) return props.content;
    const lines = props.content.split("\n");
    return lines.slice(0, CODE_COLLAPSE_SHOW).join("\n");
  };

  // Tokens — produced once per (content, lang) pair; then split into rows so
  // the gutter can render matching line numbers without a second pass.
  const tokenLines = createMemo(() => splitTokensByLine(tokenize(visibleContent(), resolvedLang())));

  // Width of the gutter — at least 1ch, scales with line count so collapsing /
  // expanding a 100+ line block doesn't shift the code to the left.
  const gutterDigits = createMemo(() => Math.max(1, String(totalLines()).length));

  const showCopy = () => props.copyable !== false;
  const showFileLink = () => typeof props.filePath === "string" && props.filePath.length > 0;

  // [B29-A] Pinch-to-zoom on touch devices — two-finger pinch on the <pre>
  // scales font-size within [12, 20]px. Gated by coarse-pointer so desktop
  // text selection is untouched; single-finger drags are ignored inside the
  // hook. Font-size is per-block session state (no host roundtrip).
  const touchEnabled = hasTouchCapability();
  const pinch = useTouchGestures({ min: 12, max: 20, initial: 13 });

  return (
    <div class="my-3 rounded-md border border-border-subtle bg-codeBg overflow-hidden">
      <div class="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border-subtle bg-bg-surface text-[11px] font-mono text-text-muted">
        <span class="truncate">{resolvedLang()}</span>
        <div class="flex items-center gap-1">
          <Show when={showFileLink()}>
            <button
              type="button"
              onClick={() => emitOpenFile(props.filePath as string)}
              title={`打开 ${props.filePath}`}
              aria-label={`打开 ${props.filePath}`}
              class="font-sans text-[11px] px-1.5 py-0.5 rounded hover:bg-bg-surfaceStrong text-text-muted hover:text-text-primary transition duration-fast ease-rcc"
            >
              ↗
            </button>
          </Show>
          <button
            type="button"
            onClick={() => setLineNumbers((v) => !v)}
            title={lineNumbers() ? "隐藏行号" : "显示行号"}
            aria-label={lineNumbers() ? "隐藏行号" : "显示行号"}
            aria-pressed={lineNumbers()}
            class="font-sans text-[11px] px-1.5 py-0.5 rounded hover:bg-bg-surfaceStrong transition duration-fast ease-rcc"
            classList={{
              "text-accent": lineNumbers(),
              "text-text-muted hover:text-text-primary": !lineNumbers(),
            }}
          >
            #
          </button>
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
        <pre
          class="overflow-x-auto p-3 leading-[1.6] font-mono"
          style={{
            "font-size": `${pinch.fontSize()}px`,
            "touch-action": touchEnabled ? "pinch-zoom" : undefined,
          }}
          onPointerDown={touchEnabled ? pinch.onPointerDown : undefined}
          onPointerMove={touchEnabled ? pinch.onPointerMove : undefined}
          onPointerUp={touchEnabled ? pinch.onPointerUp : undefined}
          onPointerCancel={touchEnabled ? pinch.onPointerUp : undefined}
        >
          <code>
            <Show
              when={lineNumbers()}
              fallback={
                <For each={tokenLines()}>
                  {(line, idx) => (
                    <>
                      <For each={line}>
                        {(tok) => (
                          <Show when={tok.kind !== "text"} fallback={<span>{tok.text}</span>}>
                            <span class={COLOR[tok.kind]}>{tok.text}</span>
                          </Show>
                        )}
                      </For>
                      <Show when={idx() < tokenLines().length - 1}>{"\n"}</Show>
                    </>
                  )}
                </For>
              }
            >
              <For each={tokenLines()}>
                {(line, idx) => (
                  <>
                    <span
                      aria-hidden="true"
                      class="inline-block select-none pr-3 text-right text-text-muted tabular-nums"
                      style={{ "min-width": `${gutterDigits()}ch` }}
                    >
                      {idx() + 1}
                    </span>
                    <For each={line}>
                      {(tok) => (
                        <Show when={tok.kind !== "text"} fallback={<span>{tok.text}</span>}>
                          <span class={COLOR[tok.kind]}>{tok.text}</span>
                        </Show>
                      )}
                    </For>
                    <Show when={idx() < tokenLines().length - 1}>{"\n"}</Show>
                  </>
                )}
              </For>
            </Show>
          </code>
        </pre>
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
  );
}

export default CodeBlock;
