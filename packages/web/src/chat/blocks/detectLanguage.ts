/**
 * detectLanguage — conservative best-guess language detection for fenced code
 * blocks where the author omitted the info-string. Returns "text" on any
 * ambiguity; false positives are worse than no detection because they drive
 * the tokenizer down the wrong keyword set.
 *
 * Detection is purely lexical (string / regex contains) on the first handful
 * of non-blank lines. No external deps, no ML — just obvious fingerprints.
 *
 * Supported: ts, tsx, js, py, go, rs, sh, json, yaml, html, css, sql, md.
 * The returned value is a short identifier compatible with CodeBlock's
 * tokenizer's `normaliseLang`.
 */

export type DetectedLang =
  | "ts"
  | "tsx"
  | "js"
  | "py"
  | "go"
  | "rs"
  | "sh"
  | "json"
  | "yaml"
  | "html"
  | "css"
  | "sql"
  | "md"
  | "text";

/** Peek the first N non-blank lines — enough for a shebang or package decl. */
function head(src: string, n = 12): string {
  const lines = src.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (kept.length >= n) break;
    if (line.trim().length === 0 && kept.length === 0) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

/** Score-based match — each signal adds 1; winner must beat "text" by ≥2. */
interface LangScore { lang: DetectedLang; score: number }

export function detectLanguage(src: string): DetectedLang {
  if (!src || src.trim().length === 0) return "text";
  const h = head(src);
  const full = src;

  // --- Unambiguous prefixes (return immediately) ------------------------------
  // Python / bash / node shebangs.
  if (/^#!\s*\/usr\/bin\/env\s+python/.test(h) || /^#!\s*\/usr\/bin\/python/.test(h)) return "py";
  if (/^#!\s*\/usr\/bin\/env\s+(bash|sh|zsh)/.test(h) || /^#!\s*\/(bin|usr\/bin)\/(bash|sh|zsh)/.test(h)) return "sh";
  if (/^#!\s*\/usr\/bin\/env\s+node/.test(h)) return "js";

  // JSON: starts with `{` or `[`, whole thing parses.
  const trimmed = full.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { JSON.parse(trimmed); return "json"; } catch { /* fallthrough */ }
  }

  // --- Scored heuristics ------------------------------------------------------
  const scores: LangScore[] = [];
  const bump = (lang: DetectedLang, by = 1) => {
    const hit = scores.find((s) => s.lang === lang);
    if (hit) hit.score += by; else scores.push({ lang, score: by });
  };

  // Go — `package X` + `func ` + `fmt.Println` is an iconic combo.
  if (/^package\s+[a-z_][a-z0-9_]*\s*$/m.test(h)) bump("go", 2);
  if (/\bfunc\s+[A-Za-z_]\w*\s*\(/.test(full)) bump("go");
  if (/\bfmt\.(Println|Printf|Sprintf|Errorf)\b/.test(full)) bump("go", 2);
  if (/^import\s*\(/m.test(h)) bump("go");

  // Rust — `fn name(` plus `->` return arrow, `let mut`, or `::` paths.
  if (/\bfn\s+[a-z_]\w*\s*\(/.test(full) && /->/.test(full)) bump("rs", 2);
  if (/\blet\s+mut\b/.test(full)) bump("rs", 2);
  if (/\bimpl\s+[A-Z]\w*(\s+for\s+[A-Z]\w*)?/.test(full)) bump("rs", 2);
  if (/\buse\s+[a-z_]\w*::/.test(full)) bump("rs");
  if (/!\s*\(/.test(full) && /\bprintln!|\bvec!|\bformat!/.test(full)) bump("rs", 2);

  // Python — `def name(:` / `import x` at column 0 / f-strings.
  if (/^def\s+[a-z_]\w*\s*\(/m.test(full)) bump("py", 2);
  if (/^class\s+[A-Z]\w*(\([^)]*\))?\s*:/m.test(full)) bump("py", 2);
  if (/^from\s+[\w.]+\s+import\b/m.test(full)) bump("py", 2);
  if (/\bprint\s*\(/.test(full) && /:\s*$/m.test(full)) bump("py");
  if (/\b(True|False|None)\b/.test(full)) bump("py");
  if (/\bself\b/.test(full) && /\bdef\b/.test(full)) bump("py");

  // TypeScript / TSX — `:type` annotations, `interface`, `as const`.
  if (/\binterface\s+[A-Z]\w*/.test(full)) bump("ts", 2);
  if (/\btype\s+[A-Z]\w*\s*=/.test(full)) bump("ts", 2);
  if (/:\s*(string|number|boolean|void|any|unknown|never)\b/.test(full)) bump("ts", 2);
  if (/\bas\s+(const|[A-Z]\w*)\b/.test(full)) bump("ts");
  if (/\bimport\s+.*\s+from\s+['"][^'"]+['"]/.test(full)) bump("ts");
  if (/\bexport\s+(default|const|function|class|type|interface)\b/.test(full)) bump("ts");

  // TSX / JSX — tag-like `<Component` and `/>` self-closing + import.
  const hasTag = /<[A-Z]\w*[\s/>]/.test(full) || /<\/[A-Z]\w*>/.test(full);
  const hasSelfClose = /\/>/.test(full);
  if (hasTag && hasSelfClose && /\bimport\b/.test(full)) bump("tsx", 3);

  // Shell — `$(`, `${`, `|` pipes, common commands at line start.
  if (/^\s*(echo|export|cd|ls|mkdir|rm|cp|mv|grep|awk|sed|curl|wget|cat)\s/m.test(full)) bump("sh");
  if (/\$\([^)]+\)/.test(full) || /\$\{[^}]+\}/.test(full)) bump("sh");
  if (/^\s*if\s*\[\[?/m.test(full) || /^\s*fi\s*$/m.test(full)) bump("sh", 2);

  // YAML — `key:` at column 0 plus list-item dashes.
  const yamlKeys = (h.match(/^[a-zA-Z_][\w-]*:\s*(.*)$/gm) || []).length;
  if (yamlKeys >= 2 && !/[{};]/.test(h)) bump("yaml", 2);
  if (/^-\s+\w/m.test(h) && yamlKeys >= 1) bump("yaml");

  // HTML — `<!DOCTYPE` / `<html` / `</div>` style tags.
  if (/<!DOCTYPE\s+html/i.test(h)) bump("html", 3);
  if (/<html[\s>]/i.test(h) || /<body[\s>]/i.test(h) || /<\/(div|span|p|a|ul|li|section)>/.test(full)) bump("html");

  // CSS — selector { prop: val; }
  if (/^[.#]?[\w-]+\s*\{[^}]*[\w-]+\s*:\s*[^;]+;/m.test(full)) bump("css", 2);
  if (/@media\s*\(/.test(full) || /@keyframes\s+/.test(full)) bump("css", 2);

  // SQL — case-insensitive keywords at the front of a statement.
  if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(full)) bump("sql", 2);
  if (/\bFROM\s+\w+/i.test(full) && /\bWHERE\b/i.test(full)) bump("sql");

  // Markdown — headings + fence / list markers.
  if (/^#{1,6}\s+\S/m.test(h) && (/^[-*]\s+\S/m.test(h) || /^```/m.test(full))) bump("md", 2);

  if (scores.length === 0) return "text";
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const runnerUp = scores[1]?.score ?? 0;
  // Conservative: need ≥2 points and a clear margin (≥2 over next, or unique).
  if (best.score < 2) return "text";
  if (best.score - runnerUp < 2 && runnerUp !== 0) return "text";
  return best.lang;
}

export default detectLanguage;
