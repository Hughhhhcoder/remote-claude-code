import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.ts";

export type CommandScope = "builtin" | "user" | "project";

export interface CommandMeta {
  id: string;
  name: string;
  description: string;
  scope: CommandScope;
  path: string | null;
  pinned: boolean;
}

export interface CommandSaveInput {
  scope: "user" | "project";
  name: string;
  description?: string;
  body: string;
  originalId?: string;
}

const BUILTIN: Array<{ name: string; description: string }> = [
  { name: "clear", description: "清空当前 session 上下文" },
  { name: "compact", description: "压缩对话上下文" },
  { name: "help", description: "查看帮助" },
  { name: "init", description: "生成项目的 CLAUDE.md" },
  { name: "review", description: "完整 PR 代码审查" },
  { name: "security-review", description: "安全审查当前分支改动" },
  { name: "simplify", description: "重构重复/冗余代码" },
  { name: "status", description: "查看当前会话状态" },
  { name: "model", description: "切换模型" },
  { name: "cost", description: "查看 token 消耗" },
  { name: "git:status", description: "git status (read-only)" },
  { name: "git:diff", description: "git diff (read-only)" },
  { name: "git:log", description: "git log -n 10 (read-only)" },
  { name: "git:branch", description: "git branch -a (read-only)" },
];

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function userDir(): string {
  return join(homedir(), ".claude", "commands");
}

function projectDir(cwd: string): string {
  return join(cwd, ".claude", "commands");
}

function pinnedFilePath(): string {
  return join(homedir(), ".rcc", "pinned-commands.json");
}

export function buildCommandId(scope: CommandScope, name: string): string {
  return `${scope}:${name}`;
}

function parseId(id: string): { scope: CommandScope; name: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const scope = id.slice(0, idx) as CommandScope;
  const name = id.slice(idx + 1);
  if (scope !== "builtin" && scope !== "user" && scope !== "project") return null;
  if (!name) return null;
  return { scope, name };
}

async function readDirCommands(dir: string, scope: "user" | "project"): Promise<CommandMeta[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: CommandMeta[] = [];
  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
    const name = file.slice(0, -3);
    const path = join(dir, file);
    let description = "";
    try {
      const raw = await readFile(path, "utf8");
      const { data } = parseFrontmatter(raw);
      description = (data.description ?? data.desc ?? "").trim();
      if (!description) {
        // fall back to first non-empty body line
        const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
        const firstLine = body.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
        description = firstLine.replace(/^#+\s*/, "").slice(0, 160);
      }
    } catch {
      // ignore unreadable
    }
    out.push({
      id: buildCommandId(scope, name),
      name,
      description,
      scope,
      path,
      pinned: false,
    });
  }
  return out;
}

export async function listCommands(cwd: string): Promise<CommandMeta[]> {
  const pinned = await loadPinned();
  const builtin: CommandMeta[] = BUILTIN.map((b) => ({
    id: buildCommandId("builtin", b.name),
    name: b.name,
    description: b.description,
    scope: "builtin",
    path: null,
    pinned: false,
  }));
  const [user, project] = await Promise.all([
    readDirCommands(userDir(), "user"),
    readDirCommands(projectDir(cwd), "project"),
  ]);
  const all = [...builtin, ...user, ...project];
  const pinSet = new Set(pinned);
  for (const cmd of all) cmd.pinned = pinSet.has(cmd.id);
  all.sort((a, b) => {
    const scopeRank: Record<CommandScope, number> = { project: 0, user: 1, builtin: 2 };
    const r = scopeRank[a.scope] - scopeRank[b.scope];
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });
  return all;
}

export async function readCommand(id: string, cwd: string): Promise<{
  id: string;
  content: string;
  description: string;
  scope: CommandScope;
} | null> {
  const parsed = parseId(id);
  if (!parsed) return null;
  const { scope, name } = parsed;
  if (scope === "builtin") {
    const b = BUILTIN.find((x) => x.name === name);
    if (!b) return null;
    return { id, content: "", description: b.description, scope: "builtin" };
  }
  const path = scope === "user" ? join(userDir(), `${name}.md`) : join(projectDir(cwd), `${name}.md`);
  try {
    const raw = await readFile(path, "utf8");
    const { data, body } = parseFrontmatter(raw);
    return {
      id,
      content: body,
      description: (data.description ?? data.desc ?? "").trim(),
      scope,
    };
  } catch {
    return null;
  }
}

export async function saveCommand(input: CommandSaveInput, cwd: string): Promise<CommandMeta> {
  const name = input.name.trim();
  if (!NAME_RE.test(name)) throw new Error("invalid_name");
  const dir = input.scope === "user" ? userDir() : projectDir(cwd);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  const content = stringifyFrontmatter(
    { description: input.description?.trim() || undefined },
    input.body ?? "",
  );
  await writeFile(path, content, "utf8");

  // If renaming, delete the old file once save succeeds.
  if (input.originalId) {
    const prev = parseId(input.originalId);
    if (prev && (prev.scope === "user" || prev.scope === "project")) {
      const prevPath = prev.scope === "user" ? join(userDir(), `${prev.name}.md`) : join(projectDir(cwd), `${prev.name}.md`);
      if (prevPath !== path) {
        try {
          await unlink(prevPath);
        } catch {
          // ignore
        }
      }
    }
  }

  const description = (input.description ?? "").trim();
  const id = buildCommandId(input.scope, name);
  const pinned = (await loadPinned()).includes(id);
  return {
    id,
    name,
    description,
    scope: input.scope,
    path,
    pinned,
  };
}

export async function deleteCommand(id: string, cwd: string): Promise<boolean> {
  const parsed = parseId(id);
  if (!parsed) return false;
  if (parsed.scope === "builtin") throw new Error("readonly_builtin");
  const path = parsed.scope === "user"
    ? join(userDir(), `${parsed.name}.md`)
    : join(projectDir(cwd), `${parsed.name}.md`);
  try {
    await unlink(path);
  } catch (err: any) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
  // also drop from pinned list if present
  const current = await loadPinned();
  if (current.includes(id)) {
    await savePinned(current.filter((x) => x !== id));
  }
  return true;
}

// ─── pinned state ──────────────────────────────────────────────────────────

export async function loadPinned(): Promise<string[]> {
  try {
    const raw = await readFile(pinnedFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

async function savePinned(list: string[]): Promise<void> {
  const path = pinnedFilePath();
  await mkdir(join(homedir(), ".rcc"), { recursive: true });
  await writeFile(path, JSON.stringify(list, null, 2), { encoding: "utf8", mode: 0o600 });
}

export async function pinCommand(id: string, pinned: boolean): Promise<string[]> {
  const current = await loadPinned();
  let next: string[];
  if (pinned && !current.includes(id)) {
    next = [...current, id];
  } else if (!pinned) {
    next = current.filter((x) => x !== id);
  } else {
    next = current;
  }
  await savePinned(next);
  return next;
}

export async function reorderPinned(ids: string[]): Promise<string[]> {
  // only keep known ids (de-dup preserving order)
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
  }
  await savePinned(cleaned);
  return cleaned;
}
