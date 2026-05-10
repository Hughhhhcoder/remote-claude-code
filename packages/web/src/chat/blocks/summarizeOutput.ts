/**
 * summarizeOutput — classifiers and formatters used by ToolCallBlock /
 * ToolResultBlock to render large tool outputs compactly.
 *
 * Five shapes are recognized:
 *  - "error"   — isError=true from tool_result; collapse by default, show
 *                a "查看 {N} 行 stderr" button.
 *  - "json"    — starts with `{` or `[` and parses; supports a "仅看顶层键"
 *                toggle returning top-level keys + value types.
 *  - "dirlist" — lines starting with -rwx / drwx; report counts by type.
 *  - "grep"    — `path:line:…` lines; group by file path, show top 5 with
 *                hit counts.
 *  - "text"    — everything else; head/tail slicing.
 *
 * Thresholds: output is considered "large" when it exceeds 8 KiB or 100
 * lines. For large non-error outputs we show the first 20 + last 10 lines
 * with an expandable divider.
 */

export const LARGE_BYTES = 8 * 1024;
export const LARGE_LINES = 100;
export const HEAD_LINES = 20;
export const TAIL_LINES = 10;

export type OutputKind = "error" | "json" | "dirlist" | "grep" | "text";

export interface OutputSummary {
  /** Classified kind. */
  kind: OutputKind;
  /** Total line count of the original content. */
  totalLines: number;
  /** Byte size (UTF-8 code units ≈ content.length). */
  totalBytes: number;
  /** True when total crosses LARGE_BYTES / LARGE_LINES. */
  isLarge: boolean;
  /** Head/tail split (text + non-matching fallbacks). */
  head: string[];
  tail: string[];
  /** How many lines are elided between head and tail (0 when !isLarge). */
  hiddenLines: number;
  /** Populated when kind === "json" and parsing succeeds. */
  json?: { pretty: string; topKeys: JsonTopKey[] };
  /** Populated when kind === "dirlist". */
  dir?: { files: number; dirs: number; links: number; other: number };
  /** Populated when kind === "grep"; sorted by count desc, top 5. */
  grep?: GrepGroup[];
}

export interface JsonTopKey {
  key: string;
  type: "string" | "number" | "boolean" | "null" | "array" | "object";
  /** Number of items for array/object, length for string, stringified otherwise. */
  hint: string;
}

export interface GrepGroup {
  path: string;
  count: number;
  /** First few matching lines for lazy expansion. Full list kept separately. */
  matches: string[];
}

// ---------------------------------------------------------------------------
// Classifiers
// ---------------------------------------------------------------------------

/** Trim-light check: first non-empty char is `{` or `[`, and JSON.parse works. */
export function classifyJson(content: string): unknown | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** ls -l style: at least 60% of non-empty lines start with [-dlbcps][rwx-]. */
export function classifyDirlist(lines: string[]): boolean {
  const nonEmpty = lines.filter((l) => l.length > 0);
  if (nonEmpty.length < 3) return false;
  // First 40 lines is plenty; ls total header allowed.
  const sample = nonEmpty.slice(0, 40);
  let hits = 0;
  for (const l of sample) {
    // -rwxr-xr-x, drwx…, lrwx…, etc. 10 chars of mode.
    if (/^[-dlbcps][rwxstST-]{9}\b/.test(l)) hits += 1;
  }
  return hits / sample.length >= 0.6;
}

/** Grep / ripgrep style: path:lineno:content. At least 60% match pattern. */
export function classifyGrep(lines: string[]): boolean {
  const nonEmpty = lines.filter((l) => l.length > 0);
  if (nonEmpty.length < 3) return false;
  const sample = nonEmpty.slice(0, 40);
  const re = /^[^\s:]+?:\d+:/;
  let hits = 0;
  for (const l of sample) if (re.test(l)) hits += 1;
  return hits / sample.length >= 0.6;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function jsonTypeOf(v: unknown): JsonTopKey["type"] {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") {
    return t as JsonTopKey["type"];
  }
  return "null";
}

