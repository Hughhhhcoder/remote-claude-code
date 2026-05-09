import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

/**
 * Web Push module — VAPID bootstrap + subscription storage + sender.
 *
 * Keys live in `~/.rcc/config.json` (shared future home for host config):
 *   { "vapid": { "publicKey": "...", "privateKey": "...", "subject": "mailto:..." } }
 *
 * Subscriptions live in `~/.rcc/push-subs.json`:
 *   [{ deviceId, endpoint, keys: { p256dh, auth }, createdAt }]
 *
 * Both files are created with mode 0600. The private VAPID key is NEVER
 * exposed to clients (only `getPublicKey()` is safe to share).
 */

export interface PushSubRecord {
  deviceId: string | null;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
}

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

interface RccConfigFile {
  vapid?: VapidConfig;
  [k: string]: unknown;
}

function configPath(): string {
  return join(homedir(), ".rcc", "config.json");
}

function subsPath(): string {
  return join(homedir(), ".rcc", "push-subs.json");
}

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`[push] could not read ${path}: ${err?.message ?? err}`);
    }
    return fallback;
  }
}

async function writeSecureJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = JSON.stringify(data, null, 2);
  await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch {
    // best-effort on non-POSIX
  }
}

export class PushService {
  private vapid: VapidConfig;
  private subs: PushSubRecord[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(vapid: VapidConfig, subs: PushSubRecord[]) {
    this.vapid = vapid;
    this.subs = subs;
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  static async load(): Promise<PushService> {
    const cfg = await readJsonSafe<RccConfigFile>(configPath(), {});
    let vapid = cfg.vapid;
    if (!vapid || !vapid.publicKey || !vapid.privateKey) {
      const gen = webpush.generateVAPIDKeys();
      vapid = {
        publicKey: gen.publicKey,
        privateKey: gen.privateKey,
        subject: (cfg.vapid?.subject as string | undefined) ?? "mailto:rcc@localhost",
      };
      await writeSecureJson(configPath(), { ...cfg, vapid });
      console.log(`[push] generated new VAPID keypair in ${configPath()}`);
    }

    const subs = await readJsonSafe<PushSubRecord[]>(subsPath(), []);
    // Ensure file exists with 0600 even if empty.
    if (!Array.isArray(subs) || subs.length === 0) {
      await writeSecureJson(subsPath(), subs.length ? subs : []);
    }
    return new PushService(vapid, Array.isArray(subs) ? subs : []);
  }

  getPublicKey(): string {
    return this.vapid.publicKey;
  }

  /** Register or replace a subscription (dedup by endpoint). */
  async subscribe(sub: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    deviceId?: string | null;
  }): Promise<void> {
    const existing = this.subs.findIndex((s) => s.endpoint === sub.endpoint);
    const rec: PushSubRecord = {
      deviceId: sub.deviceId ?? null,
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      createdAt: existing >= 0 ? this.subs[existing]!.createdAt : Date.now(),
    };
    if (existing >= 0) this.subs[existing] = rec;
    else this.subs.push(rec);
    await this.persist();
  }

  async unsubscribe(endpoint: string): Promise<boolean> {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    if (this.subs.length === before) return false;
    await this.persist();
    return true;
  }

  listByDevice(deviceId: string): PushSubRecord[] {
    return this.subs.filter((s) => s.deviceId === deviceId);
  }

  all(): PushSubRecord[] {
    return [...this.subs];
  }

  /** Send to a single subscription; auto-prune on 404/410. */
  async sendOne(sub: PushSubRecord, payload: PushPayload): Promise<boolean> {
    const pushSub: WebPushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    };
    try {
      await webpush.sendNotification(pushSub, JSON.stringify(payload), {
        TTL: 60,
      });
      return true;
    } catch (err: any) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        // Gone — drop from storage.
        this.subs = this.subs.filter((s) => s.endpoint !== sub.endpoint);
        await this.persist();
      } else {
        console.warn(`[push] send failed (${code ?? "?"}): ${err?.message ?? err}`);
      }
      return false;
    }
  }

  /** Broadcast to all subscriptions (or filtered to given deviceIds). */
  async broadcast(target: "all" | string[], payload: PushPayload): Promise<number> {
    const targets =
      target === "all"
        ? this.all()
        : this.subs.filter((s) => s.deviceId && target.includes(s.deviceId));
    if (targets.length === 0) return 0;
    const results = await Promise.allSettled(targets.map((s) => this.sendOne(s, payload)));
    let ok = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) ok++;
    }
    return ok;
  }

  /** Remove all subscriptions tied to a revoked device. */
  async revokeDevice(deviceId: string): Promise<number> {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => s.deviceId !== deviceId);
    const removed = before - this.subs.length;
    if (removed > 0) await this.persist();
    return removed;
  }

  private async persist(): Promise<void> {
    // Debounce writes a touch to avoid hammering disk on bursts.
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await new Promise<void>((resolve) => {
      this.saveTimer = setTimeout(async () => {
        try {
          await writeSecureJson(subsPath(), this.subs);
        } catch (err) {
          console.warn(`[push] failed to persist subs:`, err);
        }
        resolve();
      }, 50);
    });
  }
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
}
