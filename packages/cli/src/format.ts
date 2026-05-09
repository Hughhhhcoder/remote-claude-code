const isTTY = Boolean(process.stdout.isTTY);
const useColor = isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";

function wrap(code: string, s: string): string {
  if (!useColor) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

export const color = {
  enabled: useColor,
  dim: (s: string) => wrap("2", s),
  bold: (s: string) => wrap("1", s),
  red: (s: string) => wrap("31", s),
  green: (s: string) => wrap("32", s),
  yellow: (s: string) => wrap("33", s),
  blue: (s: string) => wrap("34", s),
  magenta: (s: string) => wrap("35", s),
  cyan: (s: string) => wrap("36", s),
  gray: (s: string) => wrap("90", s),
};

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(s: string, width: number): string {
  const len = visibleLen(s);
  if (len >= width) return s;
  return s + " ".repeat(width - len);
}

export interface Column<T> {
  header: string;
  get: (row: T) => string;
}

export function renderTable<T>(rows: T[], cols: Column<T>[]): string {
  if (rows.length === 0) {
    return color.dim("(empty)");
  }
  const widths = cols.map((c) => visibleLen(c.header));
  const cells: string[][] = [];
  for (const r of rows) {
    const row: string[] = [];
    for (let i = 0; i < cols.length; i++) {
      const v = cols[i]!.get(r);
      row.push(v);
      const w = visibleLen(v);
      if (w > widths[i]!) widths[i] = w;
    }
    cells.push(row);
  }
  const out: string[] = [];
  out.push(cols.map((c, i) => color.bold(pad(c.header, widths[i]!))).join("  "));
  out.push(cols.map((_, i) => color.dim("-".repeat(widths[i]!))).join("  "));
  for (const row of cells) {
    out.push(row.map((v, i) => pad(v, widths[i]!)).join("  "));
  }
  return out.join("\n");
}

export function statusColor(s: string | undefined | null): string {
  const v = (s ?? "").toLowerCase();
  if (v === "running" || v === "ok") return color.green(v || "?");
  if (v === "exited") return color.yellow(v);
  if (v === "error" || v === "failed") return color.red(v);
  return v || color.dim("?");
}

export function roleColor(role: string): string {
  if (role === "user") return color.cyan(role);
  if (role === "assistant") return color.green(role);
  if (role === "system") return color.dim(role);
  return role;
}

export function kindColor(kind: string): string {
  if (kind === "tool_use") return color.yellow(kind);
  if (kind === "tool_result") return color.magenta(kind);
  if (kind === "thinking") return color.gray(kind);
  if (kind === "code") return color.blue(kind);
  if (kind === "diff") return color.cyan(kind);
  return kind;
}

export function printJson(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
}
