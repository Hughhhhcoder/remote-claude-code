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
}

export function isEnvelope(obj: unknown): obj is E2EEnvelope {
  return (
    !!obj &&
    typeof obj === "object" &&
    (obj as { e2e?: unknown }).e2e === 1 &&
    typeof (obj as { n?: unknown }).n === "string" &&
    typeof (obj as { c?: unknown }).c === "string"
  );
}

/** Encrypt a JSON-serialisable frame with secretbox_easy under the device key. */
export function encryptFrame(keyB64: string, frame: unknown): string {
  const key = sodium.from_base64(keyB64, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const plaintext = sodium.from_string(JSON.stringify(frame));
  const cipher = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const env: E2EEnvelope = {
    e2e: 1,
    n: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    c: sodium.to_base64(cipher, sodium.base64_variants.ORIGINAL),
  };
  return JSON.stringify(env);
}

/** Returns the decoded JSON object or null on any failure (auth / decode). */
export function decryptEnvelope(keyB64: string, env: E2EEnvelope): unknown | null {
  try {
    const key = sodium.from_base64(keyB64, sodium.base64_variants.ORIGINAL);
    const nonce = sodium.from_base64(env.n, sodium.base64_variants.ORIGINAL);
    const cipher = sodium.from_base64(env.c, sodium.base64_variants.ORIGINAL);
    const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, key);
    return JSON.parse(sodium.to_string(plain));
  } catch {
    return null;
  }
}

export async function ensureSodiumReady(): Promise<void> {
  await sodium.ready;
}
