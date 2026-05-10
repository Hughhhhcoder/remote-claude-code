import { createSignal, For, Show, type JSX } from "solid-js";

/**
 * CodeBlock — fenced code segment with a header strip (language + copy) and
 * a tokenizer-lite syntax highlighter. No external deps; handles strings,
 * numbers, keywords, and comments for a small set of languages.
 */

export interface CodeBlockProps {
  content: string;
  lang?: string;
  /** When true, show a copy button in the block header. Default true. */
  copyable?: boolean;
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

  const tokens = () => tokenize(props.content, props.lang ?? "");
  const showCopy = () => props.copyable !== false;

  return (
    <div class="my-3 rounded-md border border-border-subtle bg-codeBg overflow-hidden">
      <div class="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-bg-surface text-[11px] font-mono text-text-muted">
        <span>{props.lang ?? "text"}</span>
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
      <pre class="overflow-x-auto p-3 text-[13px] leading-[1.6] font-mono">
        <code>
          <For each={tokens()}>
            {(tok) => (
              <Show when={tok.kind !== "text"} fallback={<span>{tok.text}</span>}>
                <span class={COLOR[tok.kind]}>{tok.text}</span>
              </Show>
            )}
          </For>
        </code>
      </pre>
    </div>
  );
}

export default CodeBlock;
