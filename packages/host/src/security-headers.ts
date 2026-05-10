/**
 * Strict security headers applied to every HTTP response from the host.
 *
 * Scope:
 * - CSP uses `'self'` as default. WebSocket upgrades need `wss:`/`ws:` in
 *   `connect-src` (tunnel + local). WASM (libsodium) needs
 *   `'wasm-unsafe-eval'` in `script-src`. Monaco inlines styles, so
 *   `style-src` allows `'unsafe-inline'`. Fonts come from self + data: URIs
 *   (Monaco's lazy font chunks). Service worker registered from `/sw.js` on
 *   same origin is covered by `'self'`. Workers (Monaco language services)
 *   are loaded from blob URLs.
 * - COOP/COEP together enable cross-origin isolation (required for
 *   SharedArrayBuffer + high-res timers). `credentialless` is chosen over
 *   `require-corp` so the web bundle doesn't have to stamp CORP on every
 *   static asset while still blocking credentialed third-party embeds.
 * - `publickey-credentials-get=(self)` is required for WebAuthn passkey
 *   login from our own origin.
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY` defend against
 *   clickjacking on legacy + modern browsers.
 *
 * These headers are safe to apply unconditionally to every response — they
 * do not affect JSON API consumers (curl, 3rd party) because CSP only
 * constrains browser rendering contexts.
 */

import type { ServerResponse } from "node:http";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-security-policy": [
    "default-src 'self'",
    "connect-src 'self' wss: ws:",
    "img-src 'self' data: blob:",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "credentialless",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": [
    "camera=()",
    "microphone=(self)",
    "geolocation=()",
    "interest-cohort=()",
    "browsing-topics=()",
    "publickey-credentials-get=(self)",
  ].join(", "),
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
});

/**
 * Apply the full security header set to a response. Idempotent — safe to
 * call before `writeHead` (headers are queued on the response object). If a
 * downstream handler passes its own headers to `writeHead`, those merge
 * with what's already set via `setHeader`.
 */
export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    // Don't stomp a header a downstream handler already set (e.g. a CSP
    // override for some niche route). In practice nothing else sets these.
    if (!res.hasHeader(name)) res.setHeader(name, value);
  }
}
