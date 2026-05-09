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
  {
    id: "builtin:new-feature",
    name: "New Feature",
    description: "实现新功能 — 先 plan 再动手",
    systemPrompt: "帮我实现一个新功能,先写 plan 再动手。把影响面、数据流、边界条件先列清楚。",
    firstSteps: [{ kind: "prompt", text: "功能描述:" } satisfies WorkflowStep],
    icon: "✨",
    color: "sky",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:fix-bug",
    name: "Fix Bug",
    description: "复现 → 定位 → 修复,三步走",
    systemPrompt: "你是 bug 终结者,先复现再修。先让我描述现象,你给出最小复现,再下手。",
    firstSteps: [{ kind: "prompt", text: "bug 现象:" } satisfies WorkflowStep],
    permissionMode: "plan",
    icon: "🔧",
    color: "orange",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:explain-code",
    name: "Explain Code",
    description: "向初学者解释一段代码",
    systemPrompt: "你擅长向初学者解释代码。用通俗的语言,配类比,避免术语堆砌。必要时逐行讲。",
    firstSteps: [{ kind: "prompt", text: "请解释:" } satisfies WorkflowStep],
    icon: "📖",
    color: "cyan",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:write-tests",
    name: "Write Tests",
    description: "为现有代码写全面测试",
    systemPrompt: "你是 QA 专家,为我写全面的测试。覆盖 happy path / 边界 / 异常 / 并发 四类,优先写失败能给出明确信号的用例。",
    firstSteps: [{ kind: "prompt", text: "要测的目标模块/函数:" } satisfies WorkflowStep],
    icon: "🧪",
    color: "lime",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:refactor",
    name: "Refactor",
    description: "严格重构 — 不改行为",
    systemPrompt: "严格重构,不改行为。每步提交独立可 revert,测试覆盖前后一致。避免一次性大范围改动。",
    permissionMode: "acceptEdits",
    icon: "🧹",
    color: "teal",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:security-review",
    name: "Security Review",
    description: "跑 /security-review 找漏洞",
    systemPrompt: "你是 security auditor,找漏洞。重点关注 authn/authz / 注入 / 反序列化 / SSRF / 机密泄露 / 竞态。每条标严重度。",
    firstSteps: [{ kind: "slash", name: "security-review" } satisfies WorkflowStep],
    icon: "🛡️",
    color: "red",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:doc-writer",
    name: "Doc Writer",
    description: "写清晰简洁的用户面向文档",
    systemPrompt: "写用户面向的文档,清晰简洁。避免术语,多用例子,先讲用户要做什么、再讲怎么做。",
    firstSteps: [{ kind: "prompt", text: "要写的文档主题:" } satisfies WorkflowStep],
    icon: "📝",
    color: "amber",
    createdAt: 0,
    builtin: true,
  },
  {
    id: "builtin:standup",
    name: "Standup Reflection",
    description: "整理今天的进展,写周报 bullet",
    systemPrompt: "帮我整理今天的进展,写周报 bullet。格式:Done / In-Progress / Blocked,每条带一句 why。",
    firstSteps: [{ kind: "prompt", text: "今天主要做了:" } satisfies WorkflowStep],
    icon: "📓",
    color: "fuchsia",
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
