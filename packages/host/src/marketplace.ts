import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { writeSkill } from "./skills.ts";
import { addMcp, type McpScope, type McpTransport } from "./mcp.ts";

export type MarketScope = "user" | "project";
export type PluginPerm = "session:read" | "session:write" | "chat:read" | "broadcast";

export interface MarketSkillEntry {
  id: string;
  name: string;
  description: string;
  /** Either "inline" (use `content`) or an HTTPS URL to raw SKILL.md. */
  source: "inline" | string;
  content?: string;
  tags?: string[];
  author?: string;
  homepage?: string;
}

export interface MarketMcpEntry {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  /** For stdio */
  command?: string;
  args?: string[];
  /** For http/sse */
  url?: string;
  envHints?: string[];
  author?: string;
  homepage?: string;
  tags?: string[];
}

export interface MarketPluginSourceInline {
  mode: "inline";
  files: Record<string, string>;
}
export interface MarketPluginSourceTarball {
  mode: "tarball";
  url: string;
}
export type MarketPluginSource = MarketPluginSourceInline | MarketPluginSourceTarball;

export interface MarketPluginEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  entry: string;
  ui?: string;
  permissions: PluginPerm[];
  author?: string;
  homepage?: string;
  tags?: string[];
  source: MarketPluginSource;
}

export interface MarketCatalog {
  skills: MarketSkillEntry[];
  mcps: MarketMcpEntry[];
  plugins: MarketPluginEntry[];
  sources: Array<{ url: string; ok: boolean; error?: string }>;
  fetchedAt: number;
}

