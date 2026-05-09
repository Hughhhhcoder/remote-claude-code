import sodium from "libsodium-wrappers";

const KEY = "rcc.token";
const DEV_KEY = "rcc.device";
const E2E_KEY = "rcc.e2e.key";

export interface StoredDevice {
  id: string;
  name: string;
  hostId: string;
}

export function loadToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // ignore
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(DEV_KEY);
    localStorage.removeItem(E2E_KEY);
  } catch {
    // ignore
  }
}

export function loadDevice(): StoredDevice | null {
  try {
    const raw = localStorage.getItem(DEV_KEY);
    return raw ? (JSON.parse(raw) as StoredDevice) : null;
  } catch {
    return null;
  }
}

export function saveDevice(d: StoredDevice): void {
  try {
    localStorage.setItem(DEV_KEY, JSON.stringify(d));
  } catch {
    // ignore
  }
}

/** Base64 X25519 shared secret with the host, derived at pairing time. */
export function loadE2EKey(): string | null {
  try {
    return localStorage.getItem(E2E_KEY);
  } catch {
    return null;
  }
}

export function saveE2EKey(keyB64: string): void {
  try {
    localStorage.setItem(E2E_KEY, keyB64);
  } catch {
    // ignore
  }
}

export interface PairingCodeResponse {
  code: string;
  claimSecret: string;
  expiresAt: number;
  ttlMs: number;
}

export interface PairingClaimResponse {
  token: string;
  device: { id: string; name: string; createdAt: number };
  hostId: string;
  /** Host's long-term X25519 public key, base64. Present when the host
   * supports E2E; older hosts omit it and the client stays on plaintext. */
  hostPub?: string;
}

export async function requestPairingCode(): Promise<PairingCodeResponse> {
  const resp = await fetch("/pair/new", { method: "POST" });
  if (!resp.ok) throw new Error(`/pair/new failed: ${resp.status}`);
  return resp.json();
}

export async function claimPairing(opts: {
  code: string;
  claimSecret: string;
  deviceName: string;
}): Promise<PairingClaimResponse & { e2eKey: string | null }> {
  await sodium.ready;
  // Generate a per-device X25519 keypair. The private half never leaves
  // memory — it's only used once to derive the shared secret and then
  // discarded. The shared secret is what we persist.
  const kp = sodium.crypto_box_keypair();
  const pubB64 = sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL);
  const resp = await fetch("/pair/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...opts, pub: pubB64 }),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `/pair/claim failed: ${resp.status}`);
  }
  const data = (await resp.json()) as PairingClaimResponse;
  let e2eKey: string | null = null;
  if (data.hostPub) {
    try {
      const hostPub = sodium.from_base64(data.hostPub, sodium.base64_variants.ORIGINAL);
      const shared = sodium.crypto_scalarmult(kp.privateKey, hostPub);
      e2eKey = sodium.to_base64(shared, sodium.base64_variants.ORIGINAL);
    } catch (err) {
      console.warn("[rcc] failed to derive E2E key:", err);
    }
  }
  return { ...data, e2eKey };
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Browser";
}

export { defaultDeviceName };
