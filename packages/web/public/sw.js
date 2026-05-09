/* global self, caches, fetch */
/**
 * RCC PWA service worker — hand-rolled, no dependencies.
 *
 * Strategy:
 *   - Precache the app shell (/, /index.html, /manifest.webmanifest, icons).
 *   - Runtime: cache-first for fingerprinted static assets under /assets/
 *     and for the icons + manifest.
 *   - Runtime: network-first for HTML navigations, falling back to the
 *     cached shell so the app opens offline.
 *   - NEVER cache realtime / auth / health paths: /ws, /pair/*, /health,
 *     /tunnel. These must always hit the network (and must not be served
 *     stale), otherwise pairing + tunnel + liveness break.
 *   - Version cache name `rcc-v1`; on activate we nuke any other caches.
 */

const VERSION = "rcc-v1";
const STATIC_CACHE = `rcc-static-${VERSION}`;
const HTML_CACHE = `rcc-html-${VERSION}`;

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
        keys
          .filter((k) => k !== STATIC_CACHE && k !== HTML_CACHE)
          .map((k) => caches.delete(k)),
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

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
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