interface RawManifest {
  skills?: Partial<MarketSkillEntry>[];
  mcps?: Partial<MarketMcpEntry>[];
  plugins?: Partial<MarketPluginEntry>[];
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_MANIFEST_BYTES = 512 * 1024;

const SEED_SKILLS: MarketSkillEntry[] = [
  {
    id: "rcc/test-writer",
    name: "test-writer",
    author: "rcc",
    description:
      "Writes focused unit tests from a target file. Picks a test framework by scanning package.json.",
    source: "inline",
    tags: ["testing", "quality"],
    content:
      "---\nname: test-writer\ndescription: Writes focused unit tests from a target file. Picks a test framework by scanning package.json.\ntags: testing, quality\n---\n\n# Test Writer\n\nWhen the user asks for tests, follow this flow:\n\n1. Identify the target file and exported symbols.\n2. Detect the test framework from `package.json` (vitest, jest, mocha, node:test).\n3. Create a parallel `*.test.ts` (or matching ext) next to the target.\n4. Cover happy path + 2-3 edge cases per public export.\n5. Keep tests deterministic — no network, no real fs outside tmp.\n6. Run the test command and report failures; iterate until green.\n",
  },
  {
    id: "rcc/commit-message",
    name: "commit-message",
    author: "rcc",
    description: "Produces conventional-commit messages from staged diff.",
    source: "inline",
    tags: ["git", "workflow"],
    content:
      "---\nname: commit-message\ndescription: Produces conventional-commit messages from staged diff.\ntags: git, workflow\n---\n\n# Commit Message\n\nRun `git diff --cached` and generate a one-line subject + optional body.\n\n- Subject: `<type>(<scope>): <summary>` <= 72 chars.\n- types: feat / fix / docs / style / refactor / perf / test / chore.\n- Body (when non-trivial): what & why, not how.\n- Never include Co-Authored-By unless explicitly asked.\n",
  },
  {
    id: "rcc/todo-sweep",
    name: "todo-sweep",
    author: "rcc",
    description: "Finds TODO/FIXME/XXX across the repo and groups them by file.",
    source: "inline",
    tags: ["cleanup", "refactor"],
    content:
      "---\nname: todo-sweep\ndescription: Finds TODO/FIXME/XXX across the repo and groups them by file.\ntags: cleanup, refactor\n---\n\n# TODO Sweep\n\n1. `rg -n '\\b(TODO|FIXME|XXX|HACK)\\b' --hidden --glob '!**/node_modules/**'`.\n2. Group results by file; for each, summarise in one sentence.\n3. Prompt the user: fix now, file an issue, or snooze.\n",
  },
];

const SEED_MCPS: MarketMcpEntry[] = [
  {
    id: "modelcontextprotocol/server-filesystem",
    name: "Filesystem",
    author: "modelcontextprotocol",
    description:
      "Read-only/filtered filesystem access scoped to a directory you pass as an argument.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["files", "official"],
  },
  {
    id: "modelcontextprotocol/server-github",
    name: "GitHub",
    author: "modelcontextprotocol",
    description:
      "GitHub API (issues, PRs, commits). Needs a personal access token with repo scope.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envHints: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["git", "official"],
  },
  {
    id: "modelcontextprotocol/server-memory",
    name: "Memory",
    author: "modelcontextprotocol",
    description: "Ephemeral key-value memory for cross-turn notes.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["memory", "official"],
  },
  {
    id: "modelcontextprotocol/server-fetch",
    name: "Fetch",
    author: "modelcontextprotocol",
    description: "HTTP fetch for the model (markdown-extracted).",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    tags: ["web", "official"],
  },
];

const ECHO_BOT_INDEX_TS = `interface EchoPlugin {
  id: "echo-bot";
  name: string;
  version: string;
  onLoad?: (ctx: { log: (msg: string) => void }) => void;
  handleCall?: (method: string, payload: unknown) => Promise<unknown> | unknown;
}

const plugin: EchoPlugin = {
  id: "echo-bot",
  name: "Echo Bot",
  version: "1.0.0",
  onLoad(ctx) {
    ctx.log("echo-bot loaded");
  },
  async handleCall(method, payload) {
    if (method === "echo") return { echoed: payload, at: Date.now() };
    if (method === "ping") return { pong: true };
    throw new Error(\`unknown method: \${method}\`);
  },
};

export default plugin;
`;

const ECHO_BOT_UI_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Echo Bot</title></head>
<body style="font-family:system-ui;padding:24px;background:#fafafa;color:#111">
  <h1 style="font-size:18px;margin:0 0 12px">Echo Bot</h1>
  <p style="color:#555;font-size:13px">Plugin UI placeholder. Wire your own ws using ?token= from URL.</p>
</body></html>
`;

const TIMER_INDEX_TS = `interface TimerPlugin {
  id: "timer";
  name: string;
  version: string;
  onLoad?: (ctx: { log: (msg: string) => void }) => void;
  handleCall?: (method: string, payload: unknown) => Promise<unknown> | unknown;
}

const POMODORO_MS = 25 * 60 * 1000;

const plugin: TimerPlugin = {
  id: "timer",
  name: "Pomodoro Timer",
  version: "1.0.0",
  onLoad(ctx) {
    ctx.log("pomodoro timer loaded (" + POMODORO_MS + "ms)");
  },
  async handleCall(method) {
    if (method === "start") return { startedAt: Date.now(), durationMs: POMODORO_MS };
    if (method === "label") return { label: "pomodoro" };
    throw new Error("unknown method: " + method);
  },
};

export default plugin;
`;

const TIMER_UI_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pomodoro</title></head>
<body style="font-family:system-ui;padding:24px;text-align:center;color:#111">
  <h1 style="font-size:22px;margin:0">pomodoro</h1>
  <p style="color:#555">25-minute focus timer. Call plugin.call timer.start to begin.</p>
</body></html>
`;

const SEED_PLUGINS: MarketPluginEntry[] = [
  {
    id: "echo-bot",
    name: "Echo Bot",
    description: "Minimal echo plugin — returns the payload you send it.",
    version: "1.0.0",
    entry: "index.ts",
    ui: "public",
    permissions: ["broadcast", "session:read"],
    author: "rcc",
    tags: ["example", "demo"],
    source: {
      mode: "inline",
      files: {
        "manifest.json": JSON.stringify(
          {
            id: "echo-bot",
            name: "Echo Bot",
            version: "1.0.0",
            entry: "index.ts",
            ui: "public",
            permissions: ["broadcast", "session:read"],
          },
          null,
          2,
        ),
        "index.ts": ECHO_BOT_INDEX_TS,
        "public/index.html": ECHO_BOT_UI_HTML,
      },
    },
  },
  {
    id: "timer",
    name: "Pomodoro Timer",
    description: "Shows a 25-minute pomodoro timer. Minimal demo plugin with no permissions.",
    version: "1.0.0",
    entry: "index.ts",
    ui: "public",
    permissions: [],
    author: "rcc",
    tags: ["example", "productivity"],
    source: {
      mode: "inline",
      files: {
        "manifest.json": JSON.stringify(
          {
            id: "timer",
            name: "Pomodoro Timer",
            version: "1.0.0",
            entry: "index.ts",
            ui: "public",
            permissions: [],
          },
          null,
          2,
        ),
        "index.ts": TIMER_INDEX_TS,
        "public/index.html": TIMER_UI_HTML,
      },
    },
  },
];

interface ConfigMarketplace {
  manifestUrls?: string[];
}

let cache: { at: number; data: MarketCatalog } | null = null;

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLUGIN_VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const ALLOWED_PERMS: readonly PluginPerm[] = [
  "session:read",
  "session:write",
  "chat:read",
  "broadcast",
];
const MAX_PLUGIN_FILES = 64;
const MAX_PLUGIN_FILE_BYTES = 256 * 1024;

function isPluginEntry(x: unknown): x is MarketPluginEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || !PLUGIN_ID_RE.test(o.id)) return false;
  if (typeof o.name !== "string" || !o.name.trim()) return false;
  if (typeof o.version !== "string" || !PLUGIN_VERSION_RE.test(o.version)) return false;
  if (typeof o.entry !== "string" || !o.entry.trim() || isAbsolute(o.entry)) return false;
  if (o.ui !== undefined && (typeof o.ui !== "string" || isAbsolute(o.ui))) return false;
  if (!Array.isArray(o.permissions)) return false;
  for (const p of o.permissions) {
    if (typeof p !== "string" || !ALLOWED_PERMS.includes(p as PluginPerm)) return false;
  }
  const src = o.source as { mode?: unknown; files?: unknown; url?: unknown } | undefined;
  if (!src || typeof src !== "object") return false;
  if (src.mode === "inline") {
    if (!src.files || typeof src.files !== "object") return false;
    const files = src.files as Record<string, unknown>;
    const keys = Object.keys(files);
    if (keys.length === 0 || keys.length > MAX_PLUGIN_FILES) return false;
    for (const k of keys) {
      if (typeof files[k] !== "string") return false;
      if ((files[k] as string).length > MAX_PLUGIN_FILE_BYTES) return false;
    }
  } else if (src.mode === "tarball") {
    if (typeof src.url !== "string" || !/^https:\/\//.test(src.url)) return false;
  } else {
    return false;
  }
  return true;
}

