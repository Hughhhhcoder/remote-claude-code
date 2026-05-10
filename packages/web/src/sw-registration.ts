import { createSignal } from "solid-js";

/**
 * Service worker registration with update-waiting detection (B21-A).
 *
 * Moved from inline script in index.html so we can expose a reactive
 * "update ready" signal that the UpdateBanner component reads.
 *
 * Flow:
 *   1. SW.register() with updateViaCache:"none" (bypasses HTTP cache for /sw.js)
 *   2. On 'updatefound' → listen for the new SW to reach 'installed' state
 *   3. If another SW already controls the page → this new one is waiting
 *   4. Set updateWaiting(true) → UpdateBanner appears
 *   5. User click → postMessage SKIP_WAITING to waiting SW
 *   6. 'controllerchange' fires → reload
 */

const [updateWaiting, setUpdateWaiting] = createSignal(false);
let cachedRegistration: ServiceWorkerRegistration | null = null;

export function useUpdateWaiting(): () => boolean {
  return updateWaiting;
}

export async function applyUpdate(): Promise<void> {
  const reg = cachedRegistration ?? (await navigator.serviceWorker.getRegistration());
  if (!reg?.waiting) {
    // No waiting worker — maybe already activated; force reload anyway.
    window.location.reload();
    return;
  }
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  reg.waiting.postMessage({ type: "SKIP_WAITING" });
  // Fallback: if controllerchange doesn't fire within 3s, reload anyway.
  setTimeout(() => {
    if (!reloaded) {
      reloaded = true;
      window.location.reload();
    }
  }, 3000);
}

export function dismissUpdate(): void {
  // Keep the SW waiting; hide the banner for this session. Re-shows on next
  // updatefound event (usually a new deploy triggers it again on reload).
  setUpdateWaiting(false);
}

function watchRegistration(reg: ServiceWorkerRegistration): void {
  cachedRegistration = reg;
  // Case 1: waiting SW already present at registration time.
  if (reg.waiting && navigator.serviceWorker.controller) {
    setUpdateWaiting(true);
  }
  // Case 2: a future update arrives and reaches 'installed'.
  reg.addEventListener("updatefound", () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener("statechange", () => {
      if (sw.state === "installed" && navigator.serviceWorker.controller) {
        setUpdateWaiting(true);
      }
    });
  });
}

export function installSW(): void {
  if (!("serviceWorker" in navigator)) return;
  if (/[?&]nosw=1/.test(location.search)) return;
  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => watchRegistration(reg))
    .catch((err) => {
      console.warn("[rcc] SW registration failed:", err);
    });
}
