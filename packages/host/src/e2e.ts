import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as sodium from "libsodium-wrappers";

export interface HostKeypair {
  pub: string;
  priv: string;
}

function defaultKeysPath(): string {
  return join(homedir(), ".rcc", "keys.json");
}

/**
 * Load (or lazily generate) the host's long-term X25519 keypair used for
 * deriving per-device shared secrets during pairing. Stored at
 * `~/.rcc/keys.json` with 0600 mode — losing this file rotates the host's
 * identity and invalidates every device's E2E key (they'd need to re-pair).
 */
export async function loadOrCreateHostKeys(path = defaultKeysPath()): Promise<HostKeypair> {
  await sodium.ready;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as HostKeypair;
    if (typeof parsed.pub === "string" && typeof parsed.priv === "string") {
      return parsed;
    }
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.warn(`[e2e] failed to load host keys at ${path}, regenerating:`, err.message);
    }
  }
  const kp = sodium.crypto_box_keypair();
  const out: HostKeypair = {
    pub: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    priv: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
  };
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
  await rename(tmp, path);
  return out;
}

/**
 * ECDH → 32-byte shared symmetric key. Both sides compute the same value:
 *   host: scalarmult(host_priv, device_pub)
 *   dev:  scalarmult(device_priv, host_pub)
 * Returned as base64 so it can be persisted / sent in JSON.
 */
export function deriveSharedKey(opts: { hostPriv: string; devicePub: string }): string {
  const priv = sodium.from_base64(opts.hostPriv, sodium.base64_variants.ORIGINAL);
  const pub = sodium.from_base64(opts.devicePub, sodium.base64_variants.ORIGINAL);
  const shared = sodium.crypto_scalarmult(priv, pub);
  return sodium.to_base64(shared, sodium.base64_variants.ORIGINAL);
}

export interface E2EEnvelope {
  e2e: 1;
  n: string;
  c: string;
  s: number;
  ts: number;
}

export function isEnvelope(obj: unknown): obj is E2EEnvelope {
  return (
    !!obj &&
    typeof obj === "object" &&
    (obj as { e2e?: unknown }).e2e === 1 &&
    typeof (obj as { n?: unknown }).n === "string" &&
    typeof (obj as { c?: unknown }).c === "string" &&
    typeof (obj as { s?: unknown }).s === "number" &&
    typeof (obj as { ts?: unknown }).ts === "number"
  );
}

/** Encrypt a JSON-serialisable frame with secretbox_easy under the device key.
 * `seq` is a per-direction monotonic counter (uint32, wraps at 2^32) and `ts`
 * is a send-wall-clock ms — both are attached in the clear inside the envelope
 * so the peer can enforce replay + skew checks before decryption cost. They
 * are not authenticated by the secretbox MAC, which is fine: tampering with
 * `s` or `ts` cannot forge a decrypt; worst case it triggers a replay reject
 * and the connection is closed with 4402. */
export function encryptFrame(keyB64: string, frame: unknown, seq: number, ts: number): string {
  const key = sodium.from_base64(keyB64, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const plaintext = sodium.from_string(JSON.stringify(frame));
  const cipher = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const env: E2EEnvelope = {
    e2e: 1,
    n: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    c: sodium.to_base64(cipher, sodium.base64_variants.ORIGINAL),
    s: seq >>> 0,
    ts,
  };
  return JSON.stringify(env);
}

export interface DecryptedFrame {
  obj: unknown;
  seq: number;
  ts: number;
}

/** Returns the decoded JSON object + envelope metadata or null on any failure
 * (auth / decode). Caller is responsible for replay + skew checks. */
export function decryptEnvelope(keyB64: string, env: E2EEnvelope): DecryptedFrame | null {
  try {
    const key = sodium.from_base64(keyB64, sodium.base64_variants.ORIGINAL);
    const nonce = sodium.from_base64(env.n, sodium.base64_variants.ORIGINAL);
    const cipher = sodium.from_base64(env.c, sodium.base64_variants.ORIGINAL);
    const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, key);
    const obj = JSON.parse(sodium.to_string(plain));
    return { obj, seq: env.s >>> 0, ts: env.ts };
  } catch {
    return null;
  }
}

/** ±60s wall-clock skew gate. Defensive against long-delayed replays even if
 * they'd otherwise slip inside a stale window after reconnect. */
export const TIMESTAMP_SKEW_MS = 60_000;

export function timestampWithinSkew(ts: number, now = Date.now()): boolean {
  return Math.abs(now - ts) <= TIMESTAMP_SKEW_MS;
}

export type ReplayCheck = "ok" | "replay" | "too_old";

/** Fixed 64-slot sliding window. `highest` is the largest seq accepted so far;
 * `mask` is a BigInt bitmap covering [highest-63 .. highest] — bit 0 is
 * `highest`, bit i is `highest - i`. Incoming seqs past `highest` shift the
 * window; seqs older than `highest - 63` are rejected. Seq is treated as a
 * uint32 monotonic counter; wrap (~4B frames/conn) is not handled — the
 * connection is expected to be torn down well before that. */
export class ReplayWindow {
  private highest = -1;
  private mask = 0n;
  private static readonly SIZE = 64;

  check(seq: number): ReplayCheck {
    const s = seq >>> 0;
    if (this.highest < 0) return "ok";
    if (s > this.highest) return "ok";
    const diff = this.highest - s;
    if (diff >= ReplayWindow.SIZE) return "too_old";
    const bit = 1n << BigInt(diff);
    return (this.mask & bit) !== 0n ? "replay" : "ok";
  }

  apply(seq: number): void {
    const s = seq >>> 0;
    if (this.highest < 0) {
      this.highest = s;
      this.mask = 1n;
      return;
    }
    if (s > this.highest) {
      const shift = s - this.highest;
      if (shift >= ReplayWindow.SIZE) {
        this.mask = 1n;
      } else {
        this.mask = ((this.mask << BigInt(shift)) | 1n) & ((1n << BigInt(ReplayWindow.SIZE)) - 1n);
      }
      this.highest = s;
      return;
    }
    const diff = this.highest - s;
    if (diff < ReplayWindow.SIZE) {
      this.mask |= 1n << BigInt(diff);
    }
  }
}

export async function ensureSodiumReady(): Promise<void> {
  await sodium.ready;
}
