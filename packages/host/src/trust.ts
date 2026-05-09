import { mkdir, readFile, writeFile } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface PairedDevice {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  /**
   * Base64 X25519 ECDH shared secret with this device. Added in M5 batch 1
   * (E2E). Older devices paired before this field existed will be undefined —
   * they continue to work unencrypted until the user re-pairs them.
   */
  sharedKey?: string;
  /**
   * WebAuthn passkey registered by the user for this device. Added in M5
   * batch 6. Token auth remains the primary auth path; passkey is an
   * orthogonal second-factor for high-risk approvals. `publicKey` is a
   * base64url-encoded COSE public key; `counter` is the replay guard.
   */
  passkey?: {
    credId: string;
    publicKey: string;
    counter: number;
    registeredAt: number;
  };
}

interface TrustStoreFile {
  version: 1;
  hostId: string;
  devices: PairedDevice[];
}

function defaultPath(): string {
  return join(homedir(), ".rcc", "trust.json");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("base64url")}`;
}

/**
 * Persisted list of devices trusted to attach to this host. Tokens are never
 * stored in plaintext — only their sha256. Losing the trust file means all
 * devices must re-pair.
 */
export class TrustStore {
  private data: TrustStoreFile;
  private readonly path: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly changeListeners = new Set<() => void>();
  private skipNextWatch = false;

  private constructor(path: string, data: TrustStoreFile) {
    this.path = path;
    this.data = data;
    this.startWatcher();
  }

  static async load(path = defaultPath()): Promise<TrustStore> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as TrustStoreFile;
      if (parsed.version !== 1) throw new Error("unknown trust.json version");
      return new TrustStore(path, parsed);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[trust] failed to load ${path}, starting fresh:`, err.message);
      }
      const fresh: TrustStoreFile = {
        version: 1,
        hostId: newId("host"),
        devices: [],
      };
      const store = new TrustStore(path, fresh);
      await store.save();
      return store;
    }
  }

  get hostId(): string {
    return this.data.hostId;
  }

  devices(): readonly PairedDevice[] {
    return this.data.devices;
  }

  /** Register a new device and return the plaintext token the client should keep. */
  async addDevice(opts: { name: string; userAgent: string | null; sharedKey?: string }): Promise<{ device: PairedDevice; token: string }> {
    const token = randomToken();
    const device: PairedDevice = {
      id: newId("dev"),
      name: opts.name || "unnamed",
      tokenHash: hashToken(token),
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      userAgent: opts.userAgent,
      sharedKey: opts.sharedKey,
    };
    this.data.devices.push(device);
    await this.save();
    return { device, token };
  }

  /** Look up the device a token belongs to. Returns null if the token is unknown. */
  authenticate(token: string): PairedDevice | null {
    if (!token) return null;
    const hash = hashToken(token);
    const found = this.data.devices.find((d) => d.tokenHash === hash);
    return found ?? null;
  }

  async touch(deviceId: string): Promise<void> {
    const d = this.data.devices.find((x) => x.id === deviceId);
    if (!d) return;
    d.lastSeenAt = Date.now();
    this.scheduleSave();
  }

  async revoke(deviceId: string): Promise<boolean> {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((d) => d.id !== deviceId);
    if (this.data.devices.length === before) return false;
    await this.save();
    return true;
  }

  async rename(deviceId: string, name: string): Promise<boolean> {
    const d = this.data.devices.find((x) => x.id === deviceId);
    if (!d) return false;
    d.name = name;
    await this.save();
    return true;
  }

  async addPasskey(
    deviceId: string,
    passkey: { credId: string; publicKey: string; counter: number },
  ): Promise<boolean> {
    const d = this.data.devices.find((x) => x.id === deviceId);
    if (!d) return false;
    d.passkey = { ...passkey, registeredAt: Date.now() };
    await this.save();
    return true;
  }

  async clearPasskey(deviceId: string): Promise<boolean> {
    const d = this.data.devices.find((x) => x.id === deviceId);
    if (!d || !d.passkey) return false;
    delete d.passkey;
    await this.save();
    return true;
  }

  async updatePasskeyCounter(deviceId: string, counter: number): Promise<boolean> {
    const d = this.data.devices.find((x) => x.id === deviceId);
    if (!d?.passkey) return false;
    d.passkey.counter = counter;
    this.scheduleSave();
    return true;
  }

  onExternalChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private startWatcher(): void {
    watchFile(this.path, { interval: 1500, persistent: false }, (cur, prev) => {
      if (cur.mtimeMs === prev.mtimeMs) return;
      if (this.skipNextWatch) {
        this.skipNextWatch = false;
        return;
      }
      this.reload().catch((err) =>
        console.warn("[trust] reload failed:", err.message ?? err),
      );
    });
  }

  stopWatching(): void {
    unwatchFile(this.path);
  }

  private async reload(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as TrustStoreFile;
      if (parsed.version !== 1) return;
      this.data = parsed;
      for (const l of this.changeListeners) l();
    } catch {
      // file may be mid-write; just ignore
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch((err) => console.error("[trust] save failed:", err));
    }, 1000);
  }

  private async save(): Promise<void> {
    this.skipNextWatch = true;
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp";
    await writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    const { rename } = await import("node:fs/promises");
    await rename(tmp, this.path);
  }
}

/**
 * In-memory store of active pairing codes. Codes expire automatically.
 * Not persisted: if the host restarts before a code is claimed, user can
 * just generate a new one.
 */
export interface PairingCode {
  code: string;
  /** random token returned on claim, grants client its own device token */
  claimSecret: string;
  expiresAt: number;
  claimed: boolean;
  createdAt: number;
}

export class PairingCodes {
  private readonly codes = new Map<string, PairingCode>();
  private readonly ttlMs: number;
  private readonly gcInterval: ReturnType<typeof setInterval>;

  constructor(ttlMs = 5 * 60_000) {
    this.ttlMs = ttlMs;
    this.gcInterval = setInterval(() => this.gc(), 30_000);
    this.gcInterval.unref?.();
  }

  create(): PairingCode {
    // 6-digit code, grouped as "482 917" for display
    const digits = randomBytes(3).readUIntBE(0, 3).toString().padStart(6, "0").slice(-6);
    const entry: PairingCode = {
      code: digits,
      claimSecret: randomToken(16),
      expiresAt: Date.now() + this.ttlMs,
      claimed: false,
      createdAt: Date.now(),
    };
    this.codes.set(digits, entry);
    return entry;
  }

  get(code: string): PairingCode | null {
    const e = this.codes.get(code);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.codes.delete(code);
      return null;
    }
    return e;
  }

  /** Mark as claimed and delete (one-shot). Returns the code if it was valid. */
  claim(code: string): PairingCode | null {
    const e = this.get(code);
    if (!e || e.claimed) return null;
    e.claimed = true;
    this.codes.delete(code);
    return e;
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) {
      if (v.expiresAt < now) this.codes.delete(k);
    }
  }
}
