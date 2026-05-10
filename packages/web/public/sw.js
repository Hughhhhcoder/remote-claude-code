/* global self, caches, fetch */
/**
 * RCC PWA service worker — hand-rolled, no dependencies.
 *
 * Strategy (B20-B · precache narrowed + per-build versioned):
 *   - Precache ONLY the app shell (/, /index.html, /manifest.webmanifest,
 *     icons). The entry JS/CSS are fingerprinted and pulled on first
 *     navigation; precaching them here would require build-time asset
 *     discovery, which we get for free via runtime caching below.
 *   - Runtime caching is split into three buckets so heavy lazy chunks
 *     (Monaco / xterm / sodium / yjs / *.worker*) don't share an LRU with
 *     the entry chunk + fonts + icons:
 *       · rcc-assets  → cache-first, unbounded, for entry/vendor/solid/
 *         icon/font assets. These are small and every session needs them.
 *       · rcc-heavy   → stale-while-revalidate, bounded to 20 entries, for
 *         the big lazy chunks. First paint never waits on cache refresh,
 *         and stale copies evict naturally on new-build deploy because
 *         their filename hash changes and the bounded bucket pushes old
 *         hashes out.
 *       · rcc-html    → network-first for navigations, falls back to the
 *         cached shell so the PWA opens offline.
 *   - NEVER cache realtime / auth / health paths: /ws, /pair/*, /health,
 *     /tunnel. These must always hit the network (and must not be served
 *     stale), otherwise pairing + tunnel + liveness break.
 *   - Cache names embed a build-hash VERSION injected by vite.config.ts at
 *     build time (placeholder `__BUILD_VERSION__`). On activate we nuke any
 *     cache whose name doesn't match the current VERSION, so deploying a
 *     new build evicts every prior bucket cleanly in one pass.
 */

// Replaced at build time by vite.config.ts with the entry-chunk hash so
// each deploy gets fresh cache buckets. In dev the placeholder survives
// (which is fine — dev has its own SW-less flow via ?nosw=1).
const VERSION = "__BUILD_VERSION__";
const STATIC_CACHE = `rcc-static-${VERSION}`;
const ASSETS_CACHE = `rcc-assets-${VERSION}`;
const HEAVY_CACHE = `rcc-heavy-${VERSION}`;
const HTML_CACHE = `rcc-html-${VERSION}`;
const CURRENT_CACHES = new Set([
  STATIC_CACHE,
  ASSETS_CACHE,
  HEAVY_CACHE,
  HTML_CACHE,
]);

// Names of lazy chunks produced by vite.config.ts `manualChunks`. Matching
// `/assets/<name>-<hash>.(js|css|wasm)` sends them to the bounded heavy
// bucket instead of the unbounded shared one. Keep in sync with vite.
const HEAVY_CHUNK_PATTERN =
  /\/assets\/(monaco|xterm|sodium|yjs|[a-zA-Z.]*\.worker)[^/]*\.(js|css|wasm)$/i;
const HEAVY_CACHE_MAX_ENTRIES = 20;

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

const NEVER_CACHE_PATHS = ["/ws", "/pair", "/health", "/tunnel"];

