import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.ts";

export type SubagentScope = "user" | "project";

export interface SubagentMeta {
  id: string;
  name: string;
  description: string;
  scope: SubagentScope;
  model: string | null;
  tools: string | null;
  path: string;
}

export interface SubagentSaveInput {
  scope: SubagentScope;
  name: string;
  description?: string;
  model?: string;
  tools?: string;
  body: string;
  originalId?: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function userDir(): string {
  return join(homedir(), ".claude", "agents");
}

function projectDir(cwd: string): string {
  return join(cwd, ".claude", "agents");
}

export function buildSubagentId(scope: SubagentScope, name: string): string {
  return `${scope}:${name}`;
}

function parseId(id: string): { scope: SubagentScope; name: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const scope = id.slice(0, idx) as SubagentScope;
  const name = id.slice(idx + 1);
  if (scope !== "user" && scope !== "project") return null;
  if (!name) return null;
  return { scope, name };
}

async function readDirAgents(dir: string, scope: SubagentScope): Promise<SubagentMeta[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: SubagentMeta[] = [];
  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
    const fileName = file.slice(0, -3);
    const path = join(dir, file);
    let description = "";
    let model: string | null = null;
    let tools: string | null = null;
    let name = fileName;
    try {
      const raw = await readFile(path, "utf8");
      const { data } = parseFrontmatter(raw);
      description = (data.description ?? data.desc ?? "").trim();
      model = (data.model ?? "").trim() || null;
      tools = (data.tools ?? data["allowed-tools"] ?? "").trim() || null;
      if (data.name && data.name.trim()) name = data.name.trim();
    } catch {
      // ignore
    }
    out.push({
      id: buildSubagentId(scope, fileName),
      name,
      description,
      scope,
      model,
      tools,
      path,
    });
  }
  return out;
}

export async function listSubagents(cwd: string): Promise<SubagentMeta[]> {
  const [user, project] = await Promise.all([
    readDirAgents(userDir(), "user"),
    readDirAgents(projectDir(cwd), "project"),
  ]);
  const all = [...project, ...user];
  all.sort((a, b) => {
    const r = a.scope === b.scope ? 0 : a.scope === "project" ? -1 : 1;
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });
  return all;
}

export async function readSubagent(id: string, cwd: string): Promise<{
  id: string;
  content: string;
  meta: SubagentMeta;
} | null> {
  const parsed = parseId(id);
  if (!parsed) return null;
  const path = parsed.scope === "user"
    ? join(userDir(), `${parsed.name}.md`)
    : join(projectDir(cwd), `${parsed.name}.md`);
  try {
    const raw = await readFile(path, "utf8");
    const { data, body } = parseFrontmatter(raw);
    const name = (data.name ?? parsed.name).trim() || parsed.name;
    const description = (data.description ?? data.desc ?? "").trim();
    const model = (data.model ?? "").trim() || null;
    const tools = (data.tools ?? data["allowed-tools"] ?? "").trim() || null;
    return {
      id,
      content: body,
      meta: {
        id,
        name,
        description,
        scope: parsed.scope,
        model,
        tools,
        path,
      },
    };
  } catch {
    return null;
  }
}

export async function saveSubagent(input: SubagentSaveInput, cwd: string): Promise<SubagentMeta> {
  const fileName = input.name.trim();
  if (!NAME_RE.test(fileName)) throw new Error("invalid_name");
  const dir = input.scope === "user" ? userDir() : projectDir(cwd);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${fileName}.md`);
  const content = stringifyFrontmatter(
    {
      name: fileName,
      description: input.description?.trim() || undefined,
      model: input.model?.trim() || undefined,
      tools: input.tools?.trim() || undefined,
    },
    input.body ?? "",
  );
  await writeFile(path, content, "utf8");

  if (input.originalId) {
    const prev = parseId(input.originalId);
    if (prev) {
      const prevPath = prev.scope === "user"
        ? join(userDir(), `${prev.name}.md`)
        : join(projectDir(cwd), `${prev.name}.md`);
      if (prevPath !== path) {
        try {
          await unlink(prevPath);
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    id: buildSubagentId(input.scope, fileName),
    name: fileName,
    description: input.description?.trim() ?? "",
    scope: input.scope,
    model: input.model?.trim() || null,
    tools: input.tools?.trim() || null,
    path,
  };
}

export async function deleteSubagent(id: string, cwd: string): Promise<boolean> {
  const parsed = parseId(id);
  if (!parsed) return false;
  const path = parsed.scope === "user"
    ? join(userDir(), `${parsed.name}.md`)
    : join(projectDir(cwd), `${parsed.name}.md`);
  try {
    await unlink(path);
    return true;
  } catch (err: any) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}