function isSkillEntry(x: unknown): x is MarketSkillEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.name === "string" && typeof o.source === "string";
}

function isMcpEntry(x: unknown): x is MarketMcpEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return false;
  if (o.transport !== "stdio" && o.transport !== "http" && o.transport !== "sse") return false;
  if (o.transport === "stdio" && typeof o.command !== "string") return false;
  if ((o.transport === "http" || o.transport === "sse") && typeof o.url !== "string") return false;
  if (o.command && typeof o.command !== "string") return false;
  // Only allow npx / uvx / node / python / python3 as commands to discourage arbitrary binary execution.
  if (
    o.transport === "stdio" &&
    typeof o.command === "string" &&
    !/^(npx|uvx|node|python|python3)$/.test(o.command)
  ) {
    return false;
  }
  return true;
}

async function fetchManifest(
  url: string,
): Promise<{ ok: true; data: RawManifest } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_MANIFEST_BYTES) {
      return { ok: false, error: "manifest too large" };
    }
    const text = new TextDecoder().decode(buf);
    const parsed = JSON.parse(text) as RawManifest;
    return { ok: true, data: parsed };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCatalogs(force = false): Promise<MarketCatalog> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const cfg = await loadConfig();
  const marketCfg = (cfg.marketplace as ConfigMarketplace | undefined) ?? {};
  const urls = (marketCfg.manifestUrls ?? []).filter(
    (u) => typeof u === "string" && /^https:\/\//.test(u),
  );

  const skillMap = new Map<string, MarketSkillEntry>();
  const mcpMap = new Map<string, MarketMcpEntry>();
  const pluginMap = new Map<string, MarketPluginEntry>();
  for (const s of SEED_SKILLS) skillMap.set(s.id, s);
  for (const m of SEED_MCPS) mcpMap.set(m.id, m);
  for (const p of SEED_PLUGINS) pluginMap.set(p.id, p);

  const sources: Array<{ url: string; ok: boolean; error?: string }> = [
    { url: "seed://builtin", ok: true },
  ];

  const results = await Promise.all(urls.map((u) => fetchManifest(u)));
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    const res = results[i]!;
    if (!res.ok) {
      sources.push({ url, ok: false, error: res.error });
      continue;
    }
    sources.push({ url, ok: true });
    for (const raw of res.data.skills ?? []) {
      const merged = { ...raw } as MarketSkillEntry;
      if (!isSkillEntry(merged)) continue;
      skillMap.set(merged.id, merged);
    }
    for (const raw of res.data.mcps ?? []) {
      const merged = { ...raw } as MarketMcpEntry;
      if (!isMcpEntry(merged)) continue;
      mcpMap.set(merged.id, merged);
    }
    for (const raw of res.data.plugins ?? []) {
      const merged = { ...raw } as MarketPluginEntry;
      if (!isPluginEntry(merged)) continue;
      pluginMap.set(merged.id, merged);
    }
  }

  const data: MarketCatalog = {
    skills: [...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    mcps: [...mcpMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    plugins: [...pluginMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sources,
    fetchedAt: Date.now(),
  };
  cache = { at: Date.now(), data };
  return data;
}

export function invalidateCatalogCache(): void {
  cache = null;
}

async function resolveSkillContent(entry: MarketSkillEntry): Promise<string> {
  if (entry.source === "inline") {
    if (!entry.content) throw new Error("inline skill has no content");
    return entry.content;
  }
  if (!/^https:\/\//.test(entry.source)) throw new Error("skill source must be https url");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(entry.source, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching SKILL.md`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_MANIFEST_BYTES) throw new Error("SKILL.md too large");
    return new TextDecoder().decode(buf);
  } finally {
    clearTimeout(timer);
  }
}

function slugFromId(id: string): string {
  // Keep something filesystem-safe. Strip vendor prefix if present.
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail.replace(/[^A-Za-z0-9._-]/g, "-");
}

function extractFrontmatter(
  raw: string,
): { description: string; tags: string[] | undefined; body: string } {
  if (!raw.startsWith("---")) return { description: "", tags: undefined, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { description: "", tags: undefined, body: raw };
  const fm = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  let description = "";
  let tags: string[] | undefined;
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!;
    let v = (m[2] ?? "").trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k === "description") description = v;
    if (k === "tags") {
      tags = v
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
  }
  return { description, tags, body };
}

export async function installSkillFromCatalog(
  id: string,
  scope: MarketScope,
  projectCwd: string,
): Promise<{ ok: true; installedName: string } | { ok: false; error: string }> {
  const catalog = await fetchCatalogs();
  const entry = catalog.skills.find((s) => s.id === id);
  if (!entry) return { ok: false, error: `skill not in catalog: ${id}` };

  let raw: string;
  try {
    raw = await resolveSkillContent(entry);
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const name = slugFromId(entry.id);
  const fm = extractFrontmatter(raw);
  const description = fm.description || entry.description || "";
  const tags = fm.tags ?? entry.tags;

  try {
    await writeSkill(
      { scope, name, description, body: fm.body, tags },
      projectCwd,
    );
    return { ok: true, installedName: name };
  } catch (err: unknown) {
    // Fallback: write the raw file verbatim if our frontmatter round-trip
    // mangles an exotic manifest (rare).
    try {
      const root =
        scope === "user"
          ? join(homedir(), ".claude", "skills", name)
          : join(projectCwd, ".claude", "skills", name);
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "SKILL.md"), raw, "utf8");
      return { ok: true, installedName: name };
    } catch (err2: unknown) {
      return {
        ok: false,
        error: err2 instanceof Error ? err2.message : String(err2),
      };
    }
  }
}

function installMcpScope(scope: MarketScope): McpScope {
  return scope === "user" ? "user" : "project";
}

export async function installMcpFromCatalog(
  id: string,
  scope: MarketScope,
  env: Record<string, string>,
  projectCwd: string,
): Promise<{ ok: true; installedName: string } | { ok: false; error: string }> {
  const catalog = await fetchCatalogs();
  const entry = catalog.mcps.find((m) => m.id === id);
  if (!entry) return { ok: false, error: `mcp not in catalog: ${id}` };

  const installedName = slugFromId(entry.id);
  const sanitisedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    sanitisedEnv[k] = v;
  }

  try {
    await addMcp(
      {
        name: installedName,
        transport: entry.transport,
        scope: installMcpScope(scope),
        command: entry.command,
        args: entry.args,
        url: entry.url,
        env: Object.keys(sanitisedEnv).length ? sanitisedEnv : undefined,
      },
      projectCwd,
    );
    return { ok: true, installedName };
  } catch (err: any) {
    const msg = (err?.stderr || err?.message || String(err)) as string;
    return { ok: false, error: msg };
  }
}

