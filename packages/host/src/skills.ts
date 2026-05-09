import { readdir, readFile, writeFile, rename, mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.ts";

export type SkillScope = "user" | "project";

export interface SkillSummary {
  /** `<scope>:<name>` — unique across scopes so UI can key on it. */
  id: string;
  name: string;
  scope: SkillScope;
  /** Directory that holds SKILL.md (absolute path). */
  dir: string;
  /** Display path (short, human form, e.g. `~/.claude/skills/foo`). */
  displayPath: string;
  description: string;
  /** Free-form csv string from frontmatter, not split. */
  tags: string[];
  enabled: boolean;
  /** Best-effort version string if present. */
  version?: string;
}

export interface SkillContent {
  id: string;
  /** Raw SKILL.md text. */
  content: string;
}

export interface SkillWriteInput {
  scope: SkillScope;
  name: string;
  description: string;
  body: string;
  tags?: string[];
}

const DISABLED_PREFIX = "_disabled_";

function userSkillsRoot(): string {
  return join(homedir(), ".claude", "skills");
}

function projectSkillsRoot(cwd: string): string {
  return join(cwd, ".claude", "skills");
}

function shortenPath(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function skillIdOf(scope: SkillScope, name: string): string {
  return `${scope}:${name}`;
}

function parseSkillId(id: string): { scope: SkillScope; name: string } | null {
  const idx = id.indexOf(":");
  if (idx < 0) return null;
  const scope = id.slice(0, idx) as SkillScope;
  const name = id.slice(idx + 1);
  if (scope !== "user" && scope !== "project") return null;
  if (!name) return null;
  return { scope, name };
}

function isValidSkillName(name: string): boolean {
  // Conservative: letters, digits, dash, underscore, dot. No slashes.
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".") && !name.startsWith(DISABLED_PREFIX);
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  // frontmatter parser stores everything as string. Support "[a, b, c]" and "a, b, c".
  const trimmed = raw.trim().replace(/^\[|\]$/g, "");
  return trimmed
    .split(",")
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

async function listSkillsInRoot(root: string, scope: SkillScope): Promise<SkillSummary[]> {
  if (!(await dirExists(root))) return [];
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const results: SkillSummary[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const dir = join(root, entry);
    let st;
    try {
      st = await stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const disabled = entry.startsWith(DISABLED_PREFIX);
    const name = disabled ? entry.slice(DISABLED_PREFIX.length) : entry;
    if (!name) continue;

    const skillPath = join(dir, "SKILL.md");
    let raw: string | null = null;
    try {
      raw = await readFile(skillPath, "utf8");
    } catch {
      // missing SKILL.md — skip silently so a stray dir doesn't poison the list.
      continue;
    }
    let fm: { data: Record<string, string>; body: string };
    try {
      fm = parseFrontmatter(raw);
    } catch {
      fm = { data: {}, body: raw };
    }
    results.push({
      id: skillIdOf(scope, name),
      name: fm.data.name || name,
      scope,
      dir,
      displayPath: shortenPath(dir),
      description: fm.data.description ?? "",
      tags: parseTags(fm.data.tags),
      enabled: !disabled,
      version: fm.data.version,
    });
  }
  // Stable sort: enabled first, then alpha.
  results.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return results;
}

export async function listSkills(projectCwd: string): Promise<SkillSummary[]> {
  const [userList, projectList] = await Promise.all([
    listSkillsInRoot(userSkillsRoot(), "user"),
    listSkillsInRoot(projectSkillsRoot(projectCwd), "project"),
  ]);
  // project first so they visually outrank user with same name.
  return [...projectList, ...userList];
}

async function findSkillDir(
  scope: SkillScope,
  name: string,
  projectCwd: string,
): Promise<{ dir: string; disabled: boolean } | null> {
  const root = scope === "user" ? userSkillsRoot() : projectSkillsRoot(projectCwd);
  const enabledDir = join(root, name);
  if (await dirExists(enabledDir)) return { dir: enabledDir, disabled: false };
  const disabledDir = join(root, DISABLED_PREFIX + name);
  if (await dirExists(disabledDir)) return { dir: disabledDir, disabled: true };
  return null;
}

export async function toggleSkill(
  id: string,
  enabled: boolean,
  projectCwd: string,
): Promise<SkillSummary | null> {
  const parsed = parseSkillId(id);
  if (!parsed) return null;
  const found = await findSkillDir(parsed.scope, parsed.name, projectCwd);
  if (!found) return null;
  if (found.disabled === !enabled) {
    // Already in the requested state — no-op, just return fresh summary.
    return summarize(parsed.scope, parsed.name, projectCwd);
  }
  const root =
    parsed.scope === "user" ? userSkillsRoot() : projectSkillsRoot(projectCwd);
  const target = join(root, enabled ? parsed.name : DISABLED_PREFIX + parsed.name);
  try {
    await rename(found.dir, target);
  } catch (err) {
    console.error("[rcc-host] skill toggle failed", err);
    return null;
  }
  return summarize(parsed.scope, parsed.name, projectCwd);
}

async function summarize(
  scope: SkillScope,
  name: string,
  projectCwd: string,
): Promise<SkillSummary | null> {
  const all = await listSkillsInRoot(
    scope === "user" ? userSkillsRoot() : projectSkillsRoot(projectCwd),
    scope,
  );
  return all.find((s) => s.name === name) ?? null;
}

export async function readSkillContent(
  id: string,
  projectCwd: string,
): Promise<SkillContent | null> {
  const parsed = parseSkillId(id);
  if (!parsed) return null;
  const found = await findSkillDir(parsed.scope, parsed.name, projectCwd);
  if (!found) return null;
  try {
    const content = await readFile(join(found.dir, "SKILL.md"), "utf8");
    return { id, content };
  } catch {
    return null;
  }
}

export async function writeSkill(
  input: SkillWriteInput,
  projectCwd: string,
): Promise<SkillSummary | null> {
  if (!isValidSkillName(input.name)) {
    throw new Error(`invalid skill name: ${input.name}`);
  }
  const root =
    input.scope === "user" ? userSkillsRoot() : projectSkillsRoot(projectCwd);
  const existing = await findSkillDir(input.scope, input.name, projectCwd);
  const dir = existing?.dir ?? join(root, input.name);

  await mkdir(dir, { recursive: true });
  const data: Record<string, string> = {
    name: input.name,
    description: input.description,
  };
  if (input.tags && input.tags.length > 0) data.tags = input.tags.join(", ");
  const raw = stringifyFrontmatter(data, input.body);
  await writeFile(join(dir, "SKILL.md"), raw, "utf8");
  return summarize(input.scope, input.name, projectCwd);
}

export async function deleteSkill(id: string, projectCwd: string): Promise<boolean> {
  const parsed = parseSkillId(id);
  if (!parsed) return false;
  const found = await findSkillDir(parsed.scope, parsed.name, projectCwd);
  if (!found) return false;
  try {
    await rm(found.dir, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error("[rcc-host] skill delete failed", err);
    return false;
  }
}