const OFFLINE_HTML = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RCC · 离线</title>
<style>
  html,body{height:100%;margin:0;background:#09090b;color:#e4e4e7;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{height:100%;display:grid;place-items:center;padding:24px;text-align:center}
  .card{max-width:360px}
  .logo{width:56px;height:56px;margin:0 auto 16px;border-radius:14px;
    background:linear-gradient(135deg,#fb923c,#f43f5e);display:grid;
    place-items:center;font-weight:700;font-size:22px;color:#fff}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;color:#a1a1aa;margin:0 0 16px;line-height:1.5}
  button{background:linear-gradient(90deg,#fb923c,#f43f5e);color:#fff;
    border:0;padding:10px 18px;border-radius:10px;font-size:14px;cursor:pointer}
</style></head>
<body><div class="wrap"><div class="card">
<div class="logo">R</div>
<h1>当前离线</h1>
<p>RCC PWA 已安装到本机，但目前无法连接到远程 host。重新联网后即可继续远程操控你的 Claude Code。</p>
<button onclick="location.reload()">重试</button>
</div></div></body></html>`;

function shouldBypass(url) {
  if (url.origin !== self.location.origin) return true;
  const p = url.pathname;
  for (const prefix of NEVER_CACHE_PATHS) {
    if (p === prefix || p.startsWith(prefix + "/")) return true;
  }
  return false;
}

function isStaticAsset(url) {
  const p = url.pathname;
  if (p.startsWith("/assets/")) return true;
  if (p === "/manifest.webmanifest") return true;
  if (/\.(js|mjs|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico)$/i.test(p)) return true;
  return false;
}

function isHeavyChunk(url) {
  return HEAVY_CHUNK_PATTERN.test(url.pathname);
}

function isNavigation(req) {
  return (
    req.mode === "navigate" ||
    (req.method === "GET" && (req.headers.get("accept") || "").includes("text/html"))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(APP_SHELL).catch(() => {
        // If some shell assets are missing at install (e.g. first ever dev
        // build), don't abort: runtime handlers will populate as needed.
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !CURRENT_CACHES.has(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Hard bypass for realtime / auth / health paths + websocket upgrades.
  if (shouldBypass(url)) return;
  if (req.headers.get("upgrade") === "websocket") return;

  if (isHeavyChunk(url)) {
    event.respondWith(staleWhileRevalidate(req, HEAVY_CACHE, HEAVY_CACHE_MAX_ENTRIES));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req, ASSETS_CACHE));
    return;
  }

  if (isNavigation(req)) {
    event.respondWith(networkFirstHtml(req));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type !== "opaque") {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const fallback = await cache.match(req);
    if (fallback) return fallback;
    throw err;
  }
}

// Stale-while-revalidate for heavy lazy chunks. Returns the cached copy
// immediately when present, and kicks off a background refresh so the next
// load picks up the newer build. Bounded via `maxEntries` so an endlessly
// deploying branch can't fill the origin quota with every hash Monaco has
// ever shipped.
async function staleWhileRevalidate(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then(async (res) => {
      if (res && res.status === 200 && res.type !== "opaque") {
        await cache.put(req, res.clone()).catch(() => {});
        if (typeof maxEntries === "number" && maxEntries > 0) {
          await trimCache(cache, maxEntries).catch(() => {});
        }
      }
      return res;
    })
    .catch(() => null);
  if (cached) {
    // Don't block the response on revalidate — just let it run.
    // eslint-disable-next-line no-unused-expressions
    networkPromise;
    return cached;
  }
  const fresh = await networkPromise;
  if (fresh) return fresh;
  throw new Error("swr-fetch-failed");
}

// Drop oldest entries (by insertion order — Cache Storage preserves it)
// when the bucket exceeds `max`. Called after successful writes.
async function trimCache(cache, max) {
  const reqs = await cache.keys();
  if (reqs.length <= max) return;
  const toDelete = reqs.slice(0, reqs.length - max);
  await Promise.all(toDelete.map((r) => cache.delete(r)));
}

async function networkFirstHtml(req) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      cache.put("/index.html", res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached =
      (await cache.match("/index.html")) ||
      (await caches.match("/index.html")) ||
      (await caches.match("/"));
    if (cached) return cached;
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// ── Web Push ────────────────────────────────────────────────────────────────
// Host-generated VAPID keypair signs each push. The payload is the JSON a
// PushPayload shape: { title, body, tag?, data?, requireInteraction? }.
// We always resolve to a notification so browsers (esp. Chrome on Android)
// don't grumble about "silent pushes". Clicking the notification focuses an
// existing RCC tab if there is one, otherwise opens the app shell.

self.addEventListener("push", (event) => {
  let data = { title: "RCC", body: "新通知" };
  try {
    if (event.data) {
      const j = event.data.json();
      if (j && typeof j === "object") data = j;
    }
  } catch {
    try {
      const text = event.data?.text?.();
      if (text) data = { title: "RCC", body: text };
    } catch {
      // ignore
    }
  }

  const title = data.title || "RCC";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag,
    data: data.data ?? null,
    requireInteraction: data.requireInteraction === true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const c of all) {
        // Prefer an existing tab on same origin — no point in opening 5.
        if ("focus" in c) {
          try {
            await c.focus();
            return;
          } catch {
            // fall through
          }
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow("/");
      }
    })(),
  );
});
