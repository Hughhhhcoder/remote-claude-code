import { chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, SessionMeta } from "@rcc/protocol";

export interface SessionSnapshot {
  meta: SessionMeta & { lastActiveAt: number };
  chat: ChatMessage[];
  ringTail: string;
}

export const SESSIONS_DIR = join(homedir(), ".rcc", "sessions");
const MAX_CHAT = 100;
const MAX_RING_TAIL = 32 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const IDLE_PURGE_MS = 30 * 24 * 60 * 60 * 1000;

function fileFor(sid: string): string {
  return join(SESSIONS_DIR, `${sid}.json`);
}

async function ensureDir(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true, mode: 0o700 });
}

function trimSnapshot(snap: SessionSnapshot): SessionSnapshot {
  const chat = snap.chat.slice(-MAX_CHAT);
  let ringTail = snap.ringTail;
  if (ringTail.length > MAX_RING_TAIL) ringTail = ringTail.slice(-MAX_RING_TAIL);
  let out: SessionSnapshot = { meta: snap.meta, chat, ringTail };
  let buf = Buffer.byteLength(JSON.stringify(out), "utf8");
  // Fallback: drop older chat in chunks if a huge message still blows the cap.
  while (buf > MAX_FILE_BYTES && out.chat.length > 0) {
    out = { ...out, chat: out.chat.slice(Math.ceil(out.chat.length / 2)) };
    buf = Buffer.byteLength(JSON.stringify(out), "utf8");
  }
  if (buf > MAX_FILE_BYTES) {
    out = { ...out, ringTail: "" };
  }
  return out;
}

export async function saveSnapshot(snap: SessionSnapshot): Promise<void> {
  await ensureDir();
  const trimmed = trimSnapshot(snap);
  const path = fileFor(trimmed.meta.id);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(trimmed);
  await writeFile(tmp, body, { mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
  } catch {
    // best effort
  }
  await rename(tmp, path);
}

export async function deleteSnapshot(sid: string): Promise<void> {
  try {
    await unlink(fileFor(sid));
  } catch {
    // missing is fine
  }
}

export async function loadAllSnapshots(): Promise<SessionSnapshot[]> {
  try {
    await ensureDir();
  } catch {
    return [];
  }
  let entries: string[];
  try {
    entries = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }
  const out: SessionSnapshot[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = join(SESSIONS_DIR, name);
    try {
      const raw = await readFile(path, "utf8");
      if (raw.length > MAX_FILE_BYTES * 2) continue;
      const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
      if (!parsed || !parsed.meta || typeof parsed.meta !== "object") continue;
      const meta = parsed.meta as SessionMeta & { lastActiveAt?: number };
      if (!meta.id || typeof meta.id !== "string") continue;
      const chat = Array.isArray(parsed.chat) ? (parsed.chat as ChatMessage[]) : [];
      const ringTail = typeof parsed.ringTail === "string" ? parsed.ringTail : "";
      const lastActiveAt =
        typeof meta.lastActiveAt === "number" ? meta.lastActiveAt : Date.now();
      out.push({
        meta: { ...meta, lastActiveAt, status: "exited" },
        chat,
        ringTail,
      });
    } catch {
      // corrupt or unreadable — skip
    }
  }
  return out;
}

export async function purgeAll(): Promise<number> {
  try {
    await ensureDir();
  } catch {
    return 0;
  }
  let entries: string[];
  try {
    entries = await readdir(SESSIONS_DIR);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      await unlink(join(SESSIONS_DIR, name));
      n++;
    } catch {
      // ignore
    }
  }
  return n;
}

export async function purgeStale(nowMs = Date.now()): Promise<number> {
  const snaps = await loadAllSnapshots();
  let n = 0;
  for (const s of snaps) {
    if (nowMs - s.meta.lastActiveAt > IDLE_PURGE_MS) {
      await deleteSnapshot(s.meta.id);
      n++;
    }
  }
  return n;
}

/**
 * Collapse rapid-fire save requests so we only touch disk at most once per
 * `delayMs`. `schedule()` arms a trailing-edge timer; `flush()` is synchronous
 * if no timer is armed and otherwise awaits the in-flight write.
 */
export class Debouncer {
  private timer: NodeJS.Timeout | null = null;
  private pending: Promise<void> | null = null;
  constructor(
    private readonly fn: () => Promise<void>,
    private readonly delayMs: number,
  ) {}

  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pending = this.fn().catch(() => {
        // swallow — persistence failures shouldn't crash the host
      });
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.pending = this.fn().catch(() => {});
    }
    if (this.pending) await this.pending;
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
