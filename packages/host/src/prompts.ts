import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PromptTemplate } from "@rcc/protocol";

interface PromptStoreFile {
  version: 1;
  prompts: PromptTemplate[];
}

function defaultPath(): string {
  return join(homedir(), ".rcc", "prompts.json");
}

function newId(): string {
  return `pr_${randomBytes(6).toString("base64url")}`;
}

const TEMPLATE_BYTES_CAP = 8 * 1024;
const MAX_PARAMS = 20;
const PARAM_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function extractParams(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(template))) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export class PromptStore {
  private data: PromptStoreFile;
  private readonly path: string;

  private constructor(path: string, data: PromptStoreFile) {
    this.path = path;
    this.data = data;
  }

  static async load(path = defaultPath()): Promise<PromptStore> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as PromptStoreFile;
      if (parsed.version !== 1) throw new Error("unknown prompts.json version");
      return new PromptStore(path, parsed);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[prompts] failed to load ${path}, starting fresh:`, err.message);
      }
      const fresh: PromptStoreFile = { version: 1, prompts: [] };
      const store = new PromptStore(path, fresh);
      await store.persist();
      return store;
    }
  }

  list(): PromptTemplate[] {
    return this.data.prompts.map((p) => ({ ...p, params: [...p.params] }));
  }

  get(id: string): PromptTemplate | null {
    const p = this.data.prompts.find((x) => x.id === id);
    return p ? { ...p, params: [...p.params] } : null;
  }

  async save(opts: {
    id?: string;
    name: string;
    template: string;
    description?: string;
  }): Promise<PromptTemplate> {
    const name = opts.name.trim();
    if (!name) throw new Error("prompt name is empty");
    if (!/^[A-Za-z0-9._-][A-Za-z0-9._:-]{0,63}$/.test(name)) {
      throw new Error("prompt name contains invalid characters");
    }
    const template = opts.template;
    if (!template) throw new Error("prompt template is empty");
    if (Buffer.byteLength(template, "utf8") > TEMPLATE_BYTES_CAP) {
      throw new Error("prompt template exceeds 8KB");
    }
    const params = extractParams(template);
    if (params.length > MAX_PARAMS) {
      throw new Error(`prompt has more than ${MAX_PARAMS} params`);
    }

    if (opts.id) {
      const idx = this.data.prompts.findIndex((p) => p.id === opts.id);
      if (idx < 0) throw new Error("prompt not found");
      const prev = this.data.prompts[idx]!;
      const next: PromptTemplate = {
        id: prev.id,
        name,
        template,
        params,
        description: opts.description?.trim() || undefined,
        createdAt: prev.createdAt,
      };
      this.data.prompts[idx] = next;
      await this.persist();
      return { ...next, params: [...next.params] };
    }

    const collision = this.data.prompts.find((p) => p.name === name);
    if (collision) throw new Error(`prompt name "${name}" already exists`);

    const next: PromptTemplate = {
      id: newId(),
      name,
      template,
      params,
      description: opts.description?.trim() || undefined,
      createdAt: Date.now(),
    };
    this.data.prompts.push(next);
    await this.persist();
    return { ...next, params: [...next.params] };
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.data.prompts.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.data.prompts.splice(idx, 1);
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
