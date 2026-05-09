import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ShareEntry {
  id: string;
  tokenHash: string;
  sid: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string | null;
  revoked: boolean;
}

export interface ShareVerifyOk {
  ok: true;
  entry: ShareEntry;
}

export interface ShareVerifyErr {
  ok: false;
  reason: "not_found" | "expired" | "revoked";
}

interface ShareStoreFile {
  version: 1;
  shares: ShareEntry[];
}

function defaultPath(): string {
  return join(homedir(), ".rcc", "shares.json");
}

function newId(): string {
  return `shr_${randomBytes(6).toString("base64url")}`;
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class ShareStore {
  private data: ShareStoreFile;
  private readonly path: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private skipNextWatch = false;
  private readonly changeListeners = new Set<() => void>();

  private constructor(path: string, data: ShareStoreFile) {
    this.path = path;
    this.data = data;
    this.startWatcher();
  }

  static async load(path = defaultPath()): Promise<ShareStore> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as ShareStoreFile;
      if (parsed.version !== 1) throw new Error("unknown shares.json version");
      const store = new ShareStore(path, parsed);
      await store.purge();
      return store;
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[shares] failed to load ${path}, starting fresh:`, err.message);
      }
      const fresh: ShareStoreFile = { version: 1, shares: [] };
      const store = new ShareStore(path, fresh);
      await store.save();
      return store;
    }
  }

  async create(opts: {
    sid: string;
    ttlMinutes: number;
    createdBy: string | null;
  }): Promise<{ entry: ShareEntry; token: string }> {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const ttlMs = Math.max(1, Math.floor(opts.ttlMinutes)) * 60_000;
    const entry: ShareEntry = {
      id: newId(),
      tokenHash: hashShareToken(token),
      sid: opts.sid,
      createdAt: now,
      expiresAt: now + ttlMs,
      createdBy: opts.createdBy,
      revoked: false,
    };
    this.data.shares.push(entry);
    await this.save();
    return { entry, token };
  }

  verify(token: string): ShareVerifyOk | ShareVerifyErr {
    if (!token) return { ok: false, reason: "not_found" };
    const hash = hashShareToken(token);
    const entry = this.data.shares.find((s) => s.tokenHash === hash);
    if (!entry) return { ok: false, reason: "not_found" };
    if (entry.revoked) return { ok: false, reason: "revoked" };
    if (entry.expiresAt < Date.now()) return { ok: false, reason: "expired" };
    return { ok: true, entry };
  }

  async revoke(id: string): Promise<boolean> {
    const entry = this.data.shares.find((s) => s.id === id);
    if (!entry) return false;
    if (entry.revoked) return true;
    entry.revoked = true;
    await this.save();
    return true;
  }

  list(filter?: { sid?: string }): ShareEntry[] {
    const now = Date.now();
    return this.data.shares
      .filter((s) => !filter?.sid || s.sid === filter.sid)
      .map((s) => ({ ...s }))
      .filter((s) => !s.revoked && s.expiresAt > now);
  }

  listAll(): readonly ShareEntry[] {
    return this.data.shares;
  }

  findById(id: string): ShareEntry | null {
    return this.data.shares.find((s) => s.id === id) ?? null;
  }

  onExternalChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private async purge(): Promise<void> {
    const now = Date.now();
    const before = this.data.shares.length;
    // Drop expired-for-more-than-1h OR revoked-for-more-than-1h so the file
    // doesn't grow unbounded. Still-live shares and recently-dead ones stay
    // so `verify()` can return meaningful reasons.
    const cutoff = now - 60 * 60_000;
    this.data.shares = this.data.shares.filter((s) => {
      if (s.revoked) return s.createdAt > cutoff && s.expiresAt > cutoff;
      return s.expiresAt > cutoff;
    });
    if (this.data.shares.length !== before) {
      await this.save();
    }
  }

  stopWatching(): void {
    unwatchFile(this.path);
  }

  private startWatcher(): void {
    watchFile(this.path, { interval: 1000, persistent: false }, (cur, prev) => {
      if (cur.mtimeMs === prev.mtimeMs) return;
      if (this.skipNextWatch) {
        this.skipNextWatch = false;
        return;
      }
      this.reload().catch((err) =>
        console.warn("[shares] reload failed:", err.message ?? err),
      );
    });
  }

  private async reload(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as ShareStoreFile;
      if (parsed.version !== 1) return;
      this.data = parsed;
      for (const l of this.changeListeners) l();
    } catch {
      // mid-write; ignore
    }
  }

  private async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.skipNextWatch = true;
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp";
    await writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
