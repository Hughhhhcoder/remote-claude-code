import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AuditEntry {
  ts: number;
  kind: string;
  deviceId?: string;
  ip?: string;
  details: Record<string, unknown>;
}

export interface AuditQueryOpts {
  kind?: string;
  since?: number;
  until?: number;
  limit?: number;
}

const AUDIT_DIR = join(homedir(), ".rcc");
const AUDIT_FILE = join(AUDIT_DIR, "audit.jsonl");
const ROT_PREFIX = "audit.jsonl.";
const RETENTION_DAYS = 30;
const MEMORY_CAP = 500;
const ENTRY_MAX_BYTES = 8 * 1024;

function todayTag(at = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseTag(name: string): string | null {
  if (!name.startsWith(ROT_PREFIX)) return null;
  const tag = name.slice(ROT_PREFIX.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(tag) ? tag : null;
}

function truncateDetails(details: Record<string, unknown>): Record<string, unknown> {
  try {
    const encoded = JSON.stringify(details);
    if (Buffer.byteLength(encoded, "utf8") <= ENTRY_MAX_BYTES) return details;
    return { truncated: true, preview: encoded.slice(0, ENTRY_MAX_BYTES - 64) };
  } catch {
    return { truncated: true, error: "unserializable" };
  }
}

function parseLine(line: string): AuditEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as AuditEntry;
    if (typeof obj?.ts !== "number" || typeof obj?.kind !== "string") return null;
    if (!obj.details || typeof obj.details !== "object") obj.details = {};
    return obj;
  } catch {
    return null;
  }
}

export class AuditLog {
  private readonly memory: AuditEntry[] = [];
  private currentTag: string;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(tag: string) {
    this.currentTag = tag;
  }

  static async load(): Promise<AuditLog> {
    const log = new AuditLog(todayTag());
    await log.rotateOld();
    await log.hydrateMemory();
    return log;
  }

  write(entry: Omit<AuditEntry, "ts"> & { ts?: number }): void {
    const full: AuditEntry = {
      ts: entry.ts ?? Date.now(),
      kind: entry.kind,
      deviceId: entry.deviceId,
      ip: entry.ip,
      details: truncateDetails(entry.details ?? {}),
    };
    this.memory.push(full);
    if (this.memory.length > MEMORY_CAP) {
      this.memory.splice(0, this.memory.length - MEMORY_CAP);
    }
    this.writeQueue = this.writeQueue.then(() => this.persist(full)).catch((err) => {
      console.warn("[audit] write failed:", (err as Error).message);
    });
  }

  async query(opts: AuditQueryOpts = {}): Promise<AuditEntry[]> {
    const limit = Math.max(1, Math.min(10_000, opts.limit ?? 500));
    const since = opts.since ?? 0;
    const until = opts.until ?? Number.MAX_SAFE_INTEGER;
    const kind = opts.kind?.trim() || undefined;

    const seen = new Set<string>();
    const collected: AuditEntry[] = [];

    const accept = (e: AuditEntry): boolean => {
      if (e.ts < since || e.ts > until) return false;
      if (kind && !e.kind.startsWith(kind)) return false;
      const key = `${e.ts}|${e.kind}|${e.deviceId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };

    for (let i = this.memory.length - 1; i >= 0; i--) {
      const e = this.memory[i]!;
      if (accept(e)) collected.push(e);
      if (collected.length >= limit) return collected;
    }

    const files = await this.listRotatedFiles(/* newestFirst */ true);
    const todaySoFarCount = this.memory.length;
    const scanToday = todaySoFarCount === 0;
    const paths: string[] = [];
    if (scanToday) paths.push(AUDIT_FILE);
    for (const f of files) paths.push(join(AUDIT_DIR, f));

    for (const p of paths) {
      if (collected.length >= limit) break;
      let raw: string;
      try {
        raw = await readFile(p, "utf8");
      } catch {
        continue;
      }
      const lines = raw.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const e = parseLine(lines[i]!);
        if (!e) continue;
        if (accept(e)) collected.push(e);
        if (collected.length >= limit) break;
      }
    }

    return collected;
  }

  async rotateOld(): Promise<void> {
    try {
      await this.rotateIfNewDay();
    } catch (err) {
      console.warn("[audit] rotate failed:", (err as Error).message);
    }
    try {
      const entries = await readdir(AUDIT_DIR);
      const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60_000;
      for (const name of entries) {
        const tag = parseTag(name);
        if (!tag) continue;
        const when = new Date(tag + "T00:00:00Z").getTime();
        if (Number.isFinite(when) && when < cutoff) {
          await unlink(join(AUDIT_DIR, name)).catch(() => {});
        }
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.warn("[audit] retention purge failed:", (err as Error).message);
      }
    }
  }

  private async rotateIfNewDay(): Promise<void> {
    const today = todayTag();
    if (today === this.currentTag) {
      try {
        await stat(AUDIT_FILE);
      } catch {
        return;
      }
    }
    let st;
    try {
      st = await stat(AUDIT_FILE);
    } catch {
      this.currentTag = today;
      return;
    }
    const fileTag = todayTag(new Date(st.mtimeMs));
    if (fileTag === today) {
      this.currentTag = today;
      return;
    }
    const rotated = join(AUDIT_DIR, ROT_PREFIX + fileTag);
    try {
      await rename(AUDIT_FILE, rotated);
    } catch {
      const raw = await readFile(AUDIT_FILE, "utf8").catch(() => "");
      if (raw) await writeFile(rotated, raw, { mode: 0o600 });
      await writeFile(AUDIT_FILE, "", { mode: 0o600 });
    }
    this.currentTag = today;
  }

  private async listRotatedFiles(newestFirst: boolean): Promise<string[]> {
    try {
      const names = await readdir(AUDIT_DIR);
      const tagged = names
        .map((n) => ({ name: n, tag: parseTag(n) }))
        .filter((x): x is { name: string; tag: string } => x.tag !== null)
        .sort((a, b) => (newestFirst ? b.tag.localeCompare(a.tag) : a.tag.localeCompare(b.tag)));
      return tagged.map((x) => x.name);
    } catch {
      return [];
    }
  }

  private async hydrateMemory(): Promise<void> {
    const loaded: AuditEntry[] = [];
    try {
      const raw = await readFile(AUDIT_FILE, "utf8");
      for (const line of raw.split("\n")) {
        const e = parseLine(line);
        if (e) loaded.push(e);
      }
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.warn("[audit] hydrate failed:", (err as Error).message);
      }
    }
    if (loaded.length < MEMORY_CAP) {
      const files = await this.listRotatedFiles(true);
      for (const f of files) {
        if (loaded.length >= MEMORY_CAP) break;
        try {
          const raw = await readFile(join(AUDIT_DIR, f), "utf8");
          const older: AuditEntry[] = [];
          for (const line of raw.split("\n")) {
            const e = parseLine(line);
            if (e) older.push(e);
          }
          const need = MEMORY_CAP - loaded.length;
          const slice = older.slice(Math.max(0, older.length - need));
          loaded.unshift(...slice);
        } catch {
          // ignore
        }
      }
    }
    const tail = loaded.slice(Math.max(0, loaded.length - MEMORY_CAP));
    this.memory.push(...tail);
  }

  private async persist(entry: AuditEntry): Promise<void> {
    await this.rotateIfNewDay();
    await mkdir(dirname(AUDIT_FILE), { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    await appendFile(AUDIT_FILE, line, { mode: 0o600 });
  }
}

export const auditLogPath = AUDIT_FILE;
