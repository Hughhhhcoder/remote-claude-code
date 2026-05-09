import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Notebook, NotebookCell } from "@rcc/protocol";

const PER_NOTEBOOK_BYTES_CAP = 1024 * 1024;

function defaultDir(): string {
  return join(homedir(), ".rcc", "notebooks");
}

function pathFor(dir: string, sid: string): string {
  const safe = sid.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(dir, `${safe}.json`);
}

export class NotebookStore {
  private readonly dir: string;
  private readonly cache = new Map<string, Notebook>();
  private readonly missCache = new Set<string>();

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async load(dir = defaultDir()): Promise<NotebookStore> {
    await mkdir(dir, { recursive: true });
    return new NotebookStore(dir);
  }

  async get(sid: string): Promise<Notebook | null> {
    if (this.cache.has(sid)) return cloneNotebook(this.cache.get(sid)!);
    if (this.missCache.has(sid)) return null;
    const file = pathFor(this.dir, sid);
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as Notebook;
      if (parsed.sid !== sid) parsed.sid = sid;
      this.cache.set(sid, parsed);
      return cloneNotebook(parsed);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        this.missCache.add(sid);
        return null;
      }
      console.warn(`[notebooks] failed to load ${file}:`, err.message ?? err);
      return null;
    }
  }

  async upsert(sid: string, cells: NotebookCell[]): Promise<Notebook> {
    const nb: Notebook = { sid, cells: [...cells], updatedAt: Date.now() };
    this.enforceCap(nb);
    this.cache.set(sid, nb);
    this.missCache.delete(sid);
    await this.persist(nb);
    return cloneNotebook(nb);
  }

  async append(sid: string, cell: NotebookCell): Promise<Notebook> {
    const existing = (await this.get(sid)) ?? { sid, cells: [], updatedAt: Date.now() };
    const next: Notebook = {
      sid,
      cells: [...existing.cells, cell],
      updatedAt: Date.now(),
    };
    this.enforceCap(next);
    this.cache.set(sid, next);
    this.missCache.delete(sid);
    await this.persist(next);
    return cloneNotebook(next);
  }

  async remove(sid: string): Promise<boolean> {
    this.cache.delete(sid);
    this.missCache.add(sid);
    const file = pathFor(this.dir, sid);
    try {
      await unlink(file);
      return true;
    } catch (err: any) {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  }

  private enforceCap(nb: Notebook): void {
    const size = Buffer.byteLength(JSON.stringify(nb), "utf8");
    if (size > PER_NOTEBOOK_BYTES_CAP) {
      throw new Error(`notebook exceeds ${PER_NOTEBOOK_BYTES_CAP} bytes`);
    }
  }

  private async persist(nb: Notebook): Promise<void> {
    const file = pathFor(this.dir, nb.sid);
    await mkdir(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    await writeFile(tmp, JSON.stringify(nb, null, 2), { mode: 0o600 });
    await rename(tmp, file);
  }
}

function cloneNotebook(nb: Notebook): Notebook {
  return { sid: nb.sid, cells: nb.cells.map((c) => ({ ...c })), updatedAt: nb.updatedAt };
}
