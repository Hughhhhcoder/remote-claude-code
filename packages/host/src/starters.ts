import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Starter, WorkflowStep } from "@rcc/protocol";

interface StarterStoreFile {
  version: 1;
  starters: Starter[];
}

function defaultPath(): string {
  return join(homedir(), ".rcc", "starters.json");
}

function newId(): string {
  return `user:${randomBytes(6).toString("base64url")}`;
}

const PER_STARTER_BYTES_CAP = 32 * 1024;
const MAX_STEPS = 50;

// Hardcoded builtin starter seeds. These live in-memory only; users may copy
// them into a user-owned starter via the UI but cannot delete the originals.
const BUILTIN_STARTERS: readonly Starter[] = [
  {
    id: "builtin:code-review",
    name: "Code Review",
    description: "严格的代码审查 — 跑 /review 审当前改动",
    systemPrompt: "你是一个严格的代码审查者。请对每处潜在问题指出具体文件:行号,并给出修复建议。",
    firstSteps: [{ kind: "slash", name: "review" } satisfies WorkflowStep],
    icon: "🔍",
    color: "violet",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:debug",
    name: "Debug",
    description: "帮我定位 bug — 先问现象再动手",
    systemPrompt: "帮我 debug。先复述你理解的 bug 现象,再列出最可能的 3 个假设并给出验证顺序。",
    firstSteps: [
      { kind: "prompt", text: "当前 bug 的现象是: " } satisfies WorkflowStep,
    ],
    icon: "🐛",
    color: "rose",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:plan",
    name: "Plan",
    description: "Plan 模式 — 只读规划,不动文件",
    systemPrompt: "使用 plan 模式。先规划,把分步计划和风险点列清楚,等我确认再动手。",
    permissionMode: "plan",
    icon: "📋",
    color: "emerald",
    createdAt: 0,
    builtin: true,
  },
];

export class StarterStore {
  private data: StarterStoreFile;
  private readonly path: string;

  private constructor(path: string, data: StarterStoreFile) {
    this.path = path;
    this.data = data;
  }

  static async load(path = defaultPath()): Promise<StarterStore> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as StarterStoreFile;
      if (parsed.version !== 1) throw new Error("unknown starters.json version");
      return new StarterStore(path, parsed);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[starters] failed to load ${path}, starting fresh:`, err.message);
      }
      const fresh: StarterStoreFile = { version: 1, starters: [] };
      const store = new StarterStore(path, fresh);
      await store.persist();
      return store;
    }
  }

  /**
   * Combined list: hardcoded builtins first, then user starters (sorted by
   * createdAt desc). Builtins are never stored on disk.
   */
  list(): Starter[] {
    const user = [...this.data.starters].sort((a, b) => b.createdAt - a.createdAt);
    return [...BUILTIN_STARTERS.map((s) => ({ ...s })), ...user];
  }

  get(id: string): Starter | null {
    const b = BUILTIN_STARTERS.find((s) => s.id === id);
    if (b) return { ...b };
    const u = this.data.starters.find((s) => s.id === id);
    return u ? { ...u } : null;
  }

  async save(opts: {
    id?: string;
    name: string;
    description?: string;
    systemPrompt?: string;
    enableSkills?: string[];
    firstSteps?: WorkflowStep[];
    permissionMode?: Starter["permissionMode"];
    icon?: string;
    color?: string;
  }): Promise<Starter> {
    const name = opts.name.trim();
    if (!name) throw new Error("starter name is empty");
    if (opts.firstSteps && opts.firstSteps.length > MAX_STEPS) {
      throw new Error(`starter firstSteps exceeds ${MAX_STEPS}`);
    }

    // Reject edits targeting builtins — users must "duplicate" first. The
    // UI handles the duplication by dropping the id; here we just defend.
    if (opts.id && opts.id.startsWith("builtin:")) {
      throw new Error("builtin starters are read-only; duplicate first");
    }

    const body: Omit<Starter, "id" | "createdAt" | "builtin"> = {
      name,
      description: opts.description?.trim() || undefined,
      systemPrompt: opts.systemPrompt?.trim() || undefined,
      enableSkills: opts.enableSkills?.length ? [...opts.enableSkills] : undefined,
      firstSteps: opts.firstSteps?.length ? opts.firstSteps.map(cloneStep) : undefined,
      permissionMode: opts.permissionMode,
      icon: opts.icon?.slice(0, 8) || undefined,
      color: opts.color?.slice(0, 32) || undefined,
    };

    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, "utf8") > PER_STARTER_BYTES_CAP) {
      throw new Error("starter payload exceeds 32KB");
    }

    if (opts.id) {
      const idx = this.data.starters.findIndex((s) => s.id === opts.id);
      if (idx < 0) throw new Error("starter not found");
      const prev = this.data.starters[idx]!;
      const next: Starter = { ...body, id: prev.id, createdAt: prev.createdAt };
      this.data.starters[idx] = next;
      await this.persist();
      return { ...next };
    }

    const next: Starter = { ...body, id: newId(), createdAt: Date.now() };
    this.data.starters.push(next);
    await this.persist();
    return { ...next };
  }

  async remove(id: string): Promise<boolean> {
    if (id.startsWith("builtin:")) {
      throw new Error("builtin starters cannot be removed");
    }
    const idx = this.data.starters.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    this.data.starters.splice(idx, 1);
    await this.persist();
    return true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp";
    await writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}

function cloneStep(s: WorkflowStep): WorkflowStep {
  if (s.kind === "git") return { kind: "git", args: [...s.args] };
  return { ...s };
}