function jsonHint(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") {
    const n = Object.keys(v as Record<string, unknown>).length;
    return `{${n}}`;
  }
  if (typeof v === "string") return `"${v.length} chars"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function collectTopKeys(value: unknown): JsonTopKey[] {
  if (Array.isArray(value)) {
    // Arrays: synthesize [0], [1], …, cap at 20.
    const out: JsonTopKey[] = [];
    const n = Math.min(value.length, 20);
    for (let i = 0; i < n; i += 1) {
      const v = value[i];
      out.push({ key: `[${i}]`, type: jsonTypeOf(v), hint: jsonHint(v) });
    }
    return out;
  }
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return Object.keys(rec)
      .slice(0, 50)
      .map((key) => ({ key, type: jsonTypeOf(rec[key]), hint: jsonHint(rec[key]) }));
  }
  return [];
}

function countDirEntries(lines: string[]): {
  files: number;
  dirs: number;
  links: number;
  other: number;
} {
  let files = 0;
  let dirs = 0;
  let links = 0;
  let other = 0;
  for (const l of lines) {
    if (l.length === 0) continue;
    const c = l[0];
    if (c === "-") files += 1;
    else if (c === "d") dirs += 1;
    else if (c === "l") links += 1;
    else if (c === "b" || c === "c" || c === "p" || c === "s") other += 1;
  }
  return { files, dirs, links, other };
}

function groupGrepByPath(lines: string[]): GrepGroup[] {
  const map = new Map<string, { count: number; matches: string[] }>();
  const re = /^([^\s:]+?):\d+:/;
  for (const l of lines) {
    const m = l.match(re);
    if (!m) continue;
    const path = m[1];
    const entry = map.get(path);
    if (entry) {
      entry.count += 1;
      if (entry.matches.length < 10) entry.matches.push(l);
    } else {
      map.set(path, { count: 1, matches: [l] });
    }
  }
  const groups: GrepGroup[] = [];
  for (const [path, v] of map) {
    groups.push({ path, count: v.count, matches: v.matches });
  }
  groups.sort((a, b) => b.count - a.count);
  return groups.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Produce a summary for the given content. `isError` from the tool_result is
 * honored first — errors collapse by default regardless of size/shape.
 */
export function summarize(content: string, isError = false): OutputSummary {
  const raw = content ?? "";
  // Split on any newline variant; retain empty trailing entry only if non-final.
  const lines = raw.length === 0 ? [] : raw.split(/\r?\n/);
  const totalLines = lines.length;
  const totalBytes = raw.length;
  const isLarge = totalBytes > LARGE_BYTES || totalLines > LARGE_LINES;

  // Error short-circuit.
  if (isError) {
    return {
      kind: "error",
      totalLines,
      totalBytes,
      isLarge,
      head: [],
      tail: [],
      hiddenLines: 0,
    };
  }

  // JSON: only try when it looks like it.
  const parsed = classifyJson(raw);
  if (parsed !== null) {
    const pretty = JSON.stringify(parsed, null, 2);
    const prettyLines = pretty.split("\n");
    const large = pretty.length > LARGE_BYTES || prettyLines.length > LARGE_LINES;
    const head = large ? prettyLines.slice(0, HEAD_LINES) : prettyLines;
    const tail = large ? prettyLines.slice(prettyLines.length - TAIL_LINES) : [];
    const hidden = large ? prettyLines.length - head.length - tail.length : 0;
    return {
      kind: "json",
      totalLines: prettyLines.length,
      totalBytes: pretty.length,
      isLarge: large,
      head,
      tail,
      hiddenLines: hidden < 0 ? 0 : hidden,
      json: { pretty, topKeys: collectTopKeys(parsed) },
    };
  }

  // Directory listing.
  if (classifyDirlist(lines)) {
    const dir = countDirEntries(lines);
    const head = isLarge ? lines.slice(0, HEAD_LINES) : lines;
    const tail = isLarge ? lines.slice(lines.length - TAIL_LINES) : [];
    const hidden = isLarge ? lines.length - head.length - tail.length : 0;
    return {
      kind: "dirlist",
      totalLines,
      totalBytes,
      isLarge,
      head,
      tail,
      hiddenLines: hidden < 0 ? 0 : hidden,
      dir,
    };
  }

  // Grep / ripgrep.
  if (classifyGrep(lines)) {
    const grep = groupGrepByPath(lines);
    const head = isLarge ? lines.slice(0, HEAD_LINES) : lines;
    const tail = isLarge ? lines.slice(lines.length - TAIL_LINES) : [];
    const hidden = isLarge ? lines.length - head.length - tail.length : 0;
    return {
      kind: "grep",
      totalLines,
      totalBytes,
      isLarge,
      head,
      tail,
      hiddenLines: hidden < 0 ? 0 : hidden,
      grep,
    };
  }

  // Plain text.
  const head = isLarge ? lines.slice(0, HEAD_LINES) : lines;
  const tail = isLarge ? lines.slice(lines.length - TAIL_LINES) : [];
  const hidden = isLarge ? lines.length - head.length - tail.length : 0;
  return {
    kind: "text",
    totalLines,
    totalBytes,
    isLarge,
    head,
    tail,
    hiddenLines: hidden < 0 ? 0 : hidden,
  };
}

/** Pretty byte formatter for UI hints. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
