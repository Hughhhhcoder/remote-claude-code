import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Workflow, WorkflowStep } from "@rcc/protocol";

interface WorkflowStoreFile {
  version: 1;
  workflows: Workflow[];
}

function defaultPath(): string {
  return join(homedir(), ".rcc", "workflows.json");
}

function newId(): string {
  return `wf_${randomBytes(6).toString("base64url")}`;
}

// ~32KB per workflow as a sanity cap — serialized steps should not balloon.
const PER_WORKFLOW_BYTES_CAP = 32 * 1024;
const MAX_STEPS = 50;

export class WorkflowStore {
  private data: WorkflowStoreFile;
  private readonly path: string;

  private constructor(path: string, data: WorkflowStoreFile) {
    this.path = path;
    this.data = data;
  }

  static async load(path = defaultPath()): Promise<WorkflowStore> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as WorkflowStoreFile;
      if (parsed.version !== 1) throw new Error("unknown workflows.json version");
      return new WorkflowStore(path, parsed);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[workflows] failed to load ${path}, starting fresh:`, err.message);
      }
      const fresh: WorkflowStoreFile = { version: 1, workflows: [] };
      const store = new WorkflowStore(path, fresh);
      await store.persist();
      return store;
    }
  }

  list(): Workflow[] {
    return this.data.workflows.map((w) => ({ ...w, steps: [...w.steps] }));
  }

  get(id: string): Workflow | null {
    const w = this.data.workflows.find((x) => x.id === id);
    return w ? { ...w, steps: [...w.steps] } : null;
  }

  async save(opts: {
    id?: string;
    name: string;
    description?: string;
    steps: WorkflowStep[];
    variables?: Record<string, string>;
  }): Promise<Workflow> {
    const name = opts.name.trim();
    if (!name) throw new Error("workflow name is empty");
    if (!opts.steps.length) throw new Error("workflow has no steps");
    if (opts.steps.length > MAX_STEPS) {
      throw new Error(`workflow exceeds ${MAX_STEPS} steps`);
    }
    const serialized = JSON.stringify(opts.steps);
    if (Buffer.byteLength(serialized, "utf8") > PER_WORKFLOW_BYTES_CAP) {
      throw new Error("workflow payload exceeds 32KB");
    }
    // [B25-C] Normalize variables: drop undefined, cap at 32 entries.
    let variables: Record<string, string> | undefined;
    if (opts.variables && typeof opts.variables === "object") {
      const entries = Object.entries(opts.variables).filter(
        ([k, v]) => typeof k === "string" && k.length > 0 && typeof v === "string",
      );
      if (entries.length > 32) {
        throw new Error("workflow variables exceed 32 entries");
      }
      if (entries.length > 0) {
        variables = Object.fromEntries(entries);
      }
    }

    if (opts.id) {
      const idx = this.data.workflows.findIndex((w) => w.id === opts.id);
      if (idx < 0) throw new Error("workflow not found");
      const prev = this.data.workflows[idx]!;
      const next: Workflow = {
        id: prev.id,
        name,
        description: opts.description?.trim() || undefined,
        steps: opts.steps,
        createdAt: prev.createdAt,
        variables,
      };
      this.data.workflows[idx] = next;
      await this.persist();
      return { ...next, steps: [...next.steps] };
    }

    const next: Workflow = {
      id: newId(),
      name,
      description: opts.description?.trim() || undefined,
      steps: opts.steps,
      createdAt: Date.now(),
      variables,
    };
    this.data.workflows.push(next);
    await this.persist();
    return { ...next, steps: [...next.steps] };
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.data.workflows.findIndex((w) => w.id === id);
    if (idx < 0) return false;
    this.data.workflows.splice(idx, 1);
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
