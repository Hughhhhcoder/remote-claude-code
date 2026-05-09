import type { RccClient } from "./client.ts";

/**
 * Web Push client helper.
 *
 * Flow:
 *  1. Ask for Notification permission (user gesture required on iOS/desktop).
 *  2. Fetch the host's VAPID public key via `push.public-key.request`.
 *  3. Register / reuse the service worker and subscribe via pushManager.
 *  4. Ship the subscription to the host with `push.subscribe` so it can
 *     send notifications via web-push later.
 *
 * We re-subscribe lazily — if the browser has a subscription but the host
 * doesn't know about it (fresh install, new device), we still send it up
 * every time enablePush() is called. That's an idempotent upsert on the
 * host side (dedup by endpoint).
 */

export type PushStatus =
  | "unsupported"
  | "denied"
  | "default"
  | "granted-off"
  | "granted-on";

export interface PushState {
  status: PushStatus;
  endpoint: string | null;
}

function isSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.warn("[push] sw register failed", err);
    return null;
  }
}

function requestPublicKey(client: RccClient, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("push.public-key timeout"));
    }, timeoutMs);
    const unsub = client.on((frame) => {
      if (frame.t === "push.public-key") {
        clearTimeout(timer);
        unsub();
        resolve(frame.key);
      }
    });
    client.send({ v: 1, t: "push.public-key.request" });
  });
}

/** Current permission + subscription state, for UI rendering. */
export async function getPushStatus(): Promise<PushState> {
  if (!isSupported()) return { status: "unsupported", endpoint: null };
  const perm = Notification.permission;
  if (perm === "denied") return { status: "denied", endpoint: null };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (perm === "granted") {
    return {
      status: sub ? "granted-on" : "granted-off",
      endpoint: sub?.endpoint ?? null,
    };
  }
  return { status: "default", endpoint: null };
}

export async function enablePush(client: RccClient): Promise<PushState> {
  if (!isSupported()) return { status: "unsupported", endpoint: null };

  // Request permission if not already granted.
  if (Notification.permission === "default") {
    const res = await Notification.requestPermission();
    if (res !== "granted") {
      return { status: res === "denied" ? "denied" : "default", endpoint: null };
    }
  }
  if (Notification.permission !== "granted") {
    return { status: "denied", endpoint: null };
  }

  const reg = await getRegistration();
  if (!reg) return { status: "unsupported", endpoint: null };

  const publicKey = await requestPublicKey(client);
  const applicationServerKey = urlBase64ToUint8Array(publicKey);

  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // If an existing subscription was created for a different VAPID key, it
    // won't work — drop it and resubscribe cleanly.
    const subKey = sub.options?.applicationServerKey;
    const matches = subKey
      ? bytesEqual(new Uint8Array(subKey), applicationServerKey)
      : false;
    if (!matches) {
      try {
        await sub.unsubscribe();
      } catch {
        // ignore
      }
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast to BufferSource — the TS DOM lib narrows to ArrayBuffer-backed
      // views but pushManager accepts any Uint8Array at runtime.
      applicationServerKey: applicationServerKey as unknown as BufferSource,
    });
  }

  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) {
    throw new Error("push subscription missing keys");
  }
  client.send({
    v: 1,
    t: "push.subscribe",
    endpoint: sub.endpoint,
    keys: { p256dh, auth },
  });
  return { status: "granted-on", endpoint: sub.endpoint };
}

export async function disablePush(client: RccClient): Promise<PushState> {
  if (!isSupported()) return { status: "unsupported", endpoint: null };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    client.send({ v: 1, t: "push.unsubscribe", endpoint: sub.endpoint });
    try {
      await sub.unsubscribe();
    } catch {
      // ignore
    }
  }
  return {
    status: Notification.permission === "granted" ? "granted-off" : "default",
    endpoint: null,
  };
}

export function sendTestPush(client: RccClient): void {
  client.send({ v: 1, t: "push.test" });
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
