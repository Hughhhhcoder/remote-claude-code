import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { writeSkill } from "./skills.ts";
import { addMcp, type McpScope, type McpTransport } from "./mcp.ts";

export type MarketScope = "user" | "project";

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

export interface MarketCatalog {
  skills: MarketSkillEntry[];
  mcps: MarketMcpEntry[];
  sources: Array<{ url: string; ok: boolean; error?: string }>;
  fetchedAt: number;
}

interface RawManifest {
  skills?: Partial<MarketSkillEntry>[];
  mcps?: Partial<MarketMcpEntry>[];
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

interface ConfigMarketplace {
  manifestUrls?: string[];
}

let cache: { at: number; data: MarketCatalog } | null = null;

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
  for (const s of SEED_SKILLS) skillMap.set(s.id, s);
  for (const m of SEED_MCPS) mcpMap.set(m.id, m);

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
  }

  const data: MarketCatalog = {
    skills: [...skillMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    mcps: [...mcpMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
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
