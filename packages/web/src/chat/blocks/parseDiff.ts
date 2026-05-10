/**
 * parseDiff — unified-diff parser shared by DiffBlock's unified and
 * side-by-side renderers. Best-effort, not a full patch-utils replacement.
 *
 * Output model:
 * - `lines`: flat sequence of classified lines (for unified rendering)
 * - `hunks`: segmentation into `@@` groups, each with a list of row-pairs
 *   aligned for side-by-side rendering. Context lines appear in both
 *   columns; additions appear only right; deletions only left. Adjacent
 *   del+add runs are paired 1:1 when possible, with blanks filling the
 *   shorter side.
 */

export type LineKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DLine {
  kind: LineKind;
  text: string;
}

/** A single side-by-side row. `left` / `right` null means blank padding. */
export interface SbsRow {
  left: DLine | null;
  right: DLine | null;
}

export interface Hunk {
  /** Header line (e.g. `@@ -1,5 +1,7 @@`), may be empty for pre-hunk preamble. */
  header: string;
  /** Flat lines inside this hunk (unified-style), excluding the header. */
  lines: DLine[];
  /** Paired rows for side-by-side rendering. */
  rows: SbsRow[];
}

export interface Parsed {
  lines: DLine[];
  hunks: Hunk[];
  added: number;
  removed: number;
  parsedPath: string | null;
}

/**
 * Pair a consecutive del-run and add-run into aligned side-by-side rows.
 * If the runs have different lengths, the shorter side is padded with
 * blank rows so vertical alignment is preserved.
 */
function pairRuns(dels: DLine[], adds: DLine[]): SbsRow[] {
  const rows: SbsRow[] = [];
  const n = Math.max(dels.length, adds.length);
  for (let i = 0; i < n; i++) {
    rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
  }
  return rows;
}

function buildSbsRows(lines: DLine[]): SbsRow[] {
  const rows: SbsRow[] = [];
  let delBuf: DLine[] = [];
  let addBuf: DLine[] = [];

  const flush = () => {
    if (delBuf.length || addBuf.length) {
      rows.push(...pairRuns(delBuf, addBuf));
      delBuf = [];
      addBuf = [];
    }
  };

  for (const ln of lines) {
    if (ln.kind === "del") {
      delBuf.push(ln);
    } else if (ln.kind === "add") {
      addBuf.push(ln);
    } else {
      flush();
      if (ln.kind === "ctx") {
        rows.push({ left: ln, right: ln });
      } else {
        // meta/hunk inside a hunk body is unusual; render as ctx-like on both.
        rows.push({ left: ln, right: ln });
      }
    }
  }
  flush();
  return rows;
}

export function parseDiff(src: string): Parsed {
  const lines: DLine[] = [];
  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;
  let parsedPath: string | null = null;

  // Start with a synthetic "preamble" hunk so meta-only diffs still have a bucket.
  let current: Hunk = { header: "", lines: [], rows: [] };
  const pushCurrent = () => {
    // Build SBS rows on close.
    current.rows = buildSbsRows(current.lines);
    hunks.push(current);
  };

  const raw = src.split("\n");
  for (const line of raw) {
    if (line.startsWith("@@")) {
      pushCurrent();
      current = { header: line, lines: [], rows: [] };
      lines.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+++")) {
      const m = line.match(/^\+\+\+\s+b\/(.+?)\s*$/);
      if (m && !parsedPath) parsedPath = m[1];
      const dl: DLine = { kind: "meta", text: line };
      lines.push(dl);
      current.lines.push(dl);
    } else if (
      line.startsWith("---") ||
      line.startsWith("diff --git") ||
      line.startsWith("index ")
    ) {
      const dl: DLine = { kind: "meta", text: line };
      lines.push(dl);
      current.lines.push(dl);
    } else if (line.startsWith("+")) {
      added++;
      const dl: DLine = { kind: "add", text: line.slice(1) };
      lines.push(dl);
      current.lines.push(dl);
    } else if (line.startsWith("-")) {
      removed++;
      const dl: DLine = { kind: "del", text: line.slice(1) };
      lines.push(dl);
      current.lines.push(dl);
    } else {
      const dl: DLine = {
        kind: "ctx",
        text: line.startsWith(" ") ? line.slice(1) : line,
      };
      lines.push(dl);
      current.lines.push(dl);
    }
  }
  pushCurrent();

  return { lines, hunks, added, removed, parsedPath };
}
