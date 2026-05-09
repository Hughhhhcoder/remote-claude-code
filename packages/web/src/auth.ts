const KEY = "rcc.token";
const DEV_KEY = "rcc.device";

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
}): Promise<PairingClaimResponse> {
  const resp = await fetch("/pair/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `/pair/claim failed: ${resp.status}`);
  }
  return resp.json();
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