function defaultPluginsRoot(): string {
  return join(homedir(), ".rcc", "plugins");
}

function safeJoinInsidePluginDir(dir: string, relPath: string): string | null {
  if (typeof relPath !== "string" || !relPath.length) return null;
  if (isAbsolute(relPath)) return null;
  // Strip leading ./, normalize separators on the way in.
  const target = resolve(dir, relPath);
  const rel = relative(dir, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return target;
}

export async function installPluginFromCatalog(
  id: string,
): Promise<{ ok: true; pluginId: string } | { ok: false; error: string }> {
  const catalog = await fetchCatalogs();
  const entry = catalog.plugins.find((p) => p.id === id);
  if (!entry) return { ok: false, error: `plugin not in catalog: ${id}` };

  if (entry.source.mode === "tarball") {
    return { ok: false, error: "tarball install not yet supported (M9); use inline sources" };
  }

  const files = entry.source.files;
  if (!files["manifest.json"]) {
    return { ok: false, error: "inline source missing manifest.json" };
  }

  const pluginDir = join(defaultPluginsRoot(), entry.id);
  try {
    await mkdir(pluginDir, { recursive: true });
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  for (const [relPath, content] of Object.entries(files)) {
    const target = safeJoinInsidePluginDir(pluginDir, relPath);
    if (!target) {
      return { ok: false, error: `unsafe path in inline source: ${relPath}` };
    }
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { ok: true, pluginId: entry.id };
}
