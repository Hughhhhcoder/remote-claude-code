import type { IncomingMessage, ServerResponse } from "node:http";
import type { TrustStore, PairingCodes } from "./trust.ts";
import { deriveSharedKey, type HostKeypair } from "./e2e.ts";

interface PairDeps {
  trust: TrustStore;
  codes: PairingCodes;
  /**
   * Host's long-term X25519 keypair. Its public half is returned on a
   * successful /pair/claim so the client can derive the same shared secret
   * via ECDH and enable app-layer E2E encryption.
   */
  hostKeys: HostKeypair;
  /** Called when a new pairing code is created so the host can surface it to the user. */
  onCodeCreated?: (code: string) => void;
}

function readJson<T>(req: IncomingMessage, max = 16 * 1024): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? (JSON.parse(text) as T) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/**
 * Pairing flow (simplified, no WebAuthn yet):
 *
 *   1. UI on new device → POST /pair/new
 *      host: generate a 6-digit code, print it to its own terminal,
 *            return { code, claimSecret, expiresAt }.
 *   2. User reads code from host terminal (physical access), types it on UI.
 *   3. UI → POST /pair/claim  with { code, claimSecret, deviceName }.
 *      (claimSecret proves the UI is the same one that started step 1,
 *       preventing someone else on the same network from stealing the code.)
 *      host: match code + claimSecret, mint a device token, store its hash.
 *   4. UI stores the token, uses it for every WebSocket / HTTP call.
 *
 * A token is permanent until revoked from the host (CLI or UI).
 */
export function handlePairRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PairDeps,
): boolean {
  const url = req.url ?? "";
  if (!url.startsWith("/pair/")) return false;

  if (url === "/pair/new" && req.method === "POST") {
    handleNew(res, deps).catch((err) => sendJson(res, 500, { error: String(err.message ?? err) }));
    return true;
  }
  if (url === "/pair/claim" && req.method === "POST") {
    handleClaim(req, res, deps).catch((err) => sendJson(res, 500, { error: String(err.message ?? err) }));
    return true;
  }
  if (url.startsWith("/pair/status") && req.method === "GET") {
    sendJson(res, 200, { paired: deps.trust.devices().length });
    return true;
  }
  sendJson(res, 404, { error: "unknown pair route" });
  return true;
}

async function handleNew(res: ServerResponse, deps: PairDeps): Promise<void> {
  const entry = deps.codes.create();
  deps.onCodeCreated?.(entry.code);
  sendJson(res, 200, {
    code: entry.code,
    claimSecret: entry.claimSecret,
    expiresAt: entry.expiresAt,
    ttlMs: entry.expiresAt - entry.createdAt,
  });
}

async function handleClaim(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PairDeps,
): Promise<void> {
  let body: { code?: string; claimSecret?: string; deviceName?: string; pub?: string };
  try {
    body = await readJson(req);
  } catch (err: any) {
    sendJson(res, 400, { error: err.message ?? "invalid body" });
    return;
  }
  const { code, claimSecret, deviceName, pub } = body;
  if (!code || !claimSecret) {
    sendJson(res, 400, { error: "code and claimSecret required" });
    return;
  }
  const entry = deps.codes.get(code);
  if (!entry) {
    sendJson(res, 404, { error: "code expired or unknown" });
    return;
  }
  if (entry.claimSecret !== claimSecret) {
    // Don't reveal whether the code exists vs. the secret is wrong.
    sendJson(res, 404, { error: "code expired or unknown" });
    return;
  }
  const claimed = deps.codes.claim(code);
  if (!claimed) {
    sendJson(res, 409, { error: "already claimed" });
    return;
  }
  const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
  // Derive a per-device shared key if the client provided its X25519 public
  // key. Older clients that don't know about E2E simply omit `pub` and stay
  // on the plaintext path.
  let sharedKey: string | undefined;
  if (pub && typeof pub === "string") {
    try {
      sharedKey = deriveSharedKey({ hostPriv: deps.hostKeys.priv, devicePub: pub });
    } catch (err: any) {
      sendJson(res, 400, { error: `invalid pub: ${err.message ?? err}` });
      return;
    }
  }
  const { device, token } = await deps.trust.addDevice({
    name: deviceName || "unnamed device",
    userAgent,
    sharedKey,
  });
  sendJson(res, 200, {
    token,
    device: {
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
    },
    hostId: deps.trust.hostId,
    hostPub: deps.hostKeys.pub,
  });
}
