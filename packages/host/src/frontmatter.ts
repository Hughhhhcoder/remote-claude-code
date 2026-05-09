/**
 * Minimal YAML-ish frontmatter parser. Only supports the subset Claude Code
 * uses in .md files: top-level `key: value` pairs, plus folded scalars
 * (`description: >` followed by indented lines) for long descriptions.
 * Intentionally dependency-free.
 */
export interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

export function parseFrontmatter(raw: string): Frontmatter {
  const text = raw.replace(/^﻿/, "");
  if (!text.startsWith("---")) {
    return { data: {}, body: text };
  }
  // Find end marker. First line is the opening ---
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { data: {}, body: text };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { data: {}, body: text };
  }
  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\r?\n/, "");
  const data = parseFmBlock(fmLines);
  return { data, body };
}

function parseFmBlock(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const m = /^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    let value = m[2] ?? "";
    // folded / literal scalar: collect following indented lines
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const fold = value.startsWith(">");
      i++;
      const collected: string[] = [];
      while (i < lines.length) {
        const next = lines[i]!;
        if (/^\S/.test(next) && next.trim() !== "") break;
        collected.push(next.replace(/^\s+/, ""));
        i++;
      }
      out[key] = fold ? collected.join(" ").replace(/\s+/g, " ").trim() : collected.join("\n").trim();
      continue;
    }
    // strip matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value.trim();
    i++;
  }
  return out;
}

export function stringifyFrontmatter(
  data: Record<string, string | undefined | null>,
  body: string,
): string {
  const entries = Object.entries(data).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) {
    return body.endsWith("\n") ? body : body + "\n";
  }
  const lines = ["---"];
  for (const [k, v] of entries) {
    const str = String(v);
    if (str.includes("\n")) {
      lines.push(`${k}: |`);
      for (const l of str.split(/\r?\n/)) lines.push(`  ${l}`);
    } else if (/[:#"'{}\[\]&*!|>%@`]/.test(str) || str.length > 120) {
      // quote anything gnarly
      lines.push(`${k}: "${str.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${k}: ${str}`);
    }
  }
  lines.push("---");
  const out = lines.join("\n") + "\n" + (body.startsWith("\n") ? body.slice(1) : body);
  return out.endsWith("\n") ? out : out + "\n";
}
