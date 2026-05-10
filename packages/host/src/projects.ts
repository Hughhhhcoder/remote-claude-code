import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectColor, ProjectMeta } from "@rcc/protocol";
import { PROJECT_COLORS } from "@rcc/protocol";

function configPath(): string {
  return join(homedir(), ".rcc", "config.json");
}

interface RccConfigRaw {
  projects?: ProjectMeta[];
  [key: string]: unknown;
}

async function readConfigRaw(): Promise<RccConfigRaw> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as RccConfigRaw;
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`[projects] could not read ${configPath()}: ${err?.message ?? err}`);
    }
  }
  return {};
}

async function writeConfigRaw(cfg: RccConfigRaw): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // best-effort on non-POSIX
  }
}

function isColor(v: unknown): v is ProjectColor {
  return typeof v === "string" && (PROJECT_COLORS as readonly string[]).includes(v);
}

function sanitize(raw: unknown): ProjectMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id ? r.id : null;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
  const cwd = typeof r.cwd === "string" && r.cwd ? resolve(r.cwd) : null;
  if (!id || !name || !cwd) return null;
  const out: ProjectMeta = { id, name, cwd };
  if (isColor(r.color)) out.color = r.color;
  if (r.isDefault === true) out.isDefault = true;
  if (typeof r.systemPrompt === "string") {
    const sp = r.systemPrompt.trim();
    if (sp) out.systemPrompt = sp.slice(0, 4000);
  }
  return out;
}

/**
 * Per-process project store. Persists `projects` segment of
 * `~/.rcc/config.json` (preserving all other keys on write). On first load
 * with no projects, auto-creates a "default" entry using the supplied
 * bootCwd (RCC_CWD || process.cwd()) so existing installs keep working.
 */
export class ProjectStore {
  private projects: ProjectMeta[] = [];
  private listeners = new Set<(projects: ProjectMeta[]) => void>();

  private constructor(projects: ProjectMeta[]) {
    this.projects = projects;
  }

  static async load(bootCwd: string): Promise<ProjectStore> {
    const cfg = await readConfigRaw();
    const raw = Array.isArray(cfg.projects) ? cfg.projects : [];
    const projects = raw.map(sanitize).filter((p): p is ProjectMeta => p !== null);
    const hasDefault = projects.some((p) => p.isDefault);
    if (projects.length === 0 || !hasDefault) {
      const def: ProjectMeta = {
        id: `proj_${randomUUID().slice(0, 8)}`,
        name: "default",
        cwd: resolve(bootCwd),
        color: "orange",
        isDefault: true,
      };
      if (projects.length === 0) {
        projects.push(def);
      } else {
        // Projects exist but none marked default — promote the first.
        projects[0]!.isDefault = true;
      }
      const store = new ProjectStore(projects);
      await store.persist();
      return store;
    }
    return new ProjectStore(projects);
  }

  list(): ProjectMeta[] {
    return this.projects.map((p) => ({ ...p }));
  }

  getById(id: string): ProjectMeta | undefined {
    const p = this.projects.find((x) => x.id === id);
    return p ? { ...p } : undefined;
  }

  getDefault(): ProjectMeta {
    const p = this.projects.find((x) => x.isDefault) ?? this.projects[0];
    if (!p) throw new Error("no projects — store uninitialized");
    return { ...p };
  }

  /** Find project whose cwd matches the given absolute path. */
  findByCwd(cwd: string): ProjectMeta | undefined {
    const target = resolve(cwd);
    const p = this.projects.find((x) => x.cwd === target);
    return p ? { ...p } : undefined;
  }

  async create(input: { name: string; cwd: string; color?: ProjectColor; systemPrompt?: string }): Promise<ProjectMeta> {
    const name = input.name.trim();
    if (!name) throw new Error("name is required");
    const cwd = resolve(input.cwd);
    const project: ProjectMeta = {
      id: `proj_${randomUUID().slice(0, 8)}`,
      name,
      cwd,
    };
    if (input.color) project.color = input.color;
    if (input.systemPrompt !== undefined) {
      const sp = input.systemPrompt.trim();
      if (sp) project.systemPrompt = sp.slice(0, 4000);
    }
    this.projects.push(project);
    await this.persist();
    this.emit();
    return { ...project };
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    const p = this.projects[idx]!;
    if (p.isDefault) throw new Error("cannot remove default project");
    this.projects.splice(idx, 1);
    await this.persist();
    this.emit();
    return true;
  }

  async rename(id: string, name: string): Promise<ProjectMeta> {
    const p = this.projects.find((x) => x.id === id);
    if (!p) throw new Error("unknown project");
    const next = name.trim();
    if (!next) throw new Error("name is required");
    p.name = next;
    await this.persist();
    this.emit();
    return { ...p };
  }

  async update(
    id: string,
    patch: { cwd?: string; color?: ProjectColor | null; systemPrompt?: string | null },
  ): Promise<ProjectMeta> {
    const p = this.projects.find((x) => x.id === id);
    if (!p) throw new Error("unknown project");
    if (patch.cwd !== undefined) {
      const cwd = patch.cwd.trim();
      if (!cwd) throw new Error("cwd is required");
      p.cwd = resolve(cwd);
    }
    if (patch.color !== undefined) {
      if (patch.color === null) delete p.color;
      else p.color = patch.color;
    }
    if (patch.systemPrompt !== undefined) {
      if (patch.systemPrompt === null) {
        delete p.systemPrompt;
      } else {
        const sp = patch.systemPrompt.trim();
        if (sp) p.systemPrompt = sp.slice(0, 4000);
        else delete p.systemPrompt;
      }
    }
    await this.persist();
    this.emit();
    return { ...p };
  }

  onChange(l: (projects: ProjectMeta[]) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(): void {
    const snap = this.list();
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch (err) {
        console.warn("[projects] listener threw:", err);
      }
    }
  }

  private async persist(): Promise<void> {
    const cfg = await readConfigRaw();
    cfg.projects = this.projects;
    await writeConfigRaw(cfg);
  }
}
